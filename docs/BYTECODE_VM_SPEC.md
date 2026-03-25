# Bytecode VM for ModuLisp Interpreter

## Status

**Draft** | March 2026 | Relates to `useq-perform-q3q`

## 1. Motivation

The ModuLisp interpreter currently uses a tree-walking evaluator. For every sample point, `eval_output_internal()` traverses the full AST — at 100 samples x N active channels, this means 300+ complete tree-walks per frame. Each walk allocates temporary `Value` objects, creates environment frames, and performs string-keyed lookups.

A bytecode VM compiles expressions once and executes a flat instruction loop per sample. The expected speedup is 10-50x for tight arithmetic, driven by:

- No AST node allocation per sample
- No environment frame creation per sample
- No string-keyed symbol lookup per sample
- Cache-friendly linear instruction stream
- Register-based instruction format eliminates stack shuffling

## 2. Semantic Model

### 2.1 Signals as Pure Functions

All ModuLisp expressions are **signals** — pure functions from time (plus external inputs) to a scalar output:

```
output = f(time, knob1, knob2, ...) → double
```

Writing `(+ 1 t)` does not mean "add 1 to the current value of t". It creates a signal: a function that, when sampled at a specific time, evaluates to `1 + t`.

### 2.2 Profunctor Structure

Signals support two mapping operations:

- **postmap** (output mapping): `(postmap g signal)` = `g(signal(t))` — transform the output
- **premap** (input mapping): `(premap f signal)` = `signal(f(t))` — warp the input time

The built-in time modifiers are premaps:
- `(fast k expr)` = `(premap (fn [t] (* k t)) expr)`
- `(slow k expr)` = `(premap (fn [t] (/ t k)) expr)`
- `(offset k expr)` = `(premap (fn [t] (+ t k)) expr)`

### 2.3 External Input Slots

The graph is not purely a function of time. A small number of named external inputs (physical knobs, MIDI CCs, sensor values) act as additional constant parameters per sample point. These are leaves in the signal graph alongside temporal variables (`t`, `beat`, `bar`, etc.).

### 2.4 No Hidden State

All built-in functions are pure functions of their inputs:
- `random` must be deterministically seeded (from time or a hash)
- `step` / `euclid` / `gates` / `trigs` derive their state purely from phasor position
- `schedule` is a side-effect that operates at the REPL level, not within the signal graph

## 3. VM Architecture

### 3.1 Register-Based

The VM uses **numbered virtual registers** rather than a stack. Instructions operate directly on register operands:

```
ADD  r0, r1, r2    ; r0 = r1 + r2
SIN  r3, r0        ; r3 = sin(r0)
```

**Rationale**: Arithmetic-heavy signal code benefits from fewer instructions (no push/pop overhead). Register bytecode also maps nearly 1:1 to ARM register instructions, supporting the future JIT path.

### 3.2 Dispatch Abstraction

The dispatch mechanism is compile-time selectable:

- **Computed goto** (`__attribute__((musttail))` or `goto *table[opcode]`) on ARM firmware — eliminates branch prediction penalty
- **Switch dispatch** on WASM — V8/SpiderMonkey JITs optimize the local variables (registers) into CPU registers anyway, so computed goto provides no benefit

Same bytecode format and compiler for both targets. The dispatch is behind a `#ifdef` or template parameter.

### 3.3 Compilation Unit

A **compiled graph** consists of:

- **Instruction buffer**: flat array of bytecode instructions
- **Data segment**: constant pool (scalars, vector data, string literals)
- **Register allocation table**: maps virtual registers to physical slots
- **Dependency set**: set of symbol names this graph transitively references (for invalidation)

### 3.4 Register Allocation

For V1, a simple linear-scan or tree-coloring allocator is sufficient. ModuLisp expressions are trees (or DAGs after CSE) with no complex control flow, making register allocation straightforward.

## 4. Instruction Set

### 4.1 Core Instructions

