// Expo resolves `@papercub/vision-module` as a config plugin through this file.
//
// The implementation lives here, in plain CommonJS, rather than in
// plugin/withPapercubVision.ts, for one practical reason: this package has no
// build step (`main` points straight at `src/index.ts`), so there would be no
// compiled JS for Expo to require. plugin/withPapercubVision.ts is the typed
// entry point and re-exports this module, so both paths stay in sync.
//
// Config plugins do not run in Expo Go at all — this only takes effect once
// `expo prebuild` / a development build is used.

const { withInfoPlist, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');

// VNGenerateForegroundInstanceMaskRequest (subject lifting) is iOS 17+.
// The pod itself supports iOS 16 and degrades to ink extraction there, but the
// app targets 17 so the primary path is always available.
const IOS_DEPLOYMENT_TARGET = '17.0';

const CAMERA_USAGE =
  'Papercub uses the camera to photograph your child’s drawing. The photo is processed on this device.';
const PHOTOS_USAGE =
  'Papercub reads the drawing you pick from your library. It is processed on this device.';

/** iOS 17 minimum, so the subject-lifting request is always present. */
const withDeploymentTarget = (config) => {
  const withProperties = withPodfileProperties(config, (cfg) => {
    cfg.modResults['ios.deploymentTarget'] = IOS_DEPLOYMENT_TARGET;
    return cfg;
  });

  return withXcodeProject(withProperties, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (!buildSettings || buildSettings.IPHONEOS_DEPLOYMENT_TARGET === undefined) continue;
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
    }
    return cfg;
  });
};

/**
 * Usage strings only. This module asks for no permission of its own and holds
 * no entitlement: everything it does is local computation on a file the app
 * already has. Existing values are never overwritten — the app owns its copy.
 */
const withUsageDescriptions = (config) =>
  withInfoPlist(config, (cfg) => {
    if (!cfg.modResults.NSCameraUsageDescription) {
      cfg.modResults.NSCameraUsageDescription = CAMERA_USAGE;
    }
    if (!cfg.modResults.NSPhotoLibraryUsageDescription) {
      cfg.modResults.NSPhotoLibraryUsageDescription = PHOTOS_USAGE;
    }
    return cfg;
  });

/**
 * The Vision, CoreImage, AVFoundation and ImageIO frameworks are linked by
 * ios/PapercubVision.podspec (`s.frameworks`), which is the supported way to
 * do it for an Expo module; adding them again through the Xcode project would
 * duplicate the link flags.
 */
const withPapercubVision = (config) => withUsageDescriptions(withDeploymentTarget(config));

module.exports = withPapercubVision;
