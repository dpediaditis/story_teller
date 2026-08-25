import type { ConfigPlugin } from 'expo/config-plugins';

// TODO(B4): this is currently a pass-through no-op. Wire up:
//   - linking the iOS Vision framework (VNDetectFaceRectanglesRequest,
//     VNGenerateForegroundInstanceMaskRequest for subject lift, VNRecognizeTextRequest
//     for name-like-text detection);
//   - setting the iOS deployment target to 17.0 minimum (VNGenerateForegroundInstanceMaskRequest
//     requires iOS 17+ — the app must gate PapercubVision.isAvailable() on OS version
//     until then, see PapercubVision.types.ts / index.ts stubs);
//   - any required Info.plist / entitlements changes for on-device Vision use.
const withPapercubVision: ConfigPlugin = (config) => {
  return config;
};

export default withPapercubVision;
