// Real-WASM regression suite for synthesis epic M2.2 (routing): the
// compiler artefact must carry patch-graph edges (`connections`) and the
// per-(node, param) control channel table for multi-node programs, with
// eval-commit validation of references and cycles
// (src-useq synth-nodes.md §4, §5.1.3, §7.2.1/§7.2.2).
//
// This deliberately runs against the real interpreter WASM artifact
// (public/wasm/useq.wasm, regenerated via `npm run build:assets`) — no
// mocked interpreter. App-side consumption of these artefacts (commit
// plan → worklet deltas → simulated worklet core execution) is covered by
// src/audio/synthRoutingIntegration.test.ts.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadInterpreter() {
  const wasmBinary = readFileSync(resolve(root, "public/wasm/useq.wasm"));
  const glueSource = readFileSync(resolve(root, "public/wasm/useq.js"), "utf8");
  const createModule = new Function(`${glueSource}; return createModule;`)();
  const mod = await createModule({ wasmBinary });
  mod.ccall("useq_init", null, [], []);
  return mod;
}

describe("synth routing through real WASM (M2.2)", () => {
  let mod;

  const evalResult = (code) => mod.ccall("useq_eval", "string", ["string"], [code]);
  const evalOk = (code) => !evalResult(code).startsWith("Error");
  const artifacts = () => JSON.parse(mod.ccall("useq_synth_artifacts", "string", [], []));

  beforeEach(async () => {
    mod = await loadInterpreter();
  });

  it("compiles a two-node (node ...) chain into declarations + a connection", () => {
    expect(evalOk('(synth "osc/sine" :name "lfo" :freq 2 :amp 110)')).to.equal(true);
    expect(evalOk('(synth "osc/sine" :name "car" :freq 440 :fm (node "lfo"))')).to.equal(true);

    const snap = artifacts();
    expect(snap.abi).to.equal(1);
    expect(snap.declarations).to.have.length(2);
    expect(snap.connections).to.deep.equal([
      { from: "lfo", to: "car", port: "fm", port_index: 0 },
    ]);
  });

  it("keys the control table per (node, param)", () => {
    expect(
      evalOk(
        '(do (synth "osc/sine" :name "lfo" :freq 2 :amp 110) ' +
          '    (synth "osc/sine" :name "car" :freq 440 :fm (node "lfo")))',
      ),
    ).to.equal(true);

    const snap = artifacts();
    const rows = snap.controls.map((c) => `${c.identity}:${c.param}`).sort();
    // Each node's bound params get distinct rows; :fm is an edge, never
    // a control channel.
    expect(rows).to.deep.equal(["car:freq", "lfo:amp", "lfo:freq"]);
    for (const c of snap.controls) {
      expect(c.rate).to.equal("block");
    }
  });

  it("compiles the nested inline FM form into a two-node chain", () => {
    // The M2.2 acceptance program: sine into sine's fm audio input.
    expect(
      evalOk('(synth "osc/sine" :name "car" :freq 440 :fm (synth "osc/sine" :freq 2 :amp 110))'),
    ).to.equal(true);

    const snap = artifacts();
    expect(snap.declarations).to.have.length(2);
    expect(snap.connections).to.have.length(1);
    const conn = snap.connections[0];
    expect(conn.to).to.equal("car");
    expect(conn.port).to.equal("fm");
    // The nested child is a real declaration.
    const childDecl = snap.declarations.find((d) => d.identity === conn.from);
    expect(childDecl).to.not.equal(undefined);
    expect(childDecl.def).to.equal("osc/sine");

    // Re-eval updates in place: same shape, no identity growth.
    expect(
      evalOk('(synth "osc/sine" :name "car" :freq 440 :fm (synth "osc/sine" :freq 3 :amp 110))'),
    ).to.equal(true);
    const snap2 = artifacts();
    expect(snap2.declarations).to.have.length(2);
    expect(snap2.connections).to.have.length(1);
  });

  it("rejects an unresolved (node ...) reference transactionally", () => {
    expect(evalOk('(synth "osc/sine" :name "lfo" :freq 2)')).to.equal(true);
    const before = artifacts();

    const result = evalResult('(synth "osc/sine" :name "car" :freq 440 :fm (node "ghost"))');
    expect(result.startsWith("Error"), result).to.equal(true);

    // Failed evals are no-ops: revision and graph unchanged.
    const after = artifacts();
    expect(after.revision).to.equal(before.revision);
    expect(after.declarations).to.deep.equal(before.declarations);
    expect(after.connections).to.deep.equal(before.connections);
  });

  it("rejects a jointly-formed cycle at eval commit", () => {
    expect(evalOk('(synth "osc/sine" :name "a" :freq 440)')).to.equal(true);
    expect(evalOk('(synth "osc/sine" :name "b" :freq 2 :fm (node "a"))')).to.equal(true);
    const before = artifacts();

    // Individually acyclic, jointly a cycle (synth-nodes.md §4.5).
    expect(evalOk('(synth "osc/sine" :name "a" :freq 440 :fm (node "b"))')).to.equal(false);

    const after = artifacts();
    expect(after.revision).to.equal(before.revision);
    expect(after.connections).to.deep.equal([
      { from: "a", to: "b", port: "fm", port_index: 0 },
    ]);
  });
});
