# S-Expression Tracking and Highlighting Implementation Guide for CodeMirror

## Overview

This guide outlines how to implement the following features in a CodeMirror editor:

- Track start and end positions of all top-level s-expressions
- Track the current top-level s-expression as the cursor moves
- Track the current nested s-expression containing the cursor
- Highlight evaluated code when Ctrl-Enter is pressed

## Technical Approach

Based on CodeMirror's architecture, we'll implement these features using:

- A state field to store s-expression data
- A view plugin to update when cursor position changes
- A parser to identify s-expressions
- Mark decorations for highlighting
- Transaction listeners for tracking state changes

## Implementation Steps

### 1. Create a State Field for S-Expression Data

```typescript
import {StateField, EditorState, Transaction} from "@codemirror/state"
import {EditorView, Decoration, DecorationSet} from "@codemirror/view"

// Define the structure for storing s-expression data
interface SExpr {
  from: number
  to: number
  isTopLevel: boolean
  parent?: SExpr
  children?: SExpr[]
}

interface SExprState {
  allExpressions: SExpr[]
  topLevelExpressions: SExpr[]
  currentTopLevel: SExpr | null
  currentNested: SExpr | null
  highlightRange: {from: number, to: number} | null
  highlightTime: number | null
}

// Create state field
const sExprField = StateField.define<SExprState>({
  create(state) {
    const exprs = parseSExpressions(state.doc.toString());
    return {
      allExpressions: exprs,
      topLevelExpressions: exprs.filter(e => e.isTopLevel),
      currentTopLevel: null,
      currentNested: null,
      highlightRange: null,
      highlightTime: null
    };
  },
  update(value, tr) {
    // If document changed, reparse the expressions
    if (tr.docChanged) {
      const exprs = parseSExpressions(tr.state.doc.toString());
      value = {
        ...value,
        allExpressions: exprs,
        topLevelExpressions: exprs.filter(e => e.isTopLevel)
      };
    }
    
    // Update current expressions based on cursor position
    if (tr.selection) {
      const pos = tr.selection.main.head;
      value = {
        ...value,
        currentTopLevel: findTopLevelExprAtPos(value.topLevelExpressions, pos),
        currentNested: findInnerMostExprAtPos(value.allExpressions, pos)
      };
    }
    
    // Check for highlight effects
    for (const effect of tr.effects) {
      if (effect.is(highlightEffect)) {
        value = {
          ...value,
          highlightRange: effect.value,
          highlightTime: Date.now()
        };
      }
    }
    
    // Fade out highlight after some time
    if (value.highlightTime && Date.now() - value.highlightTime > 1000) {
      value = {
        ...value,
        highlightRange: null,
        highlightTime: null
      };
    }
    
    return value;
  }
});
```

### 2. Create an S-Expression Parser

```typescript
// Helper function to parse s-expressions
function parseSExpressions(text: string): SExpr[] {
  const result: SExpr[] = [];
  const stack: {expr: SExpr, depth: number}[] = [];
  let currentDepth = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '(' || char === '[') {
      // Start a new expression
      const expr: SExpr = {
        from: i,
        to: -1, // Will be filled when we find the closing paren
        isTopLevel: currentDepth === 0,
        children: []
      };
      
      // Add to parent if we're nested
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].expr;
        expr.parent = parent;
        parent.children?.push(expr);
      }
      
      stack.push({expr, depth: currentDepth});
      currentDepth++;
    } 
    else if (char === ')' || char === ']') {
      if (stack.length > 0) {
        currentDepth--;
        const {expr} = stack.pop()!;
        expr.to = i + 1;
        
        // If this is a top-level expression, add it to results
        if (expr.isTopLevel) {
          result.push(expr);
        }
      }
    }
  }
  
  // Also add top-level expressions that might not have been closed
  for (const {expr} of stack) {
    if (expr.isTopLevel) {
      expr.to = text.length;
      result.push(expr);
    }
  }
  
  return result;
}

// Helper to find the top-level expression at position
function findTopLevelExprAtPos(expressions: SExpr[], pos: number): SExpr | null {
  for (const expr of expressions) {
    if (pos >= expr.from && pos <= expr.to) {
      return expr;
    }
  }
  return null;
}

// Helper to find the innermost expression at position
function findInnerMostExprAtPos(expressions: SExpr[], pos: number): SExpr | null {
  // Sort by size (smallest first) to find the innermost
  const candidates = expressions
    .filter(expr => pos >= expr.from && pos <= expr.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from));
  
  return candidates.length > 0 ? candidates[0] : null;
}
```

### 3. Set Up Highlighting for Evaluated Code

