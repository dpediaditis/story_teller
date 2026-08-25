import CoreImage
import Foundation

/// Cheap CPU statistics computed on a downscaled buffer. Nothing here is
/// logged, persisted or transmitted — the numbers exist only to pick a
/// pipeline and to score the result.
enum ImageStats {
  struct Analysis {
    /// Mean HSV saturation over pixels that are darker than the paper.
    var inkSaturation: Double
    /// Fraction of pixels whose local gradient exceeds a hand-set threshold.
    var edgeDensity: Double
    /// Fraction of pixels meaningfully darker than the estimated paper white.
    var inkCoverage: Double
    /// Estimated paper luminance (95th percentile).
    var paperLuma: Double
    /// Mean luminance of the ink pixels.
    var inkLuma: Double

    /// Contrast between paper and ink, 0..1.
    var inkContrast: Double { max(0, paperLuma - inkLuma) }

    /// How much of the ink is edge. Thin outlines are almost entirely edge;
    /// filled crayon is mostly interior. This, rather than raw edge count, is
    /// what separates line art from a coloured-in drawing — a pale sketch has
    /// *few* edge pixels in absolute terms because it has few pixels at all.
    var edgeToInkRatio: Double { edgeDensity / max(0.002, inkCoverage) }

    /// The documented failure mode of subject lifting: a pale pencil sketch on
    /// white paper, where figure and ground are nearly the same colour.
    /// Measured on the fixtures: pencil ~1.7, bold crayon ~0.3.
    var isSketchLike: Bool {
      inkSaturation < 0.25 && edgeToInkRatio > 0.9 && inkCoverage < 0.35
    }
  }

  /// 512, not 256. A pencil line in a 2048px photo is only a few pixels wide;
  /// at 256 it averages into the paper and disappears, which made a sketch and
  /// a blank sheet measure the same. This is the resolution the fallback
  /// decision depends on, so it is worth the extra milliseconds.
  static let analysisMaxSide: CGFloat = 512

  static func analyse(_ image: CIImage) throws -> Analysis {
    let buffer = try PrivateImageIO.rgbaBuffer(from: image, maxSide: analysisMaxSide)
    let (pixels, width, height) = (buffer.pixels, buffer.width, buffer.height)
    let count = width * height
    guard count > 0 else {
      return Analysis(inkSaturation: 0, edgeDensity: 0, inkCoverage: 0, paperLuma: 1, inkLuma: 1)
    }

    var luma = [Double](repeating: 0, count: count)
    var saturation = [Double](repeating: 0, count: count)
    for i in 0..<count {
      let r = Double(pixels[i * 4]) / 255
      let g = Double(pixels[i * 4 + 1]) / 255
      let b = Double(pixels[i * 4 + 2]) / 255
      luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
      let maxC = max(r, max(g, b)), minC = min(r, min(g, b))
      saturation[i] = maxC > 0.001 ? (maxC - minC) / maxC : 0
    }

    // Paper white as the 95th percentile rather than the maximum, so one
    // specular highlight does not define the reference.
    let sorted = luma.sorted()
    let paperLuma = sorted[min(count - 1, Int(Double(count) * 0.95))]
    let inkThreshold = paperLuma * 0.82

    var inkLumaSum = 0.0
    var inkSatSum = 0.0
    var inkCount = 0
    for i in 0..<count where luma[i] < inkThreshold {
      inkLumaSum += luma[i]
      inkSatSum += saturation[i]
      inkCount += 1
    }

    var edgePixels = 0
    for y in 1..<max(2, height - 1) {
      for x in 1..<max(2, width - 1) {
        let i = y * width + x
        let gx = abs(luma[i + 1] - luma[i - 1])
        let gy = abs(luma[i + width] - luma[i - width])
        if gx + gy > 0.16 { edgePixels += 1 }
      }
    }

    return Analysis(
      inkSaturation: inkCount > 0 ? inkSatSum / Double(inkCount) : 0,
      edgeDensity: Double(edgePixels) / Double(count),
      inkCoverage: Double(inkCount) / Double(count),
      paperLuma: paperLuma,
      inkLuma: inkCount > 0 ? inkLumaSum / Double(inkCount) : paperLuma
    )
  }

  // MARK: - Alpha-matte scoring

  struct MatteStats {
    /// Fraction of the frame the cut-out covers.
    var coverage: Double
    /// Fraction of pixels sitting in the ambiguous middle of the alpha range.
    var softFraction: Double
    /// Fraction of opaque pixels that are surrounded by mostly-empty pixels —
    /// speckle, which is what a bad adaptive threshold produces.
    var speckleFraction: Double
    /// Ratio of covered area to the area of its bounding box.
    var fill: Double
    /// Normalised, **top-down** (row 0 is the top of the image), because that
    /// is how `CIContext.render(toBitmap:)` lays the buffer out. Core Image's
    /// own extent is bottom-up, so anyone converting this to a crop rectangle
    /// must flip Y — verified empirically, see `IsolationPipeline.cropToSubject`.
    var boundingBox: CGRect
  }

