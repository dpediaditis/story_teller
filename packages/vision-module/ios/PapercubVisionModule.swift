import ExpoModulesCore
import Foundation

/// The bridge. Everything expensive is dispatched to a user-initiated queue —
/// nothing in this module touches an image on the main thread.
///
/// This file is the entire native surface of the module. There is no
/// networking API imported anywhere in the package.
public class PapercubVisionModule: Module {
  private let work = DispatchQueue(label: "app.papercub.vision.work", qos: .userInitiated)
  private lazy var guidanceMonitor = CaptureGuidanceMonitor()

  public func definition() -> ModuleDefinition {
    Name("PapercubVision")

    Events("onCaptureGuidance")

    /// True only when the native module is present *and* the OS can actually
    /// do the work. In Expo Go the module is absent entirely and the JS side
    /// answers false without ever reaching this.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 16.0, *) { return true }
      return false
    }

    /// Reported separately so the app can explain *why* quality is lower on an
    /// older phone, rather than silently degrading.
    Function("supportsSubjectLift") { () -> Bool in
      SubjectLift.isSupported
    }

    AsyncFunction("isolateDrawing") { (options: IsolateOptionsRecord) -> [String: Any] in
      let result = try IsolationPipeline.isolate(options: IsolationPipeline.Options(
        imageUri: options.imageUri,
        deskew: options.deskew,
        whiteBalance: options.whiteBalance,
        confidenceThreshold: options.confidenceThreshold
      ))
      return result.dictionary
    }
    .runOnQueue(work)

    AsyncFunction("applyManualMask") { (imageUri: String, maskUri: String) -> [String: Any] in
      try IsolationPipeline.applyManualMask(imageUri: imageUri, maskUri: maskUri).dictionary
    }
    .runOnQueue(work)

    AsyncFunction("startCaptureGuidance") { [weak self] () -> Bool in
      guard let self else { return false }
      self.guidanceMonitor.start { [weak self] guidance in
        self?.sendEvent("onCaptureGuidance", guidance.dictionary)
      }
      return true
    }

    AsyncFunction("stopCaptureGuidance") { [weak self] () -> Bool in
      self?.guidanceMonitor.stop()
      return true
    }

    OnDestroy { [weak self] in
      self?.guidanceMonitor.stop()
    }
  }
}

struct IsolateOptionsRecord: Record {
  @Field var imageUri: String = ""
  @Field var deskew: Bool = true
  @Field var whiteBalance: Bool = true
  @Field var confidenceThreshold: Double = 0.6
}