```
; Arithmetic
ADD     rd, rs1, rs2       ; rd = rs1 + rs2
SUB     rd, rs1, rs2
MUL     rd, rs1, rs2
DIV     rd, rs1, rs2       ; division by zero → error
MOD     rd, rs1, rs2
NEG     rd, rs              ; rd = -rs

; Comparison (result: 1.0 or 0.0)
CMP_GT  rd, rs1, rs2
CMP_LT  rd, rs1, rs2
CMP_GE  rd, rs1, rs2
CMP_LE  rd, rs1, rs2
CMP_EQ  rd, rs1, rs2

; Math
FLOOR   rd, rs
CEIL    rd, rs
ABS     rd, rs
MIN     rd, rs1, rs2
MAX     rd, rs1, rs2
POW     rd, rs1, rs2       ; rd = rs1 ^ rs2
SQRT    rd, rs
CLAMP   rd, rs, rlo, rhi   ; rd = clamp(rs, rlo, rhi)

; Transcendentals (unipolar variants for music: 0..1 range)
SIN     rd, rs             ; rd = sin(rs * 2π) * 0.5 + 0.5 (unipolar)
COS     rd, rs             ; rd = cos(rs * 2π) * 0.5 + 0.5 (unipolar)
TAN     rd, rs
SIN_BI  rd, rs             ; rd = sin(rs * 2π) (bipolar, -1..1)
COS_BI  rd, rs             ; rd = cos(rs * 2π) (bipolar, -1..1)

; Waveform generators (pure functions of phasor)
TRI     rd, rs             ; triangle wave from phasor
SQR     rd, rs             ; square wave from phasor
PULSE   rd, rs1, rs2       ; pulse wave, rs2 = duty cycle
```

### 4.2 Load / Store

```
LOAD_CONST  rd, #imm_idx   ; load from constant pool
LOAD_TIME   rd, channel, scale, offset
                            ; rd = temporal_var(time * scale + offset)
                            ; channel: T, BEAT, BAR, PHRASE, SECTION, BEAT_NUM, BAR_NUM
LOAD_INPUT  rd, #input_id  ; load external input (knob, MIDI CC)
LOAD_VAR    rd, #sym_id    ; late-bound variable lookup (rare, for non-inlinable refs)
MOV         rd, rs          ; rd = rs
```

### 4.3 Vector Operations

```
VEC_INDEX   rd, #data_slot, rs_phasor
    ; rd = data[floor(rs_phasor * len)] with bounds clamping
    ; data_slot references the data segment

VEC_LERP    rd, #data_slot, rs_phasor
    ; rd = lerp(data[i], data[i+1], frac)
    ; linear interpolation between adjacent elements
```

Vector data lives in a **separate data segment**, not inline in the instruction stream. Benefits:
- Large vectors don't bloat instruction cache
- Shared vectors across expressions are deduplicated (same data slot)
- Data segment can be aligned for optimal ARM memory access
- JIT can emit vector base address as an immediate

### 4.4 Control Flow

```
BRANCH      #offset                ; unconditional jump
BRANCH_IF   rs, #offset            ; jump if rs != 0.0
BRANCH_UNLESS rs, #offset          ; jump if rs == 0.0
```

Real branches rather than branchless SELECT. This enables future symbolic interval analysis optimizations (section 8.2).

### 4.5 Function Calls

```
CALL        #func_id, rd, [args...]  ; call compiled function, result in rd
RET         rs                        ; return value from function
CALL_INTRINSIC  #intrinsic_id, rd, [args...]
    ; call opaque C++ intrinsic (for complex builtins with signal args)
```

The compiler **prefers inlining** lambda bodies at call sites. `CALL` is emitted only when inlining is not possible (recursion, very large bodies, explicit opt-out). `CALL_INTRINSIC` is the escape hatch for builtins that can't be expressed as primitives (or whose args are signals, preventing compile-time pre-computation).

### 4.6 Error Handling

