import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

/// Orchestration. Everything below runs off the main thread — the caller
/// (`PapercubVisionModule`) puts it on a user-initiated queue.
///
/// There is no networking anywhere in this module, by construction: no
/// URLSession, no analytics, no logging of image content. The only things that
/// cross the bridge are two file URLs, a number, a method name, and a handful
/// of booleans.
enum IsolationPipeline {
  /// Longest side of the files we write. Keeps a 12 MP capture from becoming a
  /// 30 MB PNG while staying well above what illustration needs.
  static let maxOutputSide: CGFloat = 2048

  struct Options {
    var imageUri: String
    var deskew: Bool = true
    var whiteBalance: Bool = true
    var confidenceThreshold: Double = 0.6
  }

  struct Result {
    var cutoutUri: String
    var processedOriginalUri: String
    var confidence: Double
    var method: String          // matches IsolationMethod in @papercub/shared
    var palette: [String]
    var widthPx: Int            // dimensions of the cut-out
    var heightPx: Int
    var faceDetected: Bool
    var nameLikeTextDetected: Bool
    var exifStripped: Bool      // always true; the write path verifies it

    var dictionary: [String: Any] {
      [
        "cutoutUri": cutoutUri,
        "processedOriginalUri": processedOriginalUri,
        "confidence": confidence,
        "method": method,
        "palette": palette,
        "widthPx": widthPx,
        "heightPx": heightPx,
        "faceDetected": faceDetected,
        "nameLikeTextDetected": nameLikeTextDetected,
        "exifStripped": exifStripped
      ]
    }
  }

  static let methodSubjectLift = "vision_subject_lift"
  static let methodInkExtraction = "ink_extraction"
  static let methodManualRepair = "manual_repair"

  // MARK: - Main entry point

  static func isolate(options: Options) throws -> Result {
    guard let sourceURL = URL(string: options.imageUri) ?? URL(fileURLWithPath: options.imageUri) as URL? else {
      throw PrivateImageIO.Failure.unreadableSource
    }
    let fileURL = sourceURL.isFileURL ? sourceURL : URL(fileURLWithPath: options.imageUri)

    // 1. Decode, bake orientation, drop every metadata container.
    let baked = try PrivateImageIO.loadOrientationBaked(url: fileURL)
    let sourceImage = PrivateImageIO.fit(CIImage(cgImage: baked), maxSide: maxOutputSide)

    // 2. Flatten the sheet and neutralise the lamp.
    let normalised = PaperNormaliser.normalise(
      sourceImage,
      source: baked,
      deskew: options.deskew,
      whiteBalance: options.whiteBalance
    )
    let processed = normalised.image
    let processedCG = try PrivateImageIO.render(processed)

    // 3. Measure the image, then pick a path from the measurements.
    let analysis = try ImageStats.analyse(processed)

    var cutout: CIImage
    var confidence: Double
    var method: String

    if analysis.isSketchLike {
      // Low saturation + high frequency: pencil. Threshold first.
      let ink = try InkExtractor.extract(from: processed, analysis: analysis)
      cutout = ink.cutout
      confidence = ink.confidence
      method = methodInkExtraction

      // If thresholding did poorly anyway, give subject lift a chance rather
      // than sending the parent to manual repair without trying.
      if confidence < options.confidenceThreshold, #available(iOS 17.0, *),
         let lift = try? SubjectLift.lift(source: processedCG, colour: processed),
         lift.confidence > confidence {
        cutout = lift.cutout
        confidence = lift.confidence
        method = methodSubjectLift
      }
    } else {
      var lifted: SubjectLift.Output?
      if #available(iOS 17.0, *) {
        lifted = try? SubjectLift.lift(source: processedCG, colour: processed)
      }

      if let lift = lifted, lift.confidence >= options.confidenceThreshold {
        cutout = lift.cutout
        confidence = lift.confidence
        method = methodSubjectLift
      } else {
        // Either the OS is too old, the request found nothing, or the matte
        // scored badly. Threshold and keep whichever result scores higher.
        let ink = try InkExtractor.extract(from: processed, analysis: analysis)
        if let lift = lifted, lift.confidence >= ink.confidence {
          cutout = lift.cutout
          confidence = lift.confidence
          method = methodSubjectLift
        } else {
          cutout = ink.cutout
          confidence = ink.confidence
          method = methodInkExtraction
        }
      }
    }

    // 4. Crop to what was actually cut out, with a small margin.
    cutout = cropToSubject(cutout)

    // 5. Face + name-like text, on the full processed photo — the sibling in
    //    the background is in the photo, not in the cut-out.
    let findings = PrivacyScan.scan(processedCG)

    // 6. Write both files through the metadata-stripping, self-verifying path.
    let cutoutCG = try PrivateImageIO.render(cutout)
    let cutoutURL = try PrivateImageIO.outputURL(prefix: "cutout", ext: "png")
    try PrivateImageIO.writePNG(cutoutCG, to: cutoutURL)

    let originalURL = try PrivateImageIO.outputURL(prefix: "original", ext: "jpg")
    try PrivateImageIO.writeJPEG(processedCG, to: originalURL, quality: 0.9)

