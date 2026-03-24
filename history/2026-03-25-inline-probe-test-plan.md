# Inline Probe Test Plan

Date: 2026-03-25

Primary bead: `useq-perform-naq`

## Goal

Expand test coverage for the editor-owned inline probe system so probe behavior
can be debugged with fast, deterministic unit tests before doing browser-only
validation.

## Properties To Lock Down

1. Probe identity and toggle semantics
   - same `mode + exact range` toggles off
   - raw and contextual probes can coexist on the same form

2. Context construction semantics
   - raw depth is always zero
   - contextual depth defaults to full wrapper depth
   - wrapper discovery only counts wrappers whose target child contains the
     selected node

3. Persistence and restoration
   - stored probes reload from localStorage
   - invalid stored shapes are filtered out
   - stored depth and maxDepth are sanitized
   - empty probe sets remove the persistence key

4. Document change mapping
   - probe ranges map through edits
   - contextual depth clamps when wrappers are removed

5. Sampling and render classification
   - numeric output renders waveform samples
   - non-numeric output renders text
   - `Error:` results render as error state
   - cached code is retried when rebuilt code fails

6. Indexed-form highlighting
   - contextual highlight is computed for visible indexed forms
   - raw highlight only appears when the indexed form itself has a raw probe
   - interpreter index semantics match `from-list`

7. Runtime side effects
   - silent probe evaluation does not publish `codeEvaluated`

## Planned Test Files

- `src/editors/extensions/probeHelpers.test.ts`
  - helper semantics and indexed-form discovery edge cases

- `src/editors/extensions/probes.test.ts`
  - state field behavior, persistence, document remapping, sampling render
    state, and indexed highlights

- `src/runtime/wasmInterpreter.test.ts`
  - silent eval event-suppression contract

## Verification

Run:

```bash
npm run test:unit -- src/editors/extensions/probeHelpers.test.ts src/editors/extensions/probes.test.ts src/runtime/wasmInterpreter.test.ts src/lib/persistence.test.ts
```