  static func matteStats(alphaOf image: CIImage) throws -> MatteStats {
    let buffer = try PrivateImageIO.rgbaBuffer(from: image, maxSide: analysisMaxSide)
    let (pixels, width, height) = (buffer.pixels, buffer.width, buffer.height)
    let count = width * height
    guard count > 0 else {
      return MatteStats(coverage: 0, softFraction: 0, speckleFraction: 1, fill: 0, boundingBox: .zero)
    }

    var alpha = [Double](repeating: 0, count: count)
    var covered = 0
    var soft = 0
    var minX = width, minY = height, maxX = -1, maxY = -1
    for i in 0..<count {
      let a = Double(pixels[i * 4 + 3]) / 255
      alpha[i] = a
      if a > 0.15, a < 0.85 { soft += 1 }
      if a > 0.5 {
        covered += 1
        let x = i % width, y = i / width
        minX = min(minX, x); maxX = max(maxX, x)
        minY = min(minY, y); maxY = max(maxY, y)
      }
    }

    var speckle = 0
    if covered > 0 {
      for y in 1..<max(2, height - 1) {
        for x in 1..<max(2, width - 1) {
          let i = y * width + x
          guard alpha[i] > 0.5 else { continue }
          var neighbours = 0
          for dy in -1...1 {
            for dx in -1...1 where !(dx == 0 && dy == 0) {
              if alpha[i + dy * width + dx] > 0.5 { neighbours += 1 }
            }
          }
          if neighbours <= 2 { speckle += 1 }
        }
      }
    }

    let box: CGRect = maxX >= minX && maxY >= minY
      ? CGRect(x: Double(minX) / Double(width),
               y: Double(minY) / Double(height),
               width: Double(maxX - minX + 1) / Double(width),
               height: Double(maxY - minY + 1) / Double(height))
      : .zero

    let boxArea = Double(box.width * box.height) * Double(count)
    return MatteStats(
      coverage: Double(covered) / Double(count),
      softFraction: Double(soft) / Double(count),
      speckleFraction: covered > 0 ? Double(speckle) / Double(covered) : 1,
      fill: boxArea > 0 ? Double(covered) / boxArea : 0,
      boundingBox: box
    )
  }

  // MARK: - Palette

  /// Dominant colours of the cut-out, most frequent first, as `#rrggbb`.
  /// Only opaque pixels count, so the paper behind the drawing never leaks
  /// into `Character.palette`.
  static func palette(of image: CIImage, maxColours: Int = 5) throws -> [String] {
    let buffer = try PrivateImageIO.rgbaBuffer(from: image, maxSide: 160)
    let (pixels, width, height) = (buffer.pixels, buffer.width, buffer.height)

    var histogram: [Int: (count: Int, sum: SIMD3<Int>)] = [:]
    for i in 0..<(width * height) {
      let a = pixels[i * 4 + 3]
      guard a > 200 else { continue }
      let r = Int(pixels[i * 4]), g = Int(pixels[i * 4 + 1]), b = Int(pixels[i * 4 + 2])
      // Skip near-white halo left by any matte, keep dark ink: black outlines
      // are a real and meaningful part of a child's palette.
      if r > 244 && g > 244 && b > 244 { continue }
      let key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)
      var entry = histogram[key] ?? (0, SIMD3<Int>(0, 0, 0))
      entry.count += 1
      entry.sum &+= SIMD3(r, g, b)
      histogram[key] = entry
    }

    let ranked = histogram.values
      .filter { $0.count > 0 }
      .sorted { $0.count > $1.count }
      .map { entry -> SIMD3<Int> in
        SIMD3(entry.sum.x / entry.count, entry.sum.y / entry.count, entry.sum.z / entry.count)
      }

    var chosen: [SIMD3<Int>] = []
    for colour in ranked {
      guard chosen.count < maxColours else { break }
      // Merge perceptually close buckets so the palette is not five shades of
      // the same crayon.
      let tooClose = chosen.contains { existing in
        let d = SIMD3<Double>(Double(existing.x - colour.x), Double(existing.y - colour.y), Double(existing.z - colour.z))
        return (d.x * d.x + d.y * d.y + d.z * d.z).squareRoot() < 48
      }
      if !tooClose { chosen.append(colour) }
    }

    return chosen.map { String(format: "#%02x%02x%02x", $0.x, $0.y, $0.z) }
  }
}
