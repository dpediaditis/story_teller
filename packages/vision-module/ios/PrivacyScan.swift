import CoreGraphics
import Foundation
import Vision

/// A photo of a drawing on a kitchen table routinely contains a sibling's face
/// in the background, or the child's full name written across the top of the
/// sheet. Both are detected on-device so the app can warn the parent before
/// anything is uploaded.
///
/// Nothing recognised here is returned, stored or logged. The recognised text
/// never leaves this function's stack — only two booleans do.
enum PrivacyScan {
  struct Findings {
    var faceDetected: Bool
    var nameLikeTextDetected: Bool
  }

  static func scan(_ image: CGImage) -> Findings {
    Findings(
      faceDetected: detectFace(image),
      nameLikeTextDetected: detectNameLikeText(image)
    )
  }

  private static func detectFace(_ image: CGImage) -> Bool {
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      // A detector that failed to run is not evidence of absence, but it is
      // also not something to surface as a false positive. Treat as "no".
      return false
    }
    guard let results = request.results else { return false }
    // Drawn faces trip this too. That is the correct bias: over-warning costs
    // the parent one tap, under-warning uploads a photo of a real child.
    return results.contains { $0.confidence > 0.4 }
  }

  private static func detectNameLikeText(_ image: CGImage) -> Bool {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Language correction would autocorrect names into dictionary words, which
    // is the opposite of what we want here.
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.015

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return false
    }
    guard let observations = request.results else { return false }

    for observation in observations {
      guard let candidate = observation.topCandidates(1).first, candidate.confidence > 0.3 else { continue }
      if containsNameLikeToken(candidate.string) { return true }
    }
    return false
  }

  /// Deliberately over-inclusive. Any capitalised or all-caps alphabetic word
  /// that is not an obvious common word counts as name-like: the cost of a
  /// false positive is a review prompt, the cost of a false negative is a
  /// child's name in a photo that gets uploaded.
  static func containsNameLikeToken(_ text: String) -> Bool {
    let separators = CharacterSet.alphanumerics.inverted
    for rawToken in text.components(separatedBy: separators) {
      let token = rawToken.trimmingCharacters(in: .whitespaces)
      guard token.count >= 3, token.count <= 24 else { continue }
      guard token.allSatisfy({ $0.isLetter }) else { continue }
      if commonWords.contains(token.lowercased()) { continue }

      let first = token.first!
      let rest = token.dropFirst()
      let isTitleCase = first.isUppercase && rest.allSatisfy { $0.isLowercase }
      let isAllCaps = token.allSatisfy { $0.isUppercase }
      if isTitleCase || isAllCaps { return true }
    }
    return false
  }

  /// Small stop-list of words a child or a packaging label plausibly writes in
  /// caps or title case that are not names. Kept short on purpose — anything
  /// not here is treated as a possible name.
  private static let commonWords: Set<String> = [
    "the", "and", "for", "you", "her", "his", "our", "mum", "mom", "dad",
    "cat", "dog", "sun", "day", "one", "two", "three", "red", "blue", "green",
    "yellow", "pink", "black", "white", "happy", "love", "best", "friend",
    "birthday", "school", "class", "home", "hello", "thank", "thanks",
    "story", "book", "page", "paper", "crayon", "pencil", "colour", "color",
    "och", "det", "den", "hej", "mamma", "pappa", "tack", "hus", "sol",
    "und", "der", "die", "das", "ist", "ich", "sie", "wir", "hund", "katze",
    "les", "des", "une", "est", "elle", "avec", "pour", "chat", "chien"
  ]
}
