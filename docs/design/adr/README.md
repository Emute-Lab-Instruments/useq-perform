# Synthesis Engine — Architecture Decision Records

Decision log for the browser synthesis engine. Each ADR records **why** a
decision was made and what it forecloses; the **what** lives in the
normative specs. Read order: ADRs for rationale → specs for contract →
`../synthesis-ux-forks.md` for how it feels to play.

| ADR | Decision | Spec home |
|-----|----------|-----------|
| [0001](0001-control-rate-language-fixed-nodedef-palette.md) | ModuLisp stays control-rate; audio DSP in a curated NodeDef palette | `synth-nodes.md` §1–2, `synthesis.md` §2 |
| [0002](0002-faust-first-source-agnostic-contract.md) | Faust-first DSP authoring behind a source-agnostic contract | `synthesis.md` §2 |
| [0003](0003-worker-producer-audio-master-clock.md) | Worker control producer, audio frame clock as master, epoch-tagged SAB ring, sample-accurate gates | `synthesis.md` §4 |
| [0004](0004-upsert-document-sync-lifecycle.md) | Upsert-per-eval + document-sync free model; ghost affordances | `synth-nodes.md` §5, `synthesis.md` §5, §7 |
| [0005](0005-provenance-identity-paste-gestures.md) | Provenance-tracked hidden IDs; `:name` sugar; fork/link paste gestures | `synth-nodes.md` §5.1–5.3, `synthesis.md` §7.6 |
| [0006](0006-vector-polyphony-abrupt-pitch.md) | Vectors as the polyphony surface; abrupt pitch by default, glide per-def | `synth-nodes.md` §2.4, §5.11–5.13 |
| [0007](0007-def-declared-rates-smoothing.md) | Rate/smoothing classes declared by the def, not the user (override deferred) | `synth-nodes.md` §2.3–2.5 |
| [0008](0008-hybrid-alignment-compensation.md) | Hybrid alignment: uncompensated default, manual offset setting, loopback auto-detect later | `synthesis.md` §4.5, §9.4 |

Status of all ADRs: **Accepted for v1** unless noted. The v1
implementation epic should be derived from the two specs
(`docs/specs/synthesis.md`, `src-useq/docs/specs/synth-nodes.md`), with
this table as the traceability map from decision → contract. Deferred
items are collected in `synth-nodes.md` §8 and `synthesis.md` §9 — they
are part of the spec surface (the contracts must not preclude them) but
out of the v1 epic.
