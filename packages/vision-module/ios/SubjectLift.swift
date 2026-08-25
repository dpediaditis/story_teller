import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import Vision

/// The happy path: the same subject-lifting Photos uses for "lift subject from
/// background". Works well on bold crayon and paint, and much less well on
/// pale pencil — hence `InkExtractor`.
enum SubjectLift {
  struct Output {
    var cutout: CIImage
    var confidence: Double
    var instanceCount: Int
  }

  /// iOS 17 is the floor for `VNGenerateForegroundInstanceMaskRequest`.
  static var isSupported: Bool {
    if #available(iOS 17.0, *) { return true }
    return false
  }

  @available(iOS 17.0, *)
  static func lift(source: CGImage, colour: CIImage) throws -> Output? {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: source, orientation: .up, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      return nil
    }

    // All instances, not just the most prominent one: a drawing is frequently
    // several disconnected figures on one sheet, and cutting out only the
    // largest silently deletes the child's other characters.
    let maskBuffer = try observation.generateScaledMaskForImage(
      forInstances: observation.allInstances,
      from: handler
    )

    var mask = CIImage(cvPixelBuffer: maskBuffer)
    // The mask arrives at the source image's pixel size; align it to whatever
    // extent the colour image ended up with after perspective correction.
    if mask.extent.size != colour.extent.size, mask.extent.width > 0, mask.extent.height > 0 {
      let sx = colour.extent.width / mask.extent.width
      let sy = colour.extent.height / mask.extent.height
      mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
    }
    mask = mask.transformed(by: CGAffineTransform(
      translationX: colour.extent.origin.x - mask.extent.origin.x,
      y: colour.extent.origin.y - mask.extent.origin.y
    ))

    let toAlpha = CIFilter.maskToAlpha()
    toAlpha.inputImage = mask
    guard let alphaMask = toAlpha.outputImage else { return nil }

    let blend = CIFilter.blendWithMask()
    blend.inputImage = colour
    blend.backgroundImage = CIImage.empty()
    blend.maskImage = alphaMask
    guard let cutout = blend.outputImage?.cropped(to: colour.extent) else { return nil }

    let stats = try ImageStats.matteStats(alphaOf: cutout)
    let confidence = score(stats: stats, instanceCount: observation.allInstances.count)
    return Output(cutout: cutout, confidence: confidence, instanceCount: observation.allInstances.count)
  }

  /// Confidence is deliberately pessimistic. A wrong cut-out presented
  /// confidently is worse than admitting uncertainty, so every term can only
  /// reduce the score and the ceiling is below 1.
  static func score(stats: ImageStats.MatteStats, instanceCount: Int) -> Double {
    // Nothing lifted, or the whole frame lifted (background mistaken for the
    // subject) are both failures.
    let coverage = stats.coverage
    let coverageScore: Double
    switch coverage {
    case ..<0.01: coverageScore = 0
    case 0.01..<0.08: coverageScore = (coverage - 0.01) / 0.07
    case 0.08...0.62: coverageScore = 1
    case 0.62...0.92: coverageScore = max(0, 1 - (coverage - 0.62) / 0.30)
    default: coverageScore = 0
    }

    // A crisp matte has a soft band roughly one pixel wide along its
    // perimeter. Much more than that means the model was unsure everywhere.
    let perimeterProxy = max(0.0001, 4 * (coverage).squareRoot() / Double(ImageStats.analysisMaxSide))
    let softRatio = stats.softFraction / perimeterProxy
    let crispness = min(1, max(0, 1.5 - softRatio / 4))

    let speckleScore = min(1, max(0, 1 - stats.speckleFraction * 4))

    // Several instances is not itself wrong, but it means "which of these did
    // the child mean" is open, so shade the score down.
    let instanceScore = instanceCount > 1 ? 0.85 : 1.0

    return min(0.95, coverageScore * crispness * speckleScore * instanceScore)
  }
}
