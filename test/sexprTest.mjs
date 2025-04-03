// Test file for S-Expression Tracking
import { sExprField } from '../src/editors/extensions/sexprHighlight.mjs';
import { dbg } from '../src/utils.mjs';

// This function can be exposed globally for testing in the console
export function debugSExprTracking(editor) {
  if (!editor) {
    dbg("debugSExprTracking: No editor provided");
    return;
  }
  
  try {
    const state = editor.state.field(sExprField);
    
    dbg("S-Expression State:", {
      topLevelExpressionsCount: state.topLevelExpressions.length,
      allExpressionsCount: state.allExpressions.length,
      currentTopLevel: state.currentTopLevel ? {
        from: state.currentTopLevel.from,
        to: state.currentTopLevel.to,
        text: editor.state.doc.sliceString(
          state.currentTopLevel.from, 
          state.currentTopLevel.to
        )
      } : null,
      currentNested: state.currentNested ? {
        from: state.currentNested.from,
        to: state.currentNested.to,
        text: editor.state.doc.sliceString(
          state.currentNested.from, 
          state.currentNested.to
        )
      } : null
    });
    
    return state;
  } catch (e) {
    dbg("Error in debugSExprTracking:", e);
    return null;
  }
}

// This can be called from the console: 
// window.testSExprHighlight = (editor) => import('../test/sexprTest.mjs').then(m => m.debugSExprTracking(editor));