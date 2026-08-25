// Expo looks for this file to resolve `@papercub/vision-module` as a config
// plugin. The real implementation lives in plugin/withPapercubVision.ts and is
// filled in by agent B4 (Vision framework linking, iOS 17 minimum target).
// Until then this is a pass-through so `expo prebuild` and `expo start` do not
// warn. Config plugins do not run in Expo Go at all, so this is only relevant
// once development builds begin.
module.exports = (config) => config;
