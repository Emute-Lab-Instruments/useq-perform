import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { default_extensions } from "@nextjournal/clojure-mode";

import { parseHoleNode, getHoleAtCursor } from "./ast.ts";
import { navigationMetaField } from "./new-structure.ts";

// Helper to create a headless editor state with clojure-mode
function createState(doc: string, cursorFrom?: number, cursorTo?: number): EditorState {
  const selection =
    cursorFrom != null
      ? EditorSelection.single(cursorFrom, cursorTo ?? cursorFrom)
      : EditorSelection.cursor(0);
  return EditorState.create({
    doc,
    selection,
    extensions: [...default_extensions, navigationMetaField],
  });
}

describe("parseHoleNode", () => {
  it("recognises a valid hole ($ freq :number)", () => {
    const state = createState("($ freq :number)");
    const tree = syntaxTree(state);
    // The top-level node should be the List
    const root = tree.topNode;
    const listNode = root.firstChild;
    expect(listNode).not.toBeNull();

    const result = parseHoleNode(listNode!, state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("freq");
    expect(result!.type).toBe("number");
    expect(result!.from).toBe(0);
    expect(result!.to).toBe(16);
  });

  it("recognises a hole with :symbol type", () => {
    const state = createState("($ target :symbol)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("target");
    expect(result!.type).toBe("symbol");
  });

  it("recognises a hole with :keyword type", () => {
    const state = createState("($ mode :keyword)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("mode");
    expect(result!.type).toBe("keyword");
  });

  it("recognises a hole with :expr type", () => {
    const state = createState("($ body :expr)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("body");
    expect(result!.type).toBe("expr");
  });

  it("recognises a hole with :string type", () => {
    const state = createState("($ msg :string)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("msg");
    expect(result!.type).toBe("string");
  });

  it("rejects a list that does not start with $", () => {
    const state = createState("(foo bar :number)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).toBeNull();
  });

  it("rejects a list with wrong arity (too few)", () => {
    const state = createState("($ freq)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).toBeNull();
  });

  it("rejects a list with wrong arity (too many)", () => {
    const state = createState("($ freq :number extra)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).toBeNull();
  });

  it("rejects a list with invalid type keyword", () => {
    const state = createState("($ freq :invalid)");
    const tree = syntaxTree(state);
    const listNode = tree.topNode.firstChild;

    const result = parseHoleNode(listNode!, state);
    expect(result).toBeNull();
  });

  it("rejects a non-List node", () => {
    const state = createState("foo");
    const tree = syntaxTree(state);
    const node = tree.topNode.firstChild;

    const result = parseHoleNode(node!, state);
    expect(result).toBeNull();
  });

  it("returns null for null input", () => {
    const state = createState("");
    const result = parseHoleNode(null, state);
    expect(result).toBeNull();
  });
});

describe("getHoleAtCursor", () => {
  it("detects a hole when cursor selects the whole hole list", () => {
    const doc = "(osc ($ freq :number) 0.5)";
    //           0123456789...
    // The hole starts at index 5 and ends at index 21
    const holeFrom = doc.indexOf("($ freq");
    const holeTo = holeFrom + "($ freq :number)".length;
    const state = createState(doc, holeFrom, holeTo);

    const result = getHoleAtCursor(state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("freq");
    expect(result!.type).toBe("number");
  });

  it("detects a hole when cursor is inside the hole (on $)", () => {
    const doc = "(osc ($ freq :number) 0.5)";
    // Cursor on the $ symbol inside the hole
    const dollarPos = doc.indexOf("$");
    const state = createState(doc, dollarPos, dollarPos + 1);

    const result = getHoleAtCursor(state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("freq");
    expect(result!.type).toBe("number");
  });

  it("returns null when cursor is on a non-hole node", () => {
    const doc = "(osc 440 0.5)";
    // Cursor on 440
    const numPos = doc.indexOf("440");
    const state = createState(doc, numPos, numPos + 3);

    const result = getHoleAtCursor(state);
    expect(result).toBeNull();
  });

  it("detects the correct hole when document has multiple holes", () => {
    const doc = "(osc ($ freq :number) ($ phase :expr))";
    const secondHoleFrom = doc.indexOf("($ phase");
    const secondHoleTo = secondHoleFrom + "($ phase :expr)".length;
    const state = createState(doc, secondHoleFrom, secondHoleTo);

    const result = getHoleAtCursor(state);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("phase");
    expect(result!.type).toBe("expr");
  });
});
