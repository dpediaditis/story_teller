import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Every byte this module writes to disk goes through here.
///
/// Two rules are enforced in one place:
///   1. Nothing is ever written with an Exif, GPS, IPTC or TIFF dictionary.
///   2. Every write is re-opened and inspected afterwards; if a metadata
///      dictionary somehow survived, the write is an error rather than a
///      silently leaky success. `IsolateResult.exifStripped` is typed
///      `literal true`, so it must be true by construction, not by hope.
extension CGRect {
  /// `CGRect` has `isNull`/`isInfinite` but no `isFinite`; Core Image extents
  /// can be any of those, so every geometry check goes through this.
  var isUsable: Bool {
    !isNull && !isInfinite && !isEmpty && width.isFinite && height.isFinite
  }
}

enum PrivateImageIO {
  enum Failure: Error, CustomStringConvertible {
    case unreadableSource
    case decodeFailed
    case encodeFailed
    case metadataSurvivedWrite(String)
    case contextFailed

    var description: String {
      switch self {
      case .unreadableSource: return "Could not open the image file."
      case .decodeFailed: return "Could not decode the image."
      case .encodeFailed: return "Could not encode the output image."
      case .metadataSurvivedWrite(let key): return "Refusing to return a file that still carries \(key) metadata."
      case .contextFailed: return "Could not create a drawing context."
      }
    }
  }

