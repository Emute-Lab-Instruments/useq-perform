import './setup.mjs';
import { strict as assert } from 'assert';
import {
  navigateIn,
  navigateOut,
  navigatePrev,
  navigateNext,
  getChildIndexFromPath,
  getParentPath,
  lastChildIndexAnnotation,
  nodeTreeCursorField,
  lastChildIndexField
} from '../src/editors/extensions/structure.mjs';
import { EditorSelection } from '@codemirror/state';
import { ASTCursor } from '../src/utils/astCursor.mjs';

describe('Navigation Functions', () => {
  // Mock AST structure for testing
  const mockAST = {
    type: "Program",
    from: 0,
    to: 50,
    children: [
      {
        type: "List",
        from: 0,
        to: 20,
        children: [
          { type: "Symbol", from: 1, to: 4, text: "def" },
          { type: "Symbol", from: 5, to: 8, text: "foo" },
          { type: "Number", from: 9, to: 11, text: "42" }
        ]
      },
      {
        type: "List", 
        from: 21,
        to: 40,
        children: [
          { type: "Symbol", from: 22, to: 25, text: "bar" },
          { type: "String", from: 26, to: 32, text: "hello" }
        ]
      },
      {
        type: "Symbol",
        from: 41,
        to: 45,
        text: "baz"
      }
    ]
  };

  // Helper to create mock state with cursor
  function createMockState(cursorPath = [], lastChildInfo = null) {
    const cursor = new ASTCursor(mockAST);
    if (cursorPath.length > 0) {
      cursor.navigateTo(cursorPath);
    }
    
    return {
      field: (fieldType, fallback = undefined) => {
        if (fieldType === nodeTreeCursorField || fieldType.toString().includes('nodeTreeCursor')) {
          return cursor;
        }
        if (fieldType === lastChildIndexField || fieldType.toString().includes('lastChildIndex')) {
          return lastChildInfo;
        }
        return fallback;
      },
      update: (config) => ({
        selection: config.selection,
        scrollIntoView: config.scrollIntoView,
        annotations: config.annotations,
        config: config
      }),
      selection: {
        main: { head: 0 }
      }
    };
  }

  describe('getChildIndexFromPath', () => {
    it('should return last element of path', () => {
      assert.equal(getChildIndexFromPath([0, 1, 2]), 2);
      assert.equal(getChildIndexFromPath([5]), 5);
    });

    it('should return 0 for empty path', () => {
      assert.equal(getChildIndexFromPath([]), 0);
      assert.equal(getChildIndexFromPath(null), 0);
      assert.equal(getChildIndexFromPath(undefined), 0);
    });
  });

  describe('getParentPath', () => {
    it('should return all elements except last', () => {
      assert.deepEqual(getParentPath([0, 1, 2]), [0, 1]);
      assert.deepEqual(getParentPath([5]), []);
    });

    it('should return empty array for empty path', () => {
      assert.deepEqual(getParentPath([]), []);
      assert.deepEqual(getParentPath(null), []);
      assert.deepEqual(getParentPath(undefined), []);
    });
  });

  describe('navigateIn', () => {
    it('should move into first child by default', () => {
      const state = createMockState([0]); // At first List
      const result = navigateIn(state);
      
      assert.ok(result);
      assert.ok(result.selection instanceof EditorSelection);
      assert.equal(result.selection.main.head, 1); // First child position
      assert.equal(result.scrollIntoView, true);
    });

    it('should move to last visited child when available', () => {
      const lastChildInfo = {
        parentPath: [0],
        childIndex: 2 // Third child
      };
      const state = createMockState([0], lastChildInfo);
      const result = navigateIn(state);
      
      assert.ok(result);
      assert.equal(result.selection.main.head, 9); // Third child position
    });

    it('should clamp child index to valid range', () => {
      const lastChildInfo = {
        parentPath: [0],
        childIndex: 999 // Out of bounds
      };
      const state = createMockState([0], lastChildInfo);
      const result = navigateIn(state);
      
      assert.ok(result);
      assert.equal(result.selection.main.head, 1); // Falls back to first child
    });

    it('should return null when no children', () => {
      const state = createMockState([0, 0]); // At Symbol node (leaf)
      const result = navigateIn(state);
      
      assert.equal(result, null);
    });

    it('should return null when cursor is invalid', () => {
      const mockState = {
        field: () => null // No cursor available
      };
      const result = navigateIn(mockState);
      
      assert.equal(result, null);
    });

    it('should reset lastChildIndex annotation', () => {
      const state = createMockState([0]);
      const result = navigateIn(state);
      
      assert.ok(result.annotations);
      assert.equal(result.annotations.type, lastChildIndexAnnotation);
      assert.equal(result.annotations.value.reset, true);
    });
  });

  describe('navigateOut', () => {
    it('should move to parent node', () => {
      const state = createMockState([0, 1]); // At second child of first list
      const result = navigateOut(state);
      
      assert.ok(result);
      assert.equal(result.selection.main.head, 0); // Parent position
      assert.equal(result.scrollIntoView, true);
    });

    it('should return null when at root', () => {
      const state = createMockState([]); // At root
      const result = navigateOut(state);
      
      assert.equal(result, null);
    });

    it('should store child index in annotation', () => {
      const state = createMockState([0, 2]); // At third child
      const result = navigateOut(state);
      
      assert.ok(result.annotations);
      assert.deepEqual(result.annotations.value.parentPath, [0]);
      assert.equal(result.annotations.value.childIndex, 2);
    });

    it('should return null when cursor is invalid', () => {
      const mockState = {
        field: () => null
      };
      const result = navigateOut(mockState);
      
      assert.equal(result, null);
    });
  });

  describe('navigatePrev', () => {
    it('should move to previous sibling', () => {
      const state = createMockState([1]); // At second top-level node
      const result = navigatePrev(state);
      
      assert.ok(result);
      assert.equal(result.selection.main.head, 0); // First top-level node
      assert.equal(result.scrollIntoView, true);
    });

    it('should return null when at first sibling', () => {
      const state = createMockState([0]); // At first node
      const result = navigatePrev(state);
      
      assert.equal(result, null);
    });

    it('should reset lastChildIndex annotation', () => {
      const state = createMockState([1]);
      const result = navigatePrev(state);
      
      assert.ok(result.annotations);
      assert.equal(result.annotations.value.reset, true);
    });

    it('should return null when cursor is invalid', () => {
      const mockState = {
        field: () => null
      };
      const result = navigatePrev(mockState);
      
      assert.equal(result, null);
    });
  });

  describe('navigateNext', () => {
    it('should move to next sibling', () => {
      const state = createMockState([0]); // At first top-level node
      const result = navigateNext(state);
      
      assert.ok(result);
      assert.equal(result.selection.main.head, 21); // Second top-level node
      assert.equal(result.scrollIntoView, true);
    });

    it('should return null when at last sibling', () => {
      const state = createMockState([2]); // At last top-level node
      const result = navigateNext(state);
      
      assert.equal(result, null);
    });

    it('should reset lastChildIndex annotation', () => {
      const state = createMockState([0]);
      const result = navigateNext(state);
      
      assert.ok(result.annotations);
      assert.equal(result.annotations.value.reset, true);
    });

    it('should return null when cursor is invalid', () => {
      const mockState = {
        field: () => null
      };
      const result = navigateNext(mockState);
      
      assert.equal(result, null);
    });
  });

  describe('Navigation Integration', () => {
    it('should maintain cursor consistency across operations', () => {
      // Start at root, navigate in, then out
      let state = createMockState([]);
      
      // Navigate into first child
      let result = navigateIn(state);
      assert.ok(result);
      
      // Simulate the cursor being at the new position
      state = createMockState([0]);
      
      // Navigate out
      result = navigateOut(state);
      assert.ok(result);
      assert.equal(result.selection.main.head, 0); // Back to root's first child
    });

    it('should handle sibling navigation within container', () => {
      // Navigate between children of first list
      let state = createMockState([0, 0]); // First child
      
      let result = navigateNext(state);
      assert.ok(result);
      assert.equal(result.selection.main.head, 5); // Second child
      
      // Navigate back
      state = createMockState([0, 1]);
      result = navigatePrev(state);
      assert.ok(result);
      assert.equal(result.selection.main.head, 1); // Back to first child
    });

    it('should handle edge cases with invalid nodes', () => {
      // Test with cursor that returns invalid node
      const mockCursor = {
        hasChildren: () => false,
        canGoOut: () => false,
        hasNext: () => false,
        hasPrev: () => false,
        fork: () => ({
          in: () => ({ getNode: () => null }),
          out: () => ({ getNode: () => null }),
          next: () => ({ getNode: () => null }),
          prev: () => ({ getNode: () => null })
        })
      };
      
      const state = {
        field: () => mockCursor
      };
      
      assert.equal(navigateIn(state), null);
      assert.equal(navigateOut(state), null);
      assert.equal(navigateNext(state), null);
      assert.equal(navigatePrev(state), null);
    });
  });
});