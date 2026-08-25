import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import Vision

/// Finds the sheet of paper, flattens it, and neutralises the light it was
/// photographed under. A kitchen-table photo under a warm bulb otherwise turns
/// a green monster brown, and the child does not recognise their own drawing.
enum PaperNormaliser {
  struct Result {
    var image: CIImage
    var paperDetected: Bool
    var deskewed: Bool
    /// Vision's own confidence in the rectangle, 0 when nothing was found.
    var rectangleConfidence: Float
  }

  /// Vision rectangle detection tuned for a sheet of paper filling most of a
  /// handheld frame. `maximumAspectRatio` is 1.0 because Vision expresses the
  /// ratio as the shorter side over the longer one.
  static func detectPaper(in image: CGImage) -> VNRectangleObservation? {
    let request = VNDetectRectanglesRequest()
    request.minimumAspectRatio = 0.35
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.25
    request.minimumConfidence = 0.5
    request.quadratureTolerance = 25
    request.maximumObservations = 8

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return nil
    }
    guard let observations = request.results, !observations.isEmpty else { return nil }

    // Largest quad wins: a drawing pinned to the fridge often sits inside a
    // frame of other rectangles (tiles, table edges, the phone's own screen).
    return observations.max { lhs, rhs in
      quadArea(lhs) < quadArea(rhs)
    }
  }

  private static func quadArea(_ o: VNRectangleObservation) -> CGFloat {
    let p = [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft]
    var area: CGFloat = 0
    for i in 0..<4 {
      let a = p[i], b = p[(i + 1) % 4]
      area += a.x * b.y - b.x * a.y
    }
    return abs(area) / 2
  }

  /// Vision's normalised coordinates share Core Image's bottom-left origin, so
  /// the conversion is a plain multiply by the extent.
  static func perspectiveCorrect(_ image: CIImage, using observation: VNRectangleObservation) -> CIImage? {
    let extent = image.extent
    func denormalise(_ p: CGPoint) -> CGPoint {
      CGPoint(x: extent.origin.x + p.x * extent.width, y: extent.origin.y + p.y * extent.height)
    }
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = image
    filter.topLeft = denormalise(observation.topLeft)
    filter.topRight = denormalise(observation.topRight)
    filter.bottomLeft = denormalise(observation.bottomLeft)
    filter.bottomRight = denormalise(observation.bottomRight)
    filter.crop = true
    guard let output = filter.outputImage, output.extent.isUsable else { return nil }
    // A degenerate quad can produce a sliver; reject anything implausible
    // rather than handing back a smeared image.
    let areaRatio = (output.extent.width * output.extent.height) / max(1, extent.width * extent.height)
    guard areaRatio > 0.08 else { return nil }

    return trimDarkBorder(output)
  }

  /// Rectangle detection reliably lands a few pixels outside the sheet,
  /// leaving a thin dark frame of table around the corrected image. Measured
  /// on the fixtures, that frame was the *majority* of everything downstream
  /// counted as ink — it made a blank sheet and a pencil drawing statistically
  /// identical. So scan inwards from each edge and drop the rows and columns
  /// that are still mostly dark.
  static func trimDarkBorder(_ image: CIImage) -> CIImage {
    let extent = image.extent
    guard let buffer = try? PrivateImageIO.rgbaBuffer(from: image, maxSide: 160) else { return image }
    let (pixels, width, height) = (buffer.pixels, buffer.width, buffer.height)
    guard width > 20, height > 20 else { return image }

    func luma(_ x: Int, _ y: Int) -> Double {
      let i = (y * width + x) * 4
      return 0.2126 * Double(pixels[i]) / 255 + 0.7152 * Double(pixels[i + 1]) / 255 + 0.0722 * Double(pixels[i + 2]) / 255
    }
    func rowIsBorder(_ y: Int) -> Bool {
      var dark = 0
      for x in 0..<width where luma(x, y) < 0.55 { dark += 1 }
      return Double(dark) / Double(width) > 0.30
    }
    func columnIsBorder(_ x: Int) -> Bool {
      var dark = 0
      for y in 0..<height where luma(x, y) < 0.55 { dark += 1 }
      return Double(dark) / Double(height) > 0.30
    }

    // Never eat more than 6% from a side: past that we are cutting drawing,
    // not table.
    let maxTrimX = max(1, Int(Double(width) * 0.06))
    let maxTrimY = max(1, Int(Double(height) * 0.06))
    var top = 0, bottom = 0, left = 0, right = 0
    while top < maxTrimY, rowIsBorder(top) { top += 1 }
    while bottom < maxTrimY, rowIsBorder(height - 1 - bottom) { bottom += 1 }
    while left < maxTrimX, columnIsBorder(left) { left += 1 }
    while right < maxTrimX, columnIsBorder(width - 1 - right) { right += 1 }

    // One extra sample of margin, because antialiasing on the sheet edge is
    // brighter than the table but still not paper.
    let pad = 1.0
    let sx = extent.width / Double(width)
    let sy = extent.height / Double(height)
    // The buffer is top-down, the extent is bottom-up: `top` trims maxY.
    let rect = CGRect(
      x: extent.minX + (Double(left) + pad) * sx,
      y: extent.minY + (Double(bottom) + pad) * sy,
      width: extent.width - (Double(left + right) + 2 * pad) * sx,
      height: extent.height - (Double(top + bottom) + 2 * pad) * sy
    ).intersection(extent)

    guard rect.isUsable, rect.width > extent.width * 0.5, rect.height > extent.height * 0.5 else {
      return image
    }
    return image.cropped(to: rect)
  }

  /// Grey-world white balance with clamped gains.
  ///
  /// A drawing on paper is mostly paper, so the scene average is close to the
  /// illuminant. Gains are clamped hard: an over-eager correction on a photo
  /// that really is mostly one saturated colour would drain that colour, which
  /// is the exact failure we are trying to avoid.
  static func normaliseWhiteBalance(_ image: CIImage) -> CIImage {
    guard let stats = try? PrivateImageIO.rgbaBuffer(from: image, maxSide: 96) else { return image }

    var sum = SIMD3<Double>(0, 0, 0)
    var counted = 0.0
    let count = stats.width * stats.height
    for i in 0..<count {
      let r = Double(stats.pixels[i * 4]) / 255
      let g = Double(stats.pixels[i * 4 + 1]) / 255
      let b = Double(stats.pixels[i * 4 + 2]) / 255
      let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // Ignore ink and blown highlights; we want the paper, which is the
      // brightest large surface that is not clipped.
      guard luma > 0.35, luma < 0.99 else { continue }
      sum += SIMD3(r, g, b)
      counted += 1
    }
    guard counted > Double(count) * 0.05 else { return image }

    let mean = sum / counted
    let target = (mean.x + mean.y + mean.z) / 3
    guard target > 0.01 else { return image }

    func gain(_ channel: Double) -> CGFloat {
      guard channel > 0.01 else { return 1 }
      return CGFloat(min(1.35, max(0.75, target / channel)))
    }

    let matrix = CIFilter.colorMatrix()
    matrix.inputImage = image
    matrix.rVector = CIVector(x: gain(mean.x), y: 0, z: 0, w: 0)
    matrix.gVector = CIVector(x: 0, y: gain(mean.y), z: 0, w: 0)
    matrix.bVector = CIVector(x: 0, y: 0, z: gain(mean.z), w: 0)
    matrix.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    matrix.biasVector = CIVector(x: 0, y: 0, z: 0, w: 0)
    return matrix.outputImage ?? image
  }

  static func normalise(_ image: CIImage, source: CGImage, deskew: Bool, whiteBalance: Bool) -> Result {
    var working = image
    var deskewed = false
    var confidence: Float = 0
    var found = false

    if let observation = detectPaper(in: source) {
      found = true
      confidence = observation.confidence
      if deskew, let corrected = perspectiveCorrect(working, using: observation) {
        working = corrected
        deskewed = true
      }
    }

    if whiteBalance {
      working = normaliseWhiteBalance(working)
    }

    return Result(image: working, paperDetected: found, deskewed: deskewed, rectangleConfidence: confidence)
  }
}