  /// Orientation is the only piece of source metadata we read, and we consume
  /// it immediately by baking it into the pixels. The returned `CGImage` is a
  /// bare bitmap: `CGImage` has no container for Exif/GPS, so from this point
  /// on there is nothing left to leak.
  static func loadOrientationBaked(url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw Failure.unreadableSource
    }
    guard let decoded = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw Failure.decodeFailed
    }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let rawOrientation = (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1
    return bakeOrientation(decoded, exifOrientation: rawOrientation)
  }

  /// Redraws the bitmap so that its pixels are in display order.
  static func bakeOrientation(_ image: CGImage, exifOrientation: UInt32) -> CGImage {
    guard exifOrientation > 1, exifOrientation <= 8 else { return image }

    let w = CGFloat(image.width)
    let h = CGFloat(image.height)
    let swapsAxes = exifOrientation >= 5
    let outSize = swapsAxes ? CGSize(width: h, height: w) : CGSize(width: w, height: h)

    var transform = CGAffineTransform.identity
    switch exifOrientation {
    case 2: transform = CGAffineTransform(translationX: w, y: 0).scaledBy(x: -1, y: 1)
    case 3: transform = CGAffineTransform(translationX: w, y: h).rotated(by: .pi)
    case 4: transform = CGAffineTransform(translationX: 0, y: h).scaledBy(x: 1, y: -1)
    case 5: transform = CGAffineTransform(translationX: 0, y: 0).rotated(by: -.pi / 2).scaledBy(x: -1, y: 1)
    case 6: transform = CGAffineTransform(translationX: h, y: 0).rotated(by: .pi / 2)
    case 7: transform = CGAffineTransform(translationX: h, y: w).rotated(by: .pi / 2).scaledBy(x: -1, y: 1)
    case 8: transform = CGAffineTransform(translationX: 0, y: w).rotated(by: -.pi / 2)
    default: break
    }

    guard let context = CGContext(
      data: nil,
      width: Int(outSize.width),
      height: Int(outSize.height),
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return image }

    context.concatenate(transform)
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return context.makeImage() ?? image
  }

  /// A private, non-backed-up working directory inside Caches. Files here are
  /// never uploaded by this module — it has no network code at all — and are
  /// re-created per capture.
  static func workingDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    ).appendingPathComponent("papercub-vision", isDirectory: true)
    if !FileManager.default.fileExists(atPath: base.path) {
      try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }
    return base
  }

  static func outputURL(prefix: String, ext: String) throws -> URL {
    try workingDirectory().appendingPathComponent("\(prefix)-\(UUID().uuidString).\(ext)")
  }

  static func writePNG(_ image: CGImage, to url: URL) throws {
    try write(image, to: url, type: UTType.png, properties: [:])
    try assertNoMetadata(at: url)
  }

  static func writeJPEG(_ image: CGImage, to url: URL, quality: CGFloat = 0.9) throws {
    try write(image, to: url, type: UTType.jpeg, properties: [
      kCGImageDestinationLossyCompressionQuality: quality
    ])
    try assertNoMetadata(at: url)
  }

  private static func write(_ image: CGImage, to url: URL, type: UTType, properties: [CFString: Any]) throws {
    guard let destination = CGImageDestinationCreateWithURL(
      url as CFURL, type.identifier as CFString, 1, nil
    ) else { throw Failure.encodeFailed }

    // Note: we deliberately do NOT pass kCFNull for the Exif/GPS/TIFF
    // dictionaries. ImageIO refuses to finalise a PNG when they are nulled
    // that way (verified — the write just fails), and it is unnecessary: the
    // thing being written is a bare CGImage, which has no metadata to carry
    // over in the first place. Absence is then *proved* by `assertNoMetadata`
    // rather than assumed.
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw Failure.encodeFailed }
  }

  /// ImageIO always writes a small `{Exif}` block describing the pixels
  /// themselves. These are the only keys allowed to survive: they say how big
  /// the image is and what colour space it is in, and nothing about who,
  /// where, when, or with what.
  private static let allowedExifKeys: Set<String> = [
    kCGImagePropertyExifColorSpace as String,
    kCGImagePropertyExifPixelXDimension as String,
    kCGImagePropertyExifPixelYDimension as String
  ]

  /// Same idea for TIFF: geometry and encoding only, never Make/Model/
  /// Software/DateTime/Artist/Copyright.
  private static let allowedTIFFKeys: Set<String> = [
    kCGImagePropertyTIFFOrientation as String,
    kCGImagePropertyTIFFXResolution as String,
    kCGImagePropertyTIFFYResolution as String,
    kCGImagePropertyTIFFResolutionUnit as String,
    kCGImagePropertyTIFFCompression as String,
    kCGImagePropertyTIFFPhotometricInterpretation as String
  ]

  /// Re-opens a file we just wrote and refuses to hand it back if it carries
  /// anything identifying. This is the check behind `exifStripped: true` — the
  /// flag is a verified fact about the bytes on disk, not a promise about the
  /// code path that produced them.
  static func assertNoMetadata(at url: URL) throws {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
      return
    }

    func reject(_ label: String) throws -> Never {
      try? FileManager.default.removeItem(at: url)
      throw Failure.metadataSurvivedWrite(label)
    }

    let forbidden: [(CFString, String)] = [
      (kCGImagePropertyGPSDictionary, "GPS"),
      (kCGImagePropertyIPTCDictionary, "IPTC"),
      (kCGImagePropertyMakerAppleDictionary, "Apple maker note"),
      (kCGImagePropertyExifAuxDictionary, "Exif aux")
    ]
    for (key, label) in forbidden where props[key] != nil {
      try reject(label)
    }

    if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] {
      for key in exif.keys where !allowedExifKeys.contains(key as String) {
        try reject("Exif " + (key as String))
      }
    }
    if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
      for key in tiff.keys where !allowedTIFFKeys.contains(key as String) {
        try reject("TIFF " + (key as String))
      }
    }
  }

  /// Shared rendering context. `.useSoftwareRenderer` stays false so the GPU
  /// does the work; the context is created once because CIContext creation is
  /// expensive.
  static let ciContext: CIContext = {
    CIContext(options: [
      .useSoftwareRenderer: false,
      .cacheIntermediates: false,
      .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB) as Any
    ])
  }()

  static func render(_ image: CIImage, bounds: CGRect? = nil) throws -> CGImage {
    let rect = bounds ?? image.extent
    guard rect.isUsable,
          let cg = ciContext.createCGImage(image, from: rect, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)) else {
      throw Failure.encodeFailed
    }
    return cg
  }

  /// Downscales so the longest side is at most `maxSide`. Keeps output files
  /// sane for upload and Vision requests fast; never upscales.
  ///
  /// `clampedToExtent()` matters more than it looks. Without it the resampler
  /// reads transparent black from outside the image and every downscale gains
  /// a one-pixel dark frame — which the analysis then counts as ink. That
  /// artifact alone made a blank sheet and a pencil drawing measure the same,
  /// so this clamp is load-bearing, not tidiness.
  static func fit(_ image: CIImage, maxSide: CGFloat) -> CIImage {
    let longest = max(image.extent.width, image.extent.height)
    guard longest > maxSide, longest > 0, image.extent.isUsable else { return image }
    let scale = maxSide / longest
    let transform = CGAffineTransform(scaleX: scale, y: scale)
    let target = image.extent.applying(transform)
    return image.clampedToExtent().transformed(by: transform).cropped(to: target)
  }

  /// Renders into a tightly packed RGBA8 buffer for CPU-side analysis.
  /// Everything statistical in this module runs on a small buffer like this,
  /// never on the full-resolution image.
  static func rgbaBuffer(from image: CIImage, maxSide: CGFloat) throws -> (pixels: [UInt8], width: Int, height: Int) {
    let scaled = fit(image, maxSide: maxSide)
    let raw = scaled.extent
    guard raw.isUsable else { throw Failure.decodeFailed }

    // The render rect is rounded *inward*, never outward. A scaled extent is
    // rarely a whole number of pixels, and a rect even a fraction of a pixel
    // wider than the image makes the last column half-transparent — which
    // reads as a dark line to every statistic downstream, and was measured
    // doing exactly that (right-hand column, luma 0.43 on a white sheet).
    let width = max(1, Int(raw.width.rounded(.down)))
    let height = max(1, Int(raw.height.rounded(.down)))
    let bounds = CGRect(
      x: raw.origin.x.rounded(.up),
      y: raw.origin.y.rounded(.up),
      width: CGFloat(width),
      height: CGFloat(height)
    )

    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    pixels.withUnsafeMutableBytes { rawBuffer in
      guard let base = rawBuffer.baseAddress else { return }
      ciContext.render(
        scaled.clampedToExtent(),
        toBitmap: base,
        rowBytes: width * 4,
        bounds: bounds,
        format: .RGBA8,
        colorSpace: space
      )
    }
    return (pixels, width, height)
  }
}
