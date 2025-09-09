import './setup.mjs';
import { strict as assert } from 'assert';
import {
  detectAndTrackExpressionEvaluation,
  expressionEvaluatedAnnotation,
  lastEvaluatedExpressionField,
  nodeTreeCursorField,
  findExpressionRanges,
  isRangeActive,
  processExpressionRanges
} from '../src/editors/extensions/structure.mjs';
import { updateUserSettings, activeUserSettings } from '../src/utils/persistentUserSettings.mjs';
import { ASTCursor } from '../src/utils/astCursor.mjs';

describe('Active Expression Tracking', () => {
  // Mock document representing the example code
  const mockDoc = {
    length: 100,
    lines: 6,
    line: (lineNum) => {
      const lines = [
        { number: 1, from: 0, to: 4, text: "(do" },
        { number: 2, from: 5, to: 15, text: "  (a1 foo)" },
        { number: 3, from: 16, to: 26, text: "  (a2 bar)" },
        { number: 4, from: 27, to: 40, text: "  (a1 foobar)" },
        { number: 5, from: 41, to: 42, text: ")" }
      ];
      return lines[lineNum - 1];
    },
    lineAt: (pos) => {
      if (pos >= 0 && pos < 5) return mockDoc.line(1);
      if (pos >= 5 && pos < 16) return mockDoc.line(2);
      if (pos >= 16 && pos < 27) return mockDoc.line(3);
      if (pos >= 27 && pos < 41) return mockDoc.line(4);
      if (pos >= 41) return mockDoc.line(5);
      return mockDoc.line(1);
    }
  };

  // Mock AST for the do expression
  const mockAST = {
    type: "Program",
    from: 0,
    to: 42,
    children: [{
      type: "List", // The do expression
      from: 0,
      to: 42,
      children: [
        { type: "Symbol", from: 1, to: 3, text: "do" },
        { // (a1 foo)
          type: "List",
          from: 7, to: 15,
          children: [
            { type: "Symbol", from: 8, to: 10, text: "a1" },
            { type: "Symbol", from: 11, to: 14, text: "foo" }
          ]
        },
        { // (a2 bar)
          type: "List", 
          from: 18, to: 26,
          children: [
            { type: "Symbol", from: 19, to: 21, text: "a2" },
            { type: "Symbol", from: 22, to: 25, text: "bar" }
          ]
        },
        { // (a1 foobar)
          type: "List",
          from: 30, to: 40,
          children: [
            { type: "Symbol", from: 31, to: 33, text: "a1" },
            { type: "Symbol", from: 34, to: 40, text: "foobar" }
          ]
        }
      ]
    }]
  };

  // Helper to create mock state for expression tracking
  function createMockStateWithExpressions(lastEvaluatedMap = new Map()) {
    const cursor = new ASTCursor(mockAST);
    cursor.navigateTo([0]); // At the do expression
    
    return {
      field: (fieldType, fallback = undefined) => {
        if (fieldType === nodeTreeCursorField) {
          return cursor;
        }
        if (fieldType === lastEvaluatedExpressionField) {
          return lastEvaluatedMap;
        }
        return fallback;
      },
      doc: mockDoc
    };
  }

  // Mock view for dispatch testing
  function createMockView(state) {
    const dispatched = [];
    return {
      state: state,
      dispatch: (transaction) => {
        dispatched.push(transaction);
      },
      getDispatched: () => dispatched
    };
  }

  // Helper to create mock bounds function for expressions
  const mockFindBounds = (matchStart) => {
    // Map match positions to line ranges
    if (matchStart >= 7 && matchStart < 16) {
      return { from: 2, to: 2, startPos: 5, endPos: 15 }; // First a1
    }
    if (matchStart >= 18 && matchStart < 27) {
      return { from: 3, to: 3, startPos: 16, endPos: 26 }; // a2
    }
    if (matchStart >= 30 && matchStart < 41) {
      return { from: 4, to: 4, startPos: 27, endPos: 40 }; // Second a1
    }
    return { from: 1, to: 1, startPos: 0, endPos: 10 };
  };

  describe('detectAndTrackExpressionEvaluation', () => {
    it('should track multiple expressions with same type, keeping only the last one active', () => {
      const state = createMockStateWithExpressions();
      const view = createMockView(state);

      // Simulate evaluating the do expression
      detectAndTrackExpressionEvaluation(view);

      const dispatched = view.getDispatched();
      assert.ok(dispatched.length > 0, 'Should dispatch expression tracking annotations');

      // Check that annotations were created
      const annotations = dispatched[0].annotations;
      assert.ok(Array.isArray(annotations), 'Should have array of annotations');

      // Find a1 and a2 annotations
      let a1Annotation = null;
      let a2Annotation = null;

      annotations.forEach(ann => {
        if (ann.type === expressionEvaluatedAnnotation) {
          const value = ann.value;
          if (value.expressionType === 'a1') {
            a1Annotation = value;
          } else if (value.expressionType === 'a2') {
            a2Annotation = value;
          }
        }
      });

      // Should track both expression types
      assert.ok(a1Annotation, 'Should have a1 annotation');
      assert.ok(a2Annotation, 'Should have a2 annotation');

      // a1 should point to the LAST occurrence (line 4), not the first (line 2)
      assert.equal(a1Annotation.position.line, 4, 'a1 should track the last occurrence on line 4');
      
      // a2 should point to its only occurrence (line 3)
      assert.equal(a2Annotation.position.line, 3, 'a2 should track line 3');
    });

    it('should handle expressions with no last evaluation', () => {
      const state = createMockStateWithExpressions();
      const view = createMockView(state);

      // Store original settings and disable expression tracking
      const originalUi = activeUserSettings.ui || {};
      updateUserSettings({ ui: { ...originalUi, expressionLastTrackingEnabled: false } });

      detectAndTrackExpressionEvaluation(view);

      const dispatched = view.getDispatched();
      
      // Should not dispatch anything when tracking is disabled
      assert.equal(dispatched.length, 0, 'Should not dispatch when tracking disabled');

      // Restore original settings
      updateUserSettings({ ui: originalUi });
    });
  });

  describe('Expression Range Activity', () => {
    it('should correctly identify active vs inactive expression ranges', () => {
      // Create a map simulating that a1 was evaluated on line 4, a2 on line 3
      const lastEvaluatedMap = new Map([
        ['a1', { line: 4, from: 27, to: 40 }], // Second a1 expression
        ['a2', { line: 3, from: 16, to: 26 }]  // a2 expression
      ]);

      // Mock document lines for expression range finding
      const docLines = [
        { text: "(do", from: 0 },
        { text: "  (a1 foo)", from: 5 },
        { text: "  (a2 bar)", from: 16 },
        { text: "  (a1 foobar)", from: 27 },
        { text: ")", from: 41 }
      ];

      // Find all expression ranges
      const expressionRanges = findExpressionRanges(docLines, mockFindBounds);

      // Check that we found both a1 and a2 expressions
      assert.ok(expressionRanges.has('a1'), 'Should find a1 expressions');
      assert.ok(expressionRanges.has('a2'), 'Should find a2 expressions');

      const a1Ranges = expressionRanges.get('a1');
      const a2Ranges = expressionRanges.get('a2');

      // Should have 2 a1 ranges and 1 a2 range
      assert.equal(a1Ranges.length, 2, 'Should find 2 a1 expressions');
      assert.equal(a2Ranges.length, 1, 'Should find 1 a2 expression');

      // Test activity for each range
      const firstA1Range = a1Ranges.find(r => r.from === 2); // Line 2
      const secondA1Range = a1Ranges.find(r => r.from === 4); // Line 4
      const a2Range = a2Ranges[0]; // Line 3

      const lastEvalA1 = lastEvaluatedMap.get('a1');
      const lastEvalA2 = lastEvaluatedMap.get('a2');

      // Test isRangeActive function
      assert.equal(isRangeActive(firstA1Range, lastEvalA1), false, 
                   'First a1 expression should NOT be active');
      assert.equal(isRangeActive(secondA1Range, lastEvalA1), true, 
                   'Second a1 expression should be active');
      assert.equal(isRangeActive(a2Range, lastEvalA2), true, 
                   'a2 expression should be active');
    });

    it('should create markers with correct activity states', () => {
      const lastEvaluatedMap = new Map([
        ['a1', { line: 4 }], // Only the second a1 is active
        ['a2', { line: 3 }]  // a2 is active
      ]);

      const docLines = [
        { text: "(do", from: 0 },
        { text: "  (a1 foo)", from: 5 },
        { text: "  (a2 bar)", from: 16 },
        { text: "  (a1 foobar)", from: 27 },
        { text: ")", from: 41 }
      ];

      const expressionRanges = findExpressionRanges(docLines, mockFindBounds);
      const docLineFn = (lineNum) => mockDoc.line(lineNum);

      // Process all expression ranges to create markers
      const markers = processExpressionRanges(expressionRanges, lastEvaluatedMap, docLineFn);

      // Should have markers for both expressions
      assert.ok(markers.length > 0, 'Should create markers');

      // Check that we have both active and inactive markers
      const activeMarkers = markers.filter(m => m.marker.isActive);
      const inactiveMarkers = markers.filter(m => !m.marker.isActive);

      assert.ok(activeMarkers.length > 0, 'Should have active markers');
      assert.ok(inactiveMarkers.length > 0, 'Should have inactive markers');

      // The inactive markers should correspond to the first a1 expression
      // The active markers should correspond to the second a1 and the a2 expressions
      const inactivePositions = inactiveMarkers.map(m => m.pos);
      const activePositions = activeMarkers.map(m => m.pos);

      // Inactive markers should be at positions for line 2 (first a1)
      assert.ok(inactivePositions.includes(5), 'Should have inactive marker for first a1 line');

      // Active markers should be at positions for line 3 (a2) and line 4 (second a1)
      assert.ok(activePositions.includes(16), 'Should have active marker for a2 line');
      assert.ok(activePositions.includes(27), 'Should have active marker for second a1 line');
    });
  });

  describe('Expression Precedence Logic', () => {
    it('should handle multiple expressions of same type with correct precedence', () => {
      // Test case: (do (a1 1) (a1 2) (a1 3)) - only the last a1 should be active
      const testDoc = {
        line: (lineNum) => {
          const lines = [
            { number: 1, from: 0, to: 4, text: "(do" },
            { number: 2, from: 5, to: 12, text: "  (a1 1)" },
            { number: 3, from: 13, to: 20, text: "  (a1 2)" },
            { number: 4, from: 21, to: 28, text: "  (a1 3)" },
            { number: 5, from: 29, to: 30, text: ")" }
          ];
          return lines[lineNum - 1];
        }
      };

      const testDocLines = [
        { text: "(do", from: 0 },
        { text: "  (a1 1)", from: 5 },
        { text: "  (a1 2)", from: 13 },
        { text: "  (a1 3)", from: 21 },
        { text: ")", from: 29 }
      ];

      const testFindBounds = (matchStart) => {
        if (matchStart >= 5 && matchStart < 13) return { from: 2, to: 2 }; // First a1
        if (matchStart >= 13 && matchStart < 21) return { from: 3, to: 3 }; // Second a1
        if (matchStart >= 21 && matchStart < 29) return { from: 4, to: 4 }; // Third a1
        return { from: 1, to: 1 };
      };

      const expressionRanges = findExpressionRanges(testDocLines, testFindBounds);
      const a1Ranges = expressionRanges.get('a1');

      assert.equal(a1Ranges.length, 3, 'Should find 3 a1 expressions');

      // Simulate that all were evaluated, with the last one being most recent
      const lastEvalMap = new Map([
        ['a1', { line: 4 }] // Only line 4 (third a1) is active
      ]);

      const docLineFn = (lineNum) => testDoc.line(lineNum);
      const markers = processExpressionRanges(expressionRanges, lastEvalMap, docLineFn);

      const activeMarkers = markers.filter(m => m.marker.isActive);
      const inactiveMarkers = markers.filter(m => !m.marker.isActive);

      // Should have markers for line 4 (active) and lines 2,3 (inactive)
      const activeLines = activeMarkers.map(m => {
        // Map position back to line
        if (m.pos >= 21) return 4;
        if (m.pos >= 13) return 3;
        if (m.pos >= 5) return 2;
        return 1;
      });

      const inactiveLines = inactiveMarkers.map(m => {
        if (m.pos >= 21) return 4;
        if (m.pos >= 13) return 3;
        if (m.pos >= 5) return 2;
        return 1;
      });

      // All active markers should be for line 4
      activeLines.forEach(line => {
        assert.equal(line, 4, 'Active markers should only be for line 4 (last a1)');
      });

      // Inactive markers should be for lines 2 and 3
      const uniqueInactiveLines = [...new Set(inactiveLines)].sort();
      assert.deepEqual(uniqueInactiveLines, [2, 3], 
                       'Inactive markers should be for lines 2 and 3 (first two a1s)');
    });

    it('should handle mixed expression types correctly', () => {
      // Test: (do (a1 x) (d1 y) (a1 z) (d2 w)) 
      // Result: first a1 inactive, second a1 active, d1 active, d2 active
      const mixedDocLines = [
        { text: "(do", from: 0 },
        { text: "  (a1 x)", from: 5 },
        { text: "  (d1 y)", from: 13 },
        { text: "  (a1 z)", from: 21 },
        { text: "  (d2 w)", from: 29 },
        { text: ")", from: 37 }
      ];

      const mixedFindBounds = (matchStart) => {
        if (matchStart >= 5 && matchStart < 13) return { from: 2, to: 2 };  // a1 x
        if (matchStart >= 13 && matchStart < 21) return { from: 3, to: 3 }; // d1 y
        if (matchStart >= 21 && matchStart < 29) return { from: 4, to: 4 }; // a1 z
        if (matchStart >= 29 && matchStart < 37) return { from: 5, to: 5 }; // d2 w
        return { from: 1, to: 1 };
      };

      const expressionRanges = findExpressionRanges(mixedDocLines, mixedFindBounds);

      // Should find a1, d1, and d2 expressions
      assert.ok(expressionRanges.has('a1'), 'Should find a1 expressions');
      assert.ok(expressionRanges.has('d1'), 'Should find d1 expression');
      assert.ok(expressionRanges.has('d2'), 'Should find d2 expression');

      const lastEvalMap = new Map([
        ['a1', { line: 4 }], // Second a1 is active (line 4)
        ['d1', { line: 3 }], // d1 is active (line 3)
        ['d2', { line: 5 }]  // d2 is active (line 5)
      ]);

      const mockDocLineFn = (lineNum) => ({ from: (lineNum - 1) * 8 });
      const markers = processExpressionRanges(expressionRanges, lastEvalMap, mockDocLineFn);

      const activeMarkers = markers.filter(m => m.marker.isActive);
      const inactiveMarkers = markers.filter(m => !m.marker.isActive);

      // Should have active markers for lines 3, 4, 5 and inactive markers for line 2
      assert.ok(activeMarkers.length > 0, 'Should have active markers for d1, second a1, and d2');
      assert.ok(inactiveMarkers.length > 0, 'Should have inactive markers for first a1');

      // Check positions match expected lines
      const activePositions = activeMarkers.map(m => m.pos).sort();
      const inactivePositions = inactiveMarkers.map(m => m.pos).sort();

      // Active positions should include markers for lines 3, 4, 5
      assert.ok(activePositions.some(pos => pos >= 16), 'Should have active markers for line 3+ (d1, second a1, d2)');
      
      // Inactive positions should include markers for line 2
      assert.ok(inactivePositions.some(pos => pos >= 8 && pos < 16), 'Should have inactive markers for line 2 (first a1)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle expressions with no evaluation history', () => {
      const docLines = [
        { text: "  (a1 foo)", from: 5 },
        { text: "  (a2 bar)", from: 16 }
      ];

      const expressionRanges = findExpressionRanges(docLines, mockFindBounds);
      const emptyEvalMap = new Map(); // No evaluations yet

      const docLineFn = (lineNum) => ({ from: lineNum * 10 });
      const markers = processExpressionRanges(expressionRanges, emptyEvalMap, docLineFn);

      // All markers should be inactive when no evaluations have occurred
      const allInactive = markers.every(m => !m.marker.isActive);
      assert.equal(allInactive, true, 'All markers should be inactive with no evaluation history');
    });

    it('should handle empty expression ranges', () => {
      const emptyRanges = new Map();
      const evalMap = new Map([['a1', { line: 2 }]]);

      const docLineFn = (lineNum) => ({ from: lineNum * 10 });
      const markers = processExpressionRanges(emptyRanges, evalMap, docLineFn);

      assert.equal(markers.length, 0, 'Should return no markers for empty expression ranges');
    });

    it('should handle evaluation tracking with disabled settings', () => {
      const state = createMockStateWithExpressions();
      const view = createMockView(state);

      // Store original settings and disable expression tracking
      const originalUi = activeUserSettings.ui || {};
      updateUserSettings({ ui: { ...originalUi, expressionLastTrackingEnabled: false } });

      try {
        detectAndTrackExpressionEvaluation(view);
        const dispatched = view.getDispatched();
        assert.equal(dispatched.length, 0, 'Should not track when disabled in settings');
      } finally {
        // Restore original settings
        updateUserSettings({ ui: originalUi });
      }
    });
  });
});