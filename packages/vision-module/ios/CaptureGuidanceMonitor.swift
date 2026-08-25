import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import Vision

/// Live "hold it like this" signals for the camera screen.
///
/// Frames are analysed and discarded in the same call. No frame is written to
/// disk, retained, or described anywhere — the only thing that leaves this
/// class is four booleans.
///
/// IMPORTANT (see the module report): this owns its own `AVCaptureSession`. iOS
/// gives the camera to one session at a time, so the capture screen must take
/// its preview from this session's `previewSource` rather than starting a
/// second one.
final class CaptureGuidanceMonitor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  struct Guidance: Equatable {
    var paperDetected = false
    var glareDetected = false
    var edgeCutOff = false
    var steady = false

    var dictionary: [String: Any] {
      [
        "paperDetected": paperDetected,
        "glareDetected": glareDetected,
        "edgeCutOff": edgeCutOff,
        "steady": steady
      ]
    }
  }

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "app.papercub.vision.guidance.session")
  private let analysisQueue = DispatchQueue(label: "app.papercub.vision.guidance.analysis")
  private var output: AVCaptureVideoDataOutput?

  private var onGuidance: ((Guidance) -> Void)?
  private var lastEmitted: Guidance?
  private var lastAnalysis = Date.distantPast
  private var previousLumaGrid: [Double]?
  private var steadyFrames = 0
  private var isRunning = false

  /// Minimum gap between analysed frames. Vision rectangle detection at 60 fps
  /// would cook the phone for no benefit; six a second is well past what a
  /// human reads as "live".
  private let analysisInterval: TimeInterval = 1.0 / 6.0

  /// The preview layer the capture screen should display, so that only one
  /// session ever touches the camera.
  var previewSource: AVCaptureSession { session }

  func start(onGuidance: @escaping (Guidance) -> Void) {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      self.onGuidance = onGuidance
      guard !self.isRunning else { return }

      // We never ask for permission here — the app owns that conversation.
      // Without it, the session simply produces no frames and no guidance.
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { return }

      self.session.beginConfiguration()
      self.session.sessionPreset = .vga640x480

      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device),
            self.session.canAddInput(input) else {
        self.session.commitConfiguration()
        return
      }
      self.session.addInput(input)

      let videoOutput = AVCaptureVideoDataOutput()
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
      ]
      videoOutput.setSampleBufferDelegate(self, queue: self.analysisQueue)
      guard self.session.canAddOutput(videoOutput) else {
        self.session.commitConfiguration()
        return
      }
      self.session.addOutput(videoOutput)
      self.output = videoOutput
      self.session.commitConfiguration()

      self.session.startRunning()
      self.isRunning = true
    }
  }

  func stop() {
    sessionQueue.async { [weak self] in
      guard let self, self.isRunning else { return }
      self.session.stopRunning()
      self.output?.setSampleBufferDelegate(nil, queue: nil)
      self.isRunning = false
      self.onGuidance = nil
      self.previousLumaGrid = nil
      self.lastEmitted = nil
      self.steadyFrames = 0
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = Date()
    guard now.timeIntervalSince(lastAnalysis) >= analysisInterval else { return }
    lastAnalysis = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let grid = lumaGrid(from: pixelBuffer)
    var guidance = Guidance()

    // Glare: clipped highlights are what a ceiling light does to glossy paper.
    if !grid.isEmpty {
      let blown = grid.filter { $0 > 0.965 }.count
      guidance.glareDetected = Double(blown) / Double(grid.count) > 0.02
    }

    // Steadiness: frame-to-frame change of the same coarse grid. Three quiet
    // frames in a row before we call it steady, so it does not flicker.
    if let previous = previousLumaGrid, previous.count == grid.count, !grid.isEmpty {
      var delta = 0.0
      for i in 0..<grid.count { delta += abs(grid[i] - previous[i]) }
      delta /= Double(grid.count)
      steadyFrames = delta < 0.012 ? min(steadyFrames + 1, 3) : 0
    } else {
      steadyFrames = 0
    }
    guidance.steady = steadyFrames >= 3
    previousLumaGrid = grid

    // Paper: the same rectangle detector the still pipeline uses, so what the
    // guidance promises is what the isolation will actually find.
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    let request = VNDetectRectanglesRequest()
    request.minimumAspectRatio = 0.35
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.2
    request.minimumConfidence = 0.5
    request.quadratureTolerance = 30
    request.maximumObservations = 4
    if (try? handler.perform([request])) != nil,
       let observation = request.results?.max(by: { lhs, rhs in
         lhs.boundingBox.width * lhs.boundingBox.height < rhs.boundingBox.width * rhs.boundingBox.height
       }) {
      guidance.paperDetected = true
      let corners = [observation.topLeft, observation.topRight, observation.bottomLeft, observation.bottomRight]
      let margin: CGFloat = 0.02
      guidance.edgeCutOff = corners.contains { p in
        p.x <= margin || p.x >= 1 - margin || p.y <= margin || p.y >= 1 - margin
      }
    } else {
      // No rectangle at all usually means the sheet runs past the frame.
      guidance.paperDetected = false
      guidance.edgeCutOff = false
    }

    guard guidance != lastEmitted else { return }
    lastEmitted = guidance
    onGuidance?(guidance)
  }

  /// 16×16 luma samples straight off the Y plane. Cheap, and it never copies
  /// the frame.
  private func lumaGrid(from buffer: CVPixelBuffer) -> [Double] {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

    guard CVPixelBufferGetPlaneCount(buffer) > 0,
          let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return [] }
    let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
    let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    guard width > 16, height > 16 else { return [] }

    let pointer = base.assumingMemoryBound(to: UInt8.self)
    var grid: [Double] = []
    grid.reserveCapacity(256)
    for gy in 0..<16 {
      let y = height * gy / 16 + height / 32
      for gx in 0..<16 {
        let x = width * gx / 16 + width / 32
        grid.append(Double(pointer[y * rowBytes + x]) / 255)
      }
    }
    return grid
  }
}
