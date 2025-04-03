import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { dbg } from "../../utils.mjs";

// Define the structure for storing s-expression data
/**
 * @typedef {Object} SExpr
 * @property {number} from - Start position in the document
 * @property {number} to - End position in the document
 * @property {boolean} isTopLevel - Whether this is a top-level expression
 * @property {SExpr} [parent] - Parent expression if nested
 * @property {SExpr[]} [children] - Child expressions if any
 */

/**
 * @typedef {Object} SExprState
 * @property {SExpr[]} allExpressions - All parsed expressions
 * @property {SExpr[]} topLevelExpressions - Top-level expressions only
 * @property {SExpr|null} currentTopLevel - Current top-level expression at cursor
 * @property {SExpr|null} currentNested - Current nested expression at cursor
 * @property {Object|null} highlightRange - Range to highlight after evaluation
 * @property {number|null} highlightTime - Time when highlight was created (for fading)
 */

// Define an effect for highlighting code
export const highlightEffect = StateEffect.define();

// Create a state field for S-Expression data
export const sExprField = StateField.define({
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
    
    // Fade out highlight after animation duration (1000ms)
    // Make sure the timing matches the CSS animation duration
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

// Create decoration for highlighting
const highlightDecoration = Decoration.mark({
  attributes: {class: "cm-evaluated-code"}
});

// Create a theme for the highlighting
export const highlightTheme = EditorView.theme({
  ".cm-evaluated-code": {
    // Remove the static background color so it doesn't override the animation
    // We keep the transition property for smooth animation
    transition: "background-color 0.5s"
  }
});

// Create decoration provider
export const highlightField = StateField.define({
  create() { 
    return Decoration.none; 
  },
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

// Helper function to parse s-expressions
function parseSExpressions(text) {
  const result = [];
  const stack = [];
  let currentDepth = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '(' || char === '[') {
      // Start a new expression
      const expr = {
        from: i,
        to: -1, // Will be filled when we find the closing paren
        isTopLevel: currentDepth === 0,
        children: []
      };
      
      // Add to parent if we're nested
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].expr;
        expr.parent = parent;
        parent.children.push(expr);
      }
      
      stack.push({expr, depth: currentDepth});
      currentDepth++;
    } 
    else if (char === ')' || char === ']') {
      if (stack.length > 0) {
        currentDepth--;
        const {expr} = stack.pop();
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
function findTopLevelExprAtPos(expressions, pos) {
  for (const expr of expressions) {
    if (pos >= expr.from && pos <= expr.to) {
      return expr;
    }
  }
  return null;
}

// Helper to find the innermost expression at position
function findInnerMostExprAtPos(expressions, pos) {
  // Sort by size (smallest first) to find the innermost
  const candidates = expressions
    .filter(expr => pos >= expr.from && pos <= expr.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from));
  
  return candidates.length > 0 ? candidates[0] : null;
}

// Wrap the existing eval function to add highlighting
export function wrapEvalFunction(originalEvalFn) {
  return function(view) {
    // First get the s-expression data
    const state = view.state.field(sExprField);
    const currentExpr = state.currentTopLevel;
    
    // If we have a current s-expression, highlight it
    if (currentExpr) {
      // If we're highlighting the same region that was previously highlighted,
      // we need to clear it first to ensure the animation restarts
      if (state.highlightRange && 
          state.highlightRange.from === currentExpr.from && 
          state.highlightRange.to === currentExpr.to) {
        // First clear the highlight
        view.dispatch({
          effects: highlightEffect.of(null)
        });
        
        // Small delay to ensure the DOM updates before applying the new highlight
        setTimeout(() => {
          view.dispatch({
            effects: highlightEffect.of({
              from: currentExpr.from,
              to: currentExpr.to
            })
          });
        }, 10);
      } else {
        // Normal case - highlight a different expression
        view.dispatch({
          effects: highlightEffect.of({
            from: currentExpr.from,
            to: currentExpr.to
          })
        });
      }
    }
    
    // Then run the original evaluation function
    return originalEvalFn(view);
  };
}

// Create a view plugin to expose current S-Expression info
export const sExprPlugin = EditorView.updateListener.of((update) => {
  if (update.selectionSet) {
    // This runs when the selection changes
    // Useful for additional behaviors when cursor moves
    const state = update.state.field(sExprField);
    
    // Example: Expose the state to the window for debugging
    // window.sExprDebug = {
    //   currentTopLevel: state.currentTopLevel,
    //   currentNested: state.currentNested
    // };
  }
});

// Combine everything into a single extension
export function setupSExprTracking() {
  return [
    sExprField,
    highlightField,
    highlightTheme,
    sExprPlugin
  ];
}