    let palette = (try? ImageStats.palette(of: cutout)) ?? []

    return Result(
      cutoutUri: cutoutURL.absoluteString,
      processedOriginalUri: originalURL.absoluteString,
      confidence: (confidence * 1000).rounded() / 1000,
      method: method,
      palette: palette,
      widthPx: cutoutCG.width,
      heightPx: cutoutCG.height,
      faceDetected: findings.faceDetected,
      nameLikeTextDetected: findings.nameLikeTextDetected,
      exifStripped: true
    )
  }

  // MARK: - Manual repair

  /// Composites a parent-brushed matte over the source image.
  ///
  /// The mask is authoritative: final alpha = mask luminance × mask alpha.
  /// White strokes keep, black strokes remove, untouched (transparent) area is
  /// removed — i.e. the repair UI sends the *whole* matte it is showing, which
  /// it builds by starting from the previous cut-out's alpha and brushing on
  /// top. Confidence is 1: a human looked at it.
  static func applyManualMask(imageUri: String, maskUri: String) throws -> Result {
    let imageURL = fileURL(from: imageUri)
    let maskURL = fileURL(from: maskUri)

    let baked = try PrivateImageIO.loadOrientationBaked(url: imageURL)
    let source = PrivateImageIO.fit(CIImage(cgImage: baked), maxSide: maxOutputSide)
    let maskBaked = try PrivateImageIO.loadOrientationBaked(url: maskURL)
    var mask = CIImage(cgImage: maskBaked)

    guard mask.extent.width > 0, mask.extent.height > 0 else {
      throw PrivateImageIO.Failure.decodeFailed
    }
    if mask.extent.size != source.extent.size {
      mask = mask.transformed(by: CGAffineTransform(
        scaleX: source.extent.width / mask.extent.width,
        y: source.extent.height / mask.extent.height
      ))
    }
    mask = mask.transformed(by: CGAffineTransform(
      translationX: source.extent.origin.x - mask.extent.origin.x,
      y: source.extent.origin.y - mask.extent.origin.y
    ))

    let toAlpha = CIFilter.maskToAlpha()
    toAlpha.inputImage = mask
    guard let alphaMask = toAlpha.outputImage else { throw PrivateImageIO.Failure.encodeFailed }

    let blend = CIFilter.blendWithMask()
    blend.inputImage = source
    blend.backgroundImage = CIImage.empty()
    blend.maskImage = alphaMask
    guard let composited = blend.outputImage?.cropped(to: source.extent) else {
      throw PrivateImageIO.Failure.encodeFailed
    }

    let cutout = cropToSubject(composited)
    let cutoutCG = try PrivateImageIO.render(cutout)
    let cutoutURL = try PrivateImageIO.outputURL(prefix: "cutout-manual", ext: "png")
    try PrivateImageIO.writePNG(cutoutCG, to: cutoutURL)

    let sourceCG = try PrivateImageIO.render(source)
    let originalURL = try PrivateImageIO.outputURL(prefix: "original", ext: "jpg")
    try PrivateImageIO.writeJPEG(sourceCG, to: originalURL, quality: 0.9)

    let findings = PrivacyScan.scan(sourceCG)

    return Result(
      cutoutUri: cutoutURL.absoluteString,
      processedOriginalUri: originalURL.absoluteString,
      confidence: 1,
      method: methodManualRepair,
      palette: (try? ImageStats.palette(of: cutout)) ?? [],
      widthPx: cutoutCG.width,
      heightPx: cutoutCG.height,
      faceDetected: findings.faceDetected,
      nameLikeTextDetected: findings.nameLikeTextDetected,
      exifStripped: true
    )
  }

  // MARK: - Helpers

  static func fileURL(from uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri)
  }

  /// Trims transparent margin so the cut-out is the drawing, not the drawing
  /// adrift in a sheet of nothing. Falls back to the full extent when the
  /// matte is empty or fills the frame.
  static func cropToSubject(_ image: CIImage, padding: CGFloat = 0.02) -> CIImage {
    guard let stats = try? ImageStats.matteStats(alphaOf: image), stats.coverage > 0.0005,
          stats.boundingBox.width > 0, stats.boundingBox.height > 0 else {
      return image
    }
    let extent = image.extent
    let box = stats.boundingBox
    let padX = extent.width * padding
    let padY = extent.height * padding
    // `box` is top-down; Core Image extents are bottom-up. Without this flip
    // the crop keeps the mirror image of the subject — which is exactly what
    // it did before this was measured.
    let flippedY = 1 - (box.origin.y + box.height)
    let rect = CGRect(
      x: extent.origin.x + box.origin.x * extent.width - padX,
      y: extent.origin.y + flippedY * extent.height - padY,
      width: box.width * extent.width + padX * 2,
      height: box.height * extent.height + padY * 2
    ).intersection(extent)
    guard rect.isUsable, rect.width > 16, rect.height > 16 else { return image }
    return image.cropped(to: rect)
  }
}
