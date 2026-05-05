/**
 * Public surface of the structural-editing functional core.
 *
 * Spec: docs/specs/structural-editing.md (§2 Ontology, §3 Cursors, §5 Algebra,
 * §6.5 Meta preservation, §2.9 Holes).
 *
 * The core has no CodeMirror dependency. It defines:
 *   - Tree / Node / Cursor / CursorSet / State data shapes
 *   - Pure navigation ops (`nav.*`)
 *   - Pure mutation ops via `makeMutators(cfg)`
 *   - Hole helpers (creation, recognition, document-order traversal)
 *
 * The CodeMirror adapter lives in a future round; it will construct Trees
 * from Lezer parses and translate mutations into text edits. Nothing in this
 * core needs to know about that.
 */

export type {
  AddressableNode,
  Compound,
  CompoundKind,
  Cursor,
  CursorSet,
  DocumentNode,
  HoleNode,
  HoleType,
  IdGen,
  KeywordNode,
  Leaf,
  LeafKind,
  ListNode,
  MapNode,
  Meta,
  NoOpReason,
  Node,
  NodeCursor,
  NodeId,
  NumberNode,
  OpResult,
  RangeCursor,
  SetNode,
  State,
  StringNode,
  SymbolNode,
  Tree,
  VectorNode,
} from "./types.ts";

export {
  __resetIdCounterForTests,
  cursorList,
  defaultIdGen,
  makeTree,
  nodeCursor,
  rangeCursor,
  singleCursor,
} from "./types.ts";

export { findHolesInOrder, holeAcceptsKind, isHole, isHoleType, makeHole } from "./holes.ts";

export {
  childrenOf,
  findById,
  indexOfChild,
  isCompound,
  isLeaf,
  makeCompound,
  makeDocument,
  nodesInDocOrder,
  parentOf,
} from "./traversal.ts";

export { nav } from "./nav.ts";
export { makeMutators } from "./mutate.ts";
export type { Mutators } from "./mutate.ts";
export { docDeleteAll, docSelectAll } from "./docOps.ts";
export {
  metaAdd,
  metaRemove,
  metaCycle,
  metaFoldToggle,
  DEFAULT_META_CYCLE,
} from "./meta.ts";
export type { MetaFoldToggleResult, MetaFoldSet } from "./meta.ts";
