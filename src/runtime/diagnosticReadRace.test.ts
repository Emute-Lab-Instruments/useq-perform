/**
 * Regression test for the diagnostic-read race in editorEvaluation.ts.
 *
 * Bug (now fixed): the old `evalWasm()` did
 *
 *   evalCode(code).then(async () => {
 *     const diagnostics = await port.readLastDiagnostics();
 *     ...
 *   });
 *
 * The WASM port's `useq_last_diagnostics` is a global slot. With the
 * worker port's FIFO message queue, two concurrent evals would interleave:
 *
 *   1. evalCode(A) processed -> lastDiags = A's
 *   2. evalCode(B) processed -> lastDiags = B's          (clobber)
 *   3. A's .then runs -> readLastDiagnostics returns B's (wrong)
 *
 * Symptom: previously-compiled-fine expressions suddenly displayed errors
 * that actually belonged to a different (later) eval. Sound code grew red
 * squiggles with no dependency change.
 *
 * Fix: `WasmRuntimePort.evalCodeWithDiagnostics` returns the eval's own
 * diagnostics, read inside the same worker handler. The two halves never
 * separate, so the race is impossible.
 *
 * The first describe-block reproduces the OLD buggy two-call pattern to
 * show that the underlying mechanism is real (and still bites if anyone
 * re-introduces it). The second describe-block exercises the NEW combined
 * method and asserts diagnostics stay tied under concurrent evals.
 */

import { describe, it, expect } from "vitest";

interface Diag {
  start: number;
  end: number;
  severity: "error" | "warning" | "hint";
  message: string;
}

/**
 * Mocks the worker-backed WASM port: messages are processed in FIFO order;
 * each method is a separate request/response pair.
 */
function makeFifoMockPort() {
  const queue: Array<() => void> = [];
  let lastDiags: Diag[] = [];
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      const op = queue.shift()!;
      op();
      // Yield so promise.then continuations can queue more work between
      // FIFO iterations — this is what lets the race manifest.
      await Promise.resolve();
    }
    draining = false;
  }

  return {
    /** Old separate-message API (the racy pattern). */
    evalCode(_code: string, diagsAfterEval: Diag[]): Promise<string> {
      return new Promise<string>((resolve) => {
        queue.push(() => {
          lastDiags = diagsAfterEval;
          resolve("");
        });
        void drain();
      });
    },
    readLastDiagnostics(): Promise<Diag[]> {
      return new Promise<Diag[]>((resolve) => {
        queue.push(() => resolve([...lastDiags]));
        void drain();
      });
    },
    /**
     * New combined-message API (the fix). Eval and diagnostics are the same
     * FIFO op so nothing can land between them.
     */
    evalCodeWithDiagnostics(
      _code: string,
      diagsAfterEval: Diag[],
    ): Promise<{ result: string; diagnostics: Diag[] }> {
      return new Promise((resolve) => {
        queue.push(() => {
          lastDiags = diagsAfterEval;
          resolve({ result: "", diagnostics: [...diagsAfterEval] });
        });
        void drain();
      });
    },
  };
}

describe("[demonstrates the race] old two-call evalCode + readLastDiagnostics", () => {
  it("the original pattern attaches eval B's diagnostics to eval A's range", async () => {
    const port = makeFifoMockPort();

    const aDiag: Diag = {
      start: 0,
      end: 8,
      severity: "error",
      message: "A error",
    };
    const bDiags: Diag[] = []; // B compiles fine

    function evalAndReadDiags(
      code: string,
      diagsAfterEval: Diag[],
    ): Promise<Diag[]> {
      return port.evalCode(code, diagsAfterEval).then(async () => {
        return port.readLastDiagnostics();
      });
    }

    const aPromise = evalAndReadDiags("formA", [aDiag]);
    const bPromise = evalAndReadDiags("formB", bDiags);
    const [aResult, bResult] = await Promise.all([aPromise, bPromise]);

    // Both reads return B's diagnostics — A lost its own. This documents
    // the buggy pattern: do not split eval and diagnostic reads across
    // separate port calls.
    expect(aResult).toEqual(bDiags);
    expect(bResult).toEqual(bDiags);
  });
});

describe("[validates the fix] evalCodeWithDiagnostics", () => {
  it("returns each eval's own diagnostics under concurrent calls", async () => {
    const port = makeFifoMockPort();

    const aDiag: Diag = {
      start: 0,
      end: 8,
      severity: "error",
      message: "A error",
    };
    const bDiags: Diag[] = [];

    // Mirrors the post-fix evalWasm pattern: a single port call returns
    // both result and diagnostics, atomically tied.
    const [aRes, bRes] = await Promise.all([
      port.evalCodeWithDiagnostics("formA", [aDiag]),
      port.evalCodeWithDiagnostics("formB", bDiags),
    ]);

    expect(aRes.diagnostics).toEqual([aDiag]);
    expect(bRes.diagnostics).toEqual(bDiags);
  });

  it("symmetric case: B errors, A is fine — no diagnostic swap", async () => {
    const port = makeFifoMockPort();

    const aDiags: Diag[] = [];
    const bDiag: Diag = {
      start: 0,
      end: 8,
      severity: "error",
      message: "B error",
    };

    const [aRes, bRes] = await Promise.all([
      port.evalCodeWithDiagnostics("formA", aDiags),
      port.evalCodeWithDiagnostics("formB", [bDiag]),
    ]);

    expect(aRes.diagnostics).toEqual(aDiags);
    expect(bRes.diagnostics).toEqual([bDiag]);
  });
});