```typescript
import {StateEffect} from "@codemirror/state"

// Define an effect for highlighting code
const highlightEffect = StateEffect.define<{from: number, to: number}>();

// Create decoration for highlighting
const highlightDecoration = Decoration.mark({
  attributes: {class: "cm-evaluated-code"}
});

// Create a theme for the highlighting
const highlightTheme = EditorView.theme({
  ".cm-evaluated-code": {
    backgroundColor: "#ffff9980",
    transition: "background-color 0.5s"
  }
});

// Create decoration provider
const highlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none },
  update(decorations, tr) {
    // Remove old decorations and add new ones based on the current highlight
    decorations = decorations.map(tr.changes);
    
    const state = tr.state.field(sExprField);
    if (state.highlightRange) {
      return Decoration.set([
        highlightDecoration.range(state.highlightRange.from, state.highlightRange.to)
      ]);
    }
    
    return Decoration.none;
  },
  provide: field => EditorView.decorations.from(field)
});
```

### 4. Create a Command for Ctrl-Enter Evaluation

```typescript
import {keymap} from "@codemirror/view"

// Command to evaluate the current top-level s-expression
const evaluateSExpr = (view: EditorView) => {
  const state = view.state.field(sExprField);
  const currentExpr = state.currentTopLevel;
  
  if (currentExpr) {
    // Get the code to be evaluated
    const code = view.state.doc.sliceString(currentExpr.from, currentExpr.to);
    
    // Apply the highlight effect
    view.dispatch({
      effects: highlightEffect.of({
        from: currentExpr.from,
        to: currentExpr.to
      })
    });
    
    // After the existing evaluation logic runs:
    editor.dispatch({
      effects: onEvaluateEffect.of(null)
    });

    return false; // Allow the existing Ctrl-Enter handler to run
  }
  
  return false;
};

// Wrapping the existing Ctrl-Enter command
const wrapCtrlEnterCommand = (existingCmd) => (view) => {
  // First highlight the expression
  evaluateSExpr(view);
  
  // Then run the existing command
  return existingCmd(view);
};

// Get reference to the existing command
const originalCmd = editor.state.facet(keymap).find(b => b.key === "Ctrl-Enter").run;

// Replace with wrapped version
editor.dispatch({
  effects: EditorView.reconfigure.of([
    keymap.of([{ key: "Ctrl-Enter", run: wrapCtrlEnterCommand(originalCmd) }])
  ])
});

// Example: If the system has a callback mechanism
existingSystem.onEvaluate((code, range) => {
  editor.dispatch({
    effects: highlightEffect.of({from: range.from, to: range.to})
  });
});
```

### 5. Create a View Plugin to Expose Current S-Expression Info

```typescript
import {ViewPlugin, PluginValue} from "@codemirror/view"

class SExprPlugin implements PluginValue {
  constructor(view: EditorView) {
    this.update(view, null);
  }
  
  update(view: EditorView, prevUpdate: ViewUpdate | null) {
    const state = view.state.field(sExprField);
    
    // Expose the current s-expression data for external use if needed
    (view as any).sExprInfo = {
      currentTopLevel: state.currentTopLevel,
      currentNested: state.currentNested
    };
    
    // Optional: highlight the current s-expressions with a subtle background
    // This would need additional decoration fields
  }
  
  destroy() {}
}

const sExprPlugin = ViewPlugin.fromClass(SExprPlugin);
```

### 6. Combine Everything into a Single Extension

```typescript
function setupSExprTracking() {
  return [
    sExprField,
    highlightField,
    highlightTheme,
    // For option 1: Include the wrapped keymap
    sExprPlugin
  ];
}

// Usage:
let editor = new EditorView({
  extensions: [
    basicSetup,
    setupSExprTracking()
    // The existing Ctrl-Enter binding remains in place
    // ...other extensions
  ],
  parent: document.body
});
```

## CSS Styling

Add these styles to your CSS:

```css
.cm-evaluated-code {
  background-color: rgba(255, 255, 153, 0.5);
  animation: flash-highlight 1s;
}

@keyframes flash-highlight {
  0% { background-color: rgba(255, 255, 0, 0.7); }
  100% { background-color: rgba(255, 255, 153, 0.5); }
}
```

## Accessing S-Expression Data

You can access the current s-expression data from your code:

```typescript
// Get the current top-level s-expression
const topLevel = editor.state.field(sExprField).currentTopLevel;

// Get the current nested s-expression
const nested = editor.state.field(sExprField).currentNested;

// Get all top-level s-expressions
const allTopLevel = editor.state.field(sExprField).topLevelExpressions;
```

## Performance Considerations

- For large documents, consider only parsing visible content or using a more efficient parsing strategy
- Use debouncing to avoid frequent re-parsing during rapid typing
- Consider using a web worker for parsing if performance becomes an issue

This implementation provides all the requested features while following CodeMirror's architecture patterns. It separates concerns between state management, parsing, decoration, and user interaction.