```
; No explicit error instructions — errors are handled by the VM dispatch loop.
; On runtime error (div/0, out-of-bounds), the VM:
;   1. Sets an error flag with diagnostic info
;   2. Aborts execution of the current graph
;   3. Falls back to the last-known-good graph (see section 6.3)
```

## 5. Compiler

### 5.1 Pipeline

```
Source text → Parser → AST (Value tree)
    → Compiler frontend:
        1. Symbol resolution (inline known bindings)
        2. Constness analysis (propagate which nodes are compile-time constant)
        3. Constant folding (evaluate constant subexpressions)
        4. Builtin expansion (expand builtins with constant args to pre-computed results)
        5. Time-warp flattening (compose affine transforms, bake into LOAD_TIME)
        6. CSE (common subexpression elimination on the DAG)
    → Register allocation
    → Bytecode emission
    → Compiled graph (instruction buffer + data segment + dependency set)
```

### 5.2 Symbol Resolution and Inlining

The compiler walks the AST and resolves symbols to their current bindings:

- **Builtin functions**: inlined as dedicated instructions or intrinsic calls
- **User-defined functions** (`defn`, `lambda`): body is inlined at the call site with parameter substitution
- **User-defined variables** (`define`): binding expression is inlined (transitively)
- **Unresolvable symbols**: emit `LOAD_VAR` for late-bound runtime lookup (rare)

A **dependency set** is recorded: the set of all user-defined symbols that were inlined. This set drives invalidation (section 6.2).

### 5.3 Constness Analysis

Each node in the AST is classified as:

- **Constant**: all inputs are constant → evaluate at compile time
- **Temporal**: depends on time (directly or transitively) → must execute at runtime
- **External**: depends on external input slot → constant per sample, but varies across time

This classification drives:
- **Constant folding**: constant nodes are evaluated once and replaced with `LOAD_CONST`
- **Builtin specialization**: `(euclid 3 8 beat)` — args `3` and `8` are constant → pre-compute the bit pattern, emit only the phasor lookup at runtime
- **Time-warp flattening**: affine scale/offset are constant → compose at compile time

### 5.4 Time-Warp Flattening

The compiler accumulates an **affine time transform** `(scale, offset)` as it descends through `fast`, `slow`, `offset`, `shift` nodes:

```
(fast k expr)   → scale *= k
(slow k expr)   → scale /= k
(offset k expr) → offset += k
(shift k expr)  → offset += k
```

When the compiler reaches a temporal leaf (`beat`, `bar`, `t`, etc.), it emits:

```
LOAD_TIME rd, BEAT, accumulated_scale, accumulated_offset
```

The `fast`/`slow`/`offset`/`shift` nodes **vanish from the bytecode**. Nested affine warps compose: `(fast 2 (slow 0.5 (offset 0.1 expr)))` → `scale=1.0, offset=0.1`.

**Non-linear premaps** (`premap` with arbitrary function): the compiler emits bytecode to compute the warped time into a register, then threads that register through the inner subgraph as the time source. This is the escape hatch for non-affine time transforms.

### 5.5 Builtin Expansion

Builtins fall into three tiers:

1. **Primitive instructions**: `+`, `-`, `*`, `/`, `sin`, `cos`, `floor`, etc. → direct bytecode instructions
2. **Expandable builtins**: `euclid`, `gates`, `trigs`, `seq`/`from-list`, etc. → if all structural args are constant, pre-compute at compile time and emit simple runtime lookups. If structural args are signals, fall back to `CALL_INTRINSIC`
3. **Opaque intrinsics**: complex builtins with loop-heavy or stateful C++ implementations → always `CALL_INTRINSIC`

The decision boundary is: **can the result be reduced to a constant data structure at compile time?** If yes, expand. If no, call intrinsic.

## 6. Runtime Integration

### 6.1 Compilation Trigger

**Debounced eager compilation**:

1. When `eval()` modifies a binding (via `define`, `defn`, output assignment, etc.), affected output graphs are marked **dirty**
2. At the next frame boundary (or after a short debounce window), all dirty graphs are recompiled in a single pass
3. Multiple rapid evals (e.g., pasting a code block) coalesce into one compilation

