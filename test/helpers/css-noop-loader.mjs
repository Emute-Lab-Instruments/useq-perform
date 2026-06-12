// Node module-loader hook: resolve any `.css` import to an empty module.
// Vite handles CSS imports in the app build; under mocha (plain node + tsx)
// they would throw ERR_UNKNOWN_FILE_EXTENSION. Registered via .mocharc.yml
// node-option `import=./test/helpers/register-css-loader.mjs`.
export async function load(url, context, nextLoad) {
  if (url.split("?")[0].endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export default {};" };
  }
  return nextLoad(url, context);
}
