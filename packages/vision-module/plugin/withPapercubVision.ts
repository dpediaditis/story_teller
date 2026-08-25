import type { ConfigPlugin } from 'expo/config-plugins';

// The implementation is in ../app.plugin.js. It is plain CommonJS because this
// package has no build step, and Expo must be able to `require` the plugin
// without a TypeScript loader. This file is the typed entry point: it exists so
// the plugin is type-checked as a ConfigPlugin like everything else.
//
// What it does:
//   - sets the iOS deployment target to 17.0 (Podfile properties + Xcode build
//     settings), so VNGenerateForegroundInstanceMaskRequest is always present;
//   - adds NSCameraUsageDescription / NSPhotoLibraryUsageDescription only when
//     the app has not already set them;
//   - relies on ios/PapercubVision.podspec to link Vision, CoreImage,
//     AVFoundation and ImageIO.
//
// It adds no entitlement and requests no capability: this module does purely
// local computation and has no network code at all.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withPapercubVision: ConfigPlugin = require('../app.plugin.js');

export default withPapercubVision;
