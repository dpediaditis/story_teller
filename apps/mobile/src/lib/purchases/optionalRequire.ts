/**
 * `react-native-purchases` is NOT installed in this app yet (see this
 * package's handover report). `packages/vision-module/src/index.ts` guards
 * an absent NATIVE module with Expo's `requireOptionalNativeModule`, which
 * only covers modules registered in the Expo native module registry —
 * `react-native-purchases` is a plain npm package, so that API doesn't apply
 * here. The equivalent for a plain JS/native package is to keep its module
 * specifier out of Metro's static require graph, so a missing package fails
 * softly at runtime instead of failing the whole bundle build.
 *
 * `require('react-native-purchases')` written as a literal would be resolved
 * by Metro at bundle time regardless of any surrounding try/catch, and bundling
 * would fail outright while the package is absent. Building the specifier
 * from a variable via `Function('m', 'return require(m)')` keeps the literal
 * string out of Metro's static analysis, so it only ever fails at runtime —
 * inside this function's own try/catch — exactly like
 * `requireOptionalNativeModule` returning null.
 */
export function optionalRequire<T>(moduleName: string): T | null {
  try {
    // eslint-disable-next-line no-new-func
    const dynamicRequire = new Function('m', 'return require(m);') as (m: string) => T;
    return dynamicRequire(moduleName);
  } catch {
    return null;
  }
}
