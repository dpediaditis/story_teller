import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

/// The path that matters more than the happy path.
///
/// Subject lifting is trained on photographic subjects; a pale pencil sketch on
/// white paper has almost no figure/ground separation and it either lifts the
/// whole sheet or nothing at all. Adaptive thresholding does not care: it asks
/// only "is this pixel darker than its neighbourhood", which is exactly what
/// pencil on paper is.
enum InkExtractor {
  struct Output {
    var cutout: CIImage
    var confidence: Double
  }

  /// Local-mean adaptive threshold, built entirely from stock Core Image
  /// filters so there is no custom kernel to fail to compile on a device:
  ///
  ///   grey        = desaturated source
  ///   localMean   = box blur of grey, radius scaled to the image
  ///   inkStrength = localMean − grey        (positive where darker than local paper)
  ///   alpha       = clamp((inkStrength − bias) × gain)
  ///
  /// The result is used as the alpha of the *original colour* image, so a
  /// blue pencil stays blue instead of becoming a black silhouette.
  static func extract(from image: CIImage, analysis: ImageStats.Analysis) throws -> Output {
    let extent = image.extent
    let minSide = min(extent.width, extent.height)
    // Neighbourhood ≈ 4% of the short side: wide enough to span a stroke and
    // its paper, narrow enough to track a lighting gradient across the sheet.
    let radius = Float(max(4, min(80, minSide * 0.04)))

    let mono = CIFilter.colorControls()
    mono.inputImage = image
    mono.saturation = 0
    mono.brightness = 0
    mono.contrast = 1
    guard let grey = mono.outputImage else { throw PrivateImageIO.Failure.encodeFailed }

    let blur = CIFilter.boxBlur()
    blur.inputImage = grey.clampedToExtent()
    blur.radius = radius
    guard let localMean = blur.outputImage?.cropped(to: extent) else {
      throw PrivateImageIO.Failure.encodeFailed
    }

    let subtract = CIFilter.subtractBlendMode()
    subtract.inputImage = grey            // foreground, subtracted
    subtract.backgroundImage = localMean  // background
    guard let inkStrength = subtract.outputImage?.cropped(to: extent) else {
      throw PrivateImageIO.Failure.encodeFailed
    }

    // Faint pencil needs more gain than crayon. Anchor the gain on the
    // measured paper/ink contrast so a dark drawing is not blown into a blob.
    let contrast = max(0.02, analysis.inkContrast)
    let gain = CGFloat(min(26, max(6, 0.9 / contrast)))
    let bias = CGFloat(0.012)

    let boost = CIFilter.colorMatrix()
    boost.inputImage = inkStrength
    boost.rVector = CIVector(x: gain, y: 0, z: 0, w: 0)
    boost.gVector = CIVector(x: 0, y: gain, z: 0, w: 0)
    boost.bVector = CIVector(x: 0, y: 0, z: gain, w: 0)
    boost.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    boost.biasVector = CIVector(x: -bias * gain, y: -bias * gain, z: -bias * gain, w: 0)
    guard let boosted = boost.outputImage else { throw PrivateImageIO.Failure.encodeFailed }

    let clamp = CIFilter.colorClamp()
    clamp.inputImage = boosted
    clamp.minComponents = CIVector(x: 0, y: 0, z: 0, w: 0)
    clamp.maxComponents = CIVector(x: 1, y: 1, z: 1, w: 1)
    guard let clamped = clamp.outputImage else { throw PrivateImageIO.Failure.encodeFailed }

    // Close single-pixel gaps in a stroke without fattening the whole matte.
    let smooth = CIFilter.morphologyMaximum()
    smooth.inputImage = clamped.clampedToExtent()
    smooth.radius = 1
    let closed = (smooth.outputImage ?? clamped).cropped(to: extent)

    let toAlpha = CIFilter.maskToAlpha()
    toAlpha.inputImage = closed
    guard let alphaMask = toAlpha.outputImage else { throw PrivateImageIO.Failure.encodeFailed }

    let blend = CIFilter.blendWithMask()
    blend.inputImage = image
    blend.backgroundImage = CIImage.empty()
    blend.maskImage = alphaMask
    guard let cutout = blend.outputImage?.cropped(to: extent) else {
      throw PrivateImageIO.Failure.encodeFailed
    }

    let stats = try ImageStats.matteStats(alphaOf: cutout)
    return Output(cutout: cutout, confidence: score(stats: stats, analysis: analysis))
  }

  /// Ink extraction fails in two directions: nothing survives the threshold
  /// (a blank sheet), or the paper texture survives it (speckle everywhere).
  ///
  /// Note what is *not* used here: a tight coverage band. Line art legitimately
  /// covers 1–3% of the sheet, so scoring on coverage alone punishes exactly
  /// the drawings this path exists for. Instead the matte is compared with the
  /// dark pixels the analysis measured independently — "did we extract the ink
  /// that is actually there" — which also correctly marks down the case where
  /// this path is used on a filled crayon drawing and returns only its outline.
  ///
  /// The ceiling is 0.88, below subject lift's, because a threshold has no idea
  /// what a subject is.
  static func score(stats: ImageStats.MatteStats, analysis: ImageStats.Analysis) -> Double {
    let coverage = stats.coverage

    // Nothing there, or everything there. Both are failures, not near-misses.
    guard coverage >= 0.004, coverage <= 0.85, analysis.inkCoverage >= 0.006 else { return 0 }

    // Ramps to full by 2% coverage; below that we are looking at a few marks.
    let presence = min(1, max(0, (coverage - 0.004) / 0.016))

    // How separable ink and paper were. Under ~5% is a coin toss.
    let contrastScore = min(1, max(0, (analysis.inkContrast - 0.05) / 0.20))

    // Speckle matters, but gently: a one-pixel pencil line is inherently
    // speckly once the analysis buffer downsamples it.
    let speckleScore = min(1, max(0, 1 - stats.speckleFraction * 0.8))

    // Agreement between what we cut out and what the image said was there.
    let expected = analysis.inkCoverage
    let agreement = 1 - abs(coverage - expected) / max(coverage, expected)

    let quality = 0.30 * contrastScore + 0.25 * speckleScore + 0.45 * max(0, agreement)
    return min(0.88, presence * (0.35 + 0.65 * quality))
  }
}
