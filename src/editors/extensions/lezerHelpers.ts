// Thin barrel re-export of Lezer/AST helpers consumed outside the structure
// extension. Provides a stable entry point so callers don't have to reach into
// `structure/new-structure.ts` (the legacy implementation) or `structure/ast.ts`
// directly. Keep this barrel additive — no new logic here.

export { findNodeAt, isStructuralToken, isContainerNode } from "./structure/new-structure.ts";
export { getTrimmedRange, getContainerNodeAt, isOperatorNode } from "./structure/ast.ts";
