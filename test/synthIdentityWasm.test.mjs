// Real-WASM regression test for ergo e58f128f: with-state-id wrapper
// identity must survive into the synth declaration so an unnamed
// (editor-wrapped) synth re-evals click-free as update-in-place
// (src-useq synth-nodes.md §5.1.1/§5.5, state-identity.md §2.2).
//
// This deliberately runs against the real interpreter WASM artifact
// (public/wasm/useq.wasm, regenerated via `npm run build:assets`) — no
// mocked interpreter. The wrapper shape evaluated here is exactly what
// the editor payload builder emits for an anonymous top-level synth form
// (src/editors/extensions/stateIdentity/evalPayload.ts, covered
// separately by evalPayload.test.ts / evalPayloadIntegration.test.ts).
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadInterpreter() {
  const wasmBinary = readFileSync(resolve(root, "public/wasm/useq.wasm"));
  const glueSource = readFileSync(resolve(root, "public/wasm/useq.js"), "utf8");
  // The emscripten glue is built with ENVIRONMENT='web' and MODULARIZE=1
  // but does not export; evaluate it in a function scope and return the
  // factory. The generated bundle deliberately excludes `wasmBinary` from
  // its incoming Module API, so instantiate explicitly under Node.
  const createModule = new Function(`${glueSource}; return createModule;`)();
  const mod = await createModule({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) =>
        receiveInstance(instance));
      return {};
    },
  });
  mod.ccall("useq_init", null, [], []);
  return mod;
}

describe("synth identity through real WASM (ergo e58f128f)", () => {
  let mod;

  // useq_eval returns a result string; failures come back as "Error: ...".
  const evalResult = (code) => mod.ccall("useq_eval", "string", ["string"], [code]);
  const evalOk = (code) => !evalResult(code).startsWith("Error");
  const artifacts = () => JSON.parse(mod.ccall("useq_synth_artifacts", "string", [], []));

  beforeEach(async () => {
    mod = await loadInterpreter();
  });

  it("re-evals a with-state-id-wrapped anonymous synth click-free across 3+ re-evals", () => {
    const freqs = [440, 660, 660, 550];
    for (const freq of freqs) {
      const code = `(with-state-id "sid-anon" (synth "osc/sine" :freq ${freq}))`;
      const result = evalResult(code);
      expect(result.startsWith("Error"), `eval at :freq ${freq} failed: ${result}`).to.equal(false);
      const snap = artifacts();
      expect(snap.declarations).to.have.length(1);
      expect(snap.declarations[0].identity).to.equal("sid-anon");
    }
  });

  it("prefers explicit :name over the wrapper id", () => {
    const result = evalResult('(with-state-id "sid-x" (synth "osc/sine" :name "lead" :freq 440))');
    expect(result.startsWith("Error"), result).to.equal(false);
    const snap = artifacts();
    expect(snap.declarations).to.have.length(1);
    expect(snap.declarations[0].identity).to.equal("lead");
  });

  it("lets distinct identities coexist (M2.2 multi-node; M1 cap lifted)", () => {
    expect(evalOk('(with-state-id "sid-a" (synth "osc/sine" :freq 440))')).to.equal(true);
    expect(evalOk('(with-state-id "sid-b" (synth "osc/sine" :freq 220))')).to.equal(true);
    const snap = artifacts();
    expect(snap.declarations).to.have.length(2);
    const ids = snap.declarations.map((d) => d.identity).sort();
    expect(ids).to.deep.equal(["sid-a", "sid-b"]);
  });

  it("binds the wrapper id to the outermost form; nested anonymous take ordinals", () => {
    // synth-nodes.md §5.1.1/§5.1.3: identity resolves in pre-order, so
    // the wrapper id lands on the outer form and the nested anonymous
    // child takes the first per-eval ordinal — stably across re-evals.
    for (const freq of [2, 3]) {
      const result = evalResult(
        `(with-state-id "sid-n" (synth "osc/sine" :freq 440 :fm (synth "osc/sine" :freq ${freq})))`,
      );
      expect(result.startsWith("Error"), result).to.equal(false);
      const snap = artifacts();
      expect(snap.declarations).to.have.length(2);
      const ids = snap.declarations.map((d) => d.identity).sort();
      expect(ids).to.deep.equal(["::anon-0", "sid-n"]);
      expect(snap.connections).to.deep.equal([
        { from: "::anon-0", to: "sid-n", port: "fm", port_index: 0 },
      ]);
    }
  });
});
