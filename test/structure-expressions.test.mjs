import './setup.mjs';
import { strict as assert } from 'assert';
import {
  findExpressionAtPosition,
  findExpressionRanges,
  isRangeActive,
  createMarkersForRange,
  processExpressionRanges,
  ExpressionGutterMarker
} from '../src/editors/extensions/structure.mjs';

describe('Expression Detection & Processing', () => {
  // Mock data for testing
  const mockDocLines = [
    { text: "(a1 0.5)", from: 0 },
    { text: "  (d2 100)", from: 8 },
    { text: "(a1 0.8) (d3 200)", from: 18 },
    { text: "normal line", from: 35 },
    { text: "(a3 0.2)", from: 47 }
  ];

  const mockFindBounds = (matchStart) => {
    // More precise mock that returns expression-specific bounds
    for (let i = 0; i < mockDocLines.length; i++) {
      const line = mockDocLines[i];
      if (matchStart >= line.from && matchStart < (line.from + line.text.length)) {
        // For the line "(a1 0.8) (d3 200)" at position 18:
        // a1 match starts at 18+1 = 19, so return bounds 18-26 (first expression)
        // d3 match starts at 18+10 = 28, so return bounds 27-35 (second expression)
        if (line.text.includes("(a1 0.8) (d3 200)")) {
          const relativePos = matchStart - line.from;
          if (relativePos === 1) { // a1 match
            return { from: i + 1, to: i + 1, startPos: line.from, endPos: line.from + 8 }; // "(a1 0.8)"
          } else if (relativePos === 10) { // d3 match  
            return { from: i + 1, to: i + 1, startPos: line.from + 9, endPos: line.from + line.text.length }; // "(d3 200)"
          }
        }
        // Default: return whole line bounds
        return { from: i + 1, to: i + 1, startPos: line.from, endPos: line.from + line.text.length };
      }
    }
    return { from: 1, to: 1, startPos: 0, endPos: 10 };
  };

  describe('findExpressionAtPosition', () => {
    it('should find expression at cursor position within bounds', () => {
      const lineText = "(a1 0.5)";
      const lineFrom = 0;
      const cursor = 2; // Inside the expression
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result.expressionType, "a1");
      assert.equal(result.position.from, 0);
      assert.equal(result.position.to, 8);
    });

    it('should find d-type expressions', () => {
      const lineText = "  (d2 100)";
      const lineFrom = 8;
      const cursor = 12; // Inside the d2 expression
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result.expressionType, "d2");
    });

    it('should handle s-type expressions', () => {
      const lineText = "(s1 some-symbol)";
      const lineFrom = 0;
      const cursor = 2;
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result.expressionType, "s1");
    });

    it('should return null when cursor is outside expression bounds', () => {
      const lineText = "(a1 0.5)";
      const lineFrom = 0;
      const cursor = 50; // Way outside the expression
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result, null);
    });

    it('should return null when no expression pattern found', () => {
      const lineText = "no expression here";
      const lineFrom = 0;
      const cursor = 5;
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result, null);
    });

    it('should handle multiple expressions on same line', () => {
      const lineText = "(a1 0.8) (d3 200)";
      const lineFrom = 18;
      // Let's break down the positions:
      // "(a1 0.8) (d3 200)"
      //  0123456789012345678
      // The d3 is at position 10-11 in the string
      // So global position is lineFrom + 10 = 28
      const cursor = lineFrom + 10; // Position at 'd' in 'd3'
      
      const result = findExpressionAtPosition(cursor, lineText, lineFrom, mockFindBounds);
      
      assert.equal(result.expressionType, "d3");
    });
  });

  describe('findExpressionRanges', () => {
    it('should find all expression ranges in document', () => {
      const ranges = findExpressionRanges(mockDocLines, mockFindBounds);
      
      // Should find a1, d2, d3, a3 expressions
      assert.ok(ranges.has("a1"));
      assert.ok(ranges.has("d2"));
      assert.ok(ranges.has("d3"));
      assert.ok(ranges.has("a3"));
      assert.equal(ranges.has("a2"), false);
    });

    it('should group multiple occurrences of same expression type', () => {
      const ranges = findExpressionRanges(mockDocLines, mockFindBounds);
      
      const a1Ranges = ranges.get("a1");
      assert.equal(a1Ranges.length, 2); // Two a1 expressions
      
      // Check that both have required properties
      assert.ok(a1Ranges[0].color);
      assert.equal(typeof a1Ranges[0].from, 'number');
      assert.equal(typeof a1Ranges[0].to, 'number');
      assert.equal(typeof a1Ranges[0].matchStart, 'number');
    });

    it('should handle empty document', () => {
      const ranges = findExpressionRanges([], mockFindBounds);
      assert.equal(ranges.size, 0);
    });

    it('should handle document with no expressions', () => {
      const noExprLines = [
        { text: "no expressions here", from: 0 },
        { text: "just normal text", from: 20 }
      ];
      const ranges = findExpressionRanges(noExprLines, mockFindBounds);
      assert.equal(ranges.size, 0);
    });
  });

  describe('isRangeActive', () => {
    it('should return true when last evaluation is within range', () => {
      const range = { from: 1, to: 3 };
      const lastEvaluated = { line: 2 };
      
      assert.equal(isRangeActive(range, lastEvaluated), true);
    });

    it('should return true when last evaluation is at range boundaries', () => {
      const range = { from: 1, to: 3 };
      const lastEvaluatedStart = { line: 1 };
      const lastEvaluatedEnd = { line: 3 };
      
      assert.equal(isRangeActive(range, lastEvaluatedStart), true);
      assert.equal(isRangeActive(range, lastEvaluatedEnd), true);
    });

    it('should return false when last evaluation is outside range', () => {
      const range = { from: 1, to: 3 };
      const lastEvaluatedBefore = { line: 0 };
      const lastEvaluatedAfter = { line: 4 };
      
      assert.equal(isRangeActive(range, lastEvaluatedBefore), false);
      assert.equal(isRangeActive(range, lastEvaluatedAfter), false);
    });

    it('should return false when no last evaluation', () => {
      const range = { from: 1, to: 3 };
      
      assert.equal(isRangeActive(range, null), false);
      assert.equal(isRangeActive(range, undefined), false);
    });
  });

  describe('createMarkersForRange', () => {
    const mockDocLineFn = (lineNum) => ({ from: lineNum * 10 });
    
    it('should create markers for single-line range', () => {
      const range = { from: 1, to: 1, color: "#ff0000" };
      const isActive = true;
      const exprType = "a1";
      
      const markers = createMarkersForRange(range, isActive, mockDocLineFn, exprType);
      
      assert.equal(markers.length, 1);
      assert.equal(markers[0].pos, 10); // lineNum * 10
      assert.ok(markers[0].marker instanceof ExpressionGutterMarker);
      assert.equal(markers[0].marker.isStart, true);
      assert.equal(markers[0].marker.isEnd, true);
    });

    it('should create markers for multi-line range', () => {
      const range = { from: 1, to: 3, color: "#ff0000" };
      const isActive = true;
      const exprType = "a1";
      
      const markers = createMarkersForRange(range, isActive, mockDocLineFn, exprType);
      
      assert.equal(markers.length, 3);
      
      // Check start marker
      assert.equal(markers[0].marker.isStart, true);
      assert.equal(markers[0].marker.isEnd, false);
      assert.equal(markers[0].marker.isMid, false);
      
      // Check middle marker
      assert.equal(markers[1].marker.isStart, false);
      assert.equal(markers[1].marker.isEnd, false);
      assert.equal(markers[1].marker.isMid, true);
      
      // Check end marker
      assert.equal(markers[2].marker.isStart, false);
      assert.equal(markers[2].marker.isEnd, true);
      assert.equal(markers[2].marker.isMid, false);
    });

    it('should set active state correctly', () => {
      const range = { from: 1, to: 1, color: "#ff0000" };
      const exprType = "a1";
      
      const activeMarkers = createMarkersForRange(range, true, mockDocLineFn, exprType);
      const inactiveMarkers = createMarkersForRange(range, false, mockDocLineFn, exprType);
      
      assert.equal(activeMarkers[0].marker.isActive, true);
      assert.equal(inactiveMarkers[0].marker.isActive, false);
    });
  });

  describe('processExpressionRanges', () => {
    const mockDocLineFn = (lineNum) => ({ from: lineNum * 10 });
    
    it('should process all expression ranges and create markers', () => {
      const expressionRanges = new Map([
        ["a1", [{ from: 1, to: 1, color: "#ff0000" }]],
        ["d2", [{ from: 2, to: 3, color: "#00ff00" }]]
      ]);
      const lastEvaluatedMap = new Map([
        ["a1", { line: 1 }] // a1 is active
        // d2 is not in map, so inactive
      ]);
      
      const markers = processExpressionRanges(expressionRanges, lastEvaluatedMap, mockDocLineFn);
      
      // Should have markers for both expressions
      assert.ok(markers.length > 0);
      
      // Markers should be sorted by position
      for (let i = 1; i < markers.length; i++) {
        assert.ok(markers[i].pos >= markers[i-1].pos);
      }
      
      // Should have active and inactive markers
      const activeMarkers = markers.filter(m => m.marker.isActive);
      const inactiveMarkers = markers.filter(m => !m.marker.isActive);
      assert.ok(activeMarkers.length > 0);
      assert.ok(inactiveMarkers.length > 0);
    });

    it('should handle empty expression ranges', () => {
      const expressionRanges = new Map();
      const lastEvaluatedMap = new Map();
      
      const markers = processExpressionRanges(expressionRanges, lastEvaluatedMap, mockDocLineFn);
      
      assert.equal(markers.length, 0);
    });

    it('should handle ranges with no last evaluation', () => {
      const expressionRanges = new Map([
        ["a1", [{ from: 1, to: 1, color: "#ff0000" }]]
      ]);
      const lastEvaluatedMap = new Map(); // No evaluations
      
      const markers = processExpressionRanges(expressionRanges, lastEvaluatedMap, mockDocLineFn);
      
      assert.ok(markers.length > 0);
      // All markers should be inactive
      const allInactive = markers.every(m => !m.marker.isActive);
      assert.equal(allInactive, true);
    });
  });

  describe('ExpressionGutterMarker', () => {
    it('should create marker with correct properties', () => {
      const marker = new ExpressionGutterMarker("#ff0000", true, false, false, true, "a1", false);
      
      assert.equal(marker.color, "#ff0000");
      assert.equal(marker.isStart, true);
      assert.equal(marker.isEnd, false);
      assert.equal(marker.isMid, false);
      assert.equal(marker.isActive, true);
      assert.equal(marker.exprType, "a1");
      assert.equal(marker.showClear, false);
    });

    it('should implement equality correctly', () => {
      const marker1 = new ExpressionGutterMarker("#ff0000", true, false, false, true, "a1", false);
      const marker2 = new ExpressionGutterMarker("#ff0000", true, false, false, true, "a1", false);
      const marker3 = new ExpressionGutterMarker("#00ff00", true, false, false, true, "a1", false);
      
      assert.equal(marker1.eq(marker2), true);
      assert.equal(marker1.eq(marker3), false);
    });

    it('should create DOM element', () => {
      const marker = new ExpressionGutterMarker("#ff0000", true, false, false, true, "a1", false);
      const dom = marker.toDOM();
      
      assert.ok(dom instanceof HTMLElement);
      assert.equal(dom.tagName, 'DIV');
    });
  });
});