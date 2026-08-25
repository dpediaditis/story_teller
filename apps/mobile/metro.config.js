// Monorepo-critical: this app lives in a pnpm workspace. Metro's default
// resolution assumes a single flat node_modules under the app itself, which
// breaks when workspace packages (e.g. @papercub/shared) live above it. This
// config widens Metro's watch/resolve roots to the whole workspace and turns
// off hierarchical lookup so it resolves deterministically from these roots
// instead of walking up the directory tree (which can pick up a stray nested
// node_modules and duplicate React/React Native).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so changes to @papercub/shared etc. hot-reload.
config.watchFolders = [workspaceRoot];

// Resolve modules from this app's node_modules first, then the hoisted
// workspace-root node_modules (see .npmrc: node-linker=hoisted).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Do not climb outside the declared roots looking for modules.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