This ensures the sampling hot path never hits a cold compile.

### 6.2 Dependency Tracking and Invalidation

Each compiled graph carries a **dependency set**: the symbols it inlined during compilation.

When a symbol is redefined (via `define`, `defn`):
1. Walk all compiled output graphs
2. Any graph whose dependency set contains the redefined symbol is marked dirty
3. Dirty graphs are recompiled at the next frame boundary (debounced)

This gives full inlining optimization with correct live-coding semantics — redefining `foo` propagates to all outputs that use `foo`, with minimal recompilation.

### 6.3 Last-Known-Good Fallback

Each output slot maintains **two compiled graphs**:

- **Current**: the most recently compiled graph
- **Last-known-good**: the last graph that executed without errors

**Error recovery flow**:

1. Compilation succeeds → swap new graph into current, begin executing it
2. If current graph produces a runtime error during sampling:
   a. Set error flag with diagnostic info
   b. Swap back to last-known-good for subsequent samples
   c. Report error asynchronously (console on web, LED on firmware)
3. If current graph executes cleanly for one full sample pass → promote to last-known-good
4. If compilation fails → don't swap, keep executing last-known-good, report compile error

**Result**: zero silence during live performance. The performer can experiment freely; broken code gracefully holds the previous working version.

### 6.4 WASM ABI

The existing WASM ABI (`useq_eval_output`, `useq_eval_outputs_time_window`, etc.) remains unchanged from the frontend's perspective. The bytecode VM is an internal implementation detail of the C++ interpreter. The frontend continues to call the same C functions; those functions now execute compiled bytecode instead of tree-walking.

No WASM ABI changes are needed for V1.

### 6.5 Replacing the Tree-Walker

The bytecode VM replaces the tree-walker for **all evaluation**, including REPL. When `useq_eval(code)` is called:

1. Parse the code into an AST
2. Compile to bytecode
3. Execute the bytecode
4. Return the result

For REPL expressions, the compiled bytecode is ephemeral (not cached). For output assignments (`a1`, `a2`, etc.), the compiled graph is stored and reused for sampling.

This eliminates dual evaluation paths and ensures consistent semantics everywhere.

## 7. Testing Strategy

### 7.1 Guiding Principle

The test suite validates the **mathematical semantics of the language**, not parity with the current tree-walking interpreter. The tree-walker is not gospel — it may have its own semantic bugs. The bytecode VM is an opportunity to establish a canonical, well-tested definition of ModuLisp semantics.

### 7.2 Test Layers

**Layer 1: Instruction-level tests**
- Each bytecode instruction in isolation: `ADD`, `SIN`, `VEC_INDEX`, etc.
- Edge cases: division by zero, NaN propagation, bounds clamping
- Phasor boundary behavior (0.0, 1.0, wrap-around)

**Layer 2: Compiler correctness**
- Constant folding produces correct results
- Time-warp flattening: `(fast 2 (slow 0.5 expr))` ≡ `expr`
- Symbol inlining: `(define x 3) (+ x 1)` → `LOAD_CONST 4`
- CSE: `(+ (sin beat) (sin beat))` → one SIN instruction, result reused
- Dependency tracking: redefining `x` invalidates graphs that use `x`

**Layer 3: Semantic property tests**
- Property-based / generative testing of mathematical identities:
  - `(+ a b)` ≡ `(+ b a)` (commutativity)
  - `(fast k (slow k expr))` ≡ `expr` (inverse time warps)
  - `(sin 0)` = 0.5 (unipolar convention)
  - Vector indexing at phasor 0.0 returns first element
  - Vector indexing at phasor just-below-1.0 returns last element
- Signal equivalences: verify that `(postmap f (postmap g expr))` ≡ `(postmap (compose f g) expr)`

**Layer 4: Integration tests**
- End-to-end: parse → compile → execute → sample output at multiple time points
- Batch sampling: `eval_outputs_time_window` produces correct waveforms
- Live-coding workflow: define → redefine → verify output updates
- Error recovery: induce runtime error → verify fallback to last-known-good

**Layer 5: Cross-target tests**
- Same test inputs run on both firmware (ARM) and WASM builds
- Compare outputs to within floating-point epsilon
- Verify computed-goto vs switch dispatch produce identical results

### 7.3 Golden Test Suite

A corpus of ModuLisp expressions with known correct outputs at specific time points, maintained as a standalone test fixture. This serves as the canonical semantic reference and regression guard.

## 8. Future Optimization Paths

These are explicitly **not in V1 scope** but the architecture is designed to accommodate them.

### 8.1 JIT to Native ARM

The register-based bytecode is designed to be a natural IR for JIT compilation:

- Register numbering maps to ARM VFP/FPU registers
- `VEC_INDEX` maps to indexed load instructions
- Affine time transforms are already folded into `LOAD_TIME` immediates
- `CALL_INTRINSIC` becomes a function pointer call in native code

Target: RP2040 (soft-float, Cortex-M0+) and RP2350 (hard-float, Cortex-M33). Both can execute from RAM.

### 8.2 Symbolic Interval Analysis

For conditions like `(if (> beat 0.5) expr_a expr_b)`:

Since `beat` is a phasor (monotonically 0→1 within each beat period), the flip point can be computed symbolically: `t_flip = beat_period * 0.5`. Instead of evaluating the condition 100 times per beat:

```
if (sample_time < t_flip) → execute branch A
else → execute branch B
```

One comparison per sample instead of full condition evaluation. Constant conditions fold away entirely at compile time.

### 8.3 SIMD Vectorization

Batch sampling evaluates the same bytecode at many time points. A future pass could vectorize the instruction stream to process 4 samples simultaneously (ARM NEON on RP2350, or WASM SIMD).

### 8.4 Web Worker Offloading

Move WASM evaluation to a Web Worker with SharedArrayBuffer for batch results. The bytecode VM makes this easier — the compiled graph is a flat data structure that can be transferred or shared between threads.

## 9. Implementation Phases

### Phase 1: Core VM and instruction set
- Define bytecode instruction encoding (opcode + register operands)
- Implement VM dispatch loop (switch-based initially)
- Implement core instruction set: arithmetic, comparisons, math, transcendentals, LOAD_CONST, LOAD_TIME, MOV
- Unit tests for each instruction

### Phase 2: Compiler frontend
- AST → bytecode compiler for simple expressions (arithmetic, temporals)
- Register allocation (linear scan)
- Constant folding pass
- Integration with `eval_in()` — compile then execute instead of tree-walk

### Phase 3: Vector and control flow
- Data segment allocation and management
- VEC_INDEX and VEC_LERP instructions
- Branch instructions (BRANCH, BRANCH_IF, BRANCH_UNLESS)
- Compile `if`, `do`, `let` forms

### Phase 4: Builtin expansion and time warps
- Time-warp flattening (affine transform composition)
- Constness analysis pass
- Builtin expansion for constant-arg cases (euclid, gates, etc.)
- CALL_INTRINSIC for signal-arg cases

### Phase 5: Functions and inlining
- Lambda/defn compilation with inlining
- CALL/RET for non-inlinable cases
- Symbol resolution and dependency tracking
- Invalidation on rebinding

### Phase 6: Error handling and live-coding integration
- Last-known-good graph management
- Debounced eager compilation trigger
- Error reporting (web console, firmware LED)
- Integration with output assignment (a1-a8, d1-d8, s1-s8)

### Phase 7: Optimization and dispatch
- CSE pass
- Computed-goto dispatch for ARM (behind #ifdef)
- Non-linear premap support
- Benchmark vs tree-walking baseline

### Phase 8: Cross-target validation
- WASM build integration and testing
- ARM firmware build integration and testing
- Golden test suite across both targets
- Performance benchmarks on both targets
