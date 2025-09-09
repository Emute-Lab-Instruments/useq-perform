import './setup.mjs';
import { strict as assert } from 'assert';
import {
  getTrimmedRange,
  isStructuralToken,
  isOperatorNode,
  isContainerNode,
  getMatchColor,
  getCurrentPalette
} from '../src/editors/extensions/structure.mjs';

describe('Structure Utilities', () => {
  describe('getTrimmedRange', () => {
    const mockState = {
      sliceDoc: (from, to) => {
        const mockText = "   hello world   ";
        return mockText.slice(from, to);
      }
    };

    it('should return null for invalid node', () => {
      assert.equal(getTrimmedRange(null, mockState), null);
      assert.equal(getTrimmedRange({}, mockState), null);
      assert.equal(getTrimmedRange({ from: "invalid" }, mockState), null);
    });

    it('should trim whitespace from both ends', () => {
      const node = { from: 0, to: 16 };
      const result = getTrimmedRange(node, mockState);
      assert.deepEqual(result, { from: 3, to: 14 });
    });

    it('should return null for all-whitespace text', () => {
      const mockWhitespaceState = {
        sliceDoc: () => "   \n\t  "
      };
      const node = { from: 0, to: 7 };
      const result = getTrimmedRange(node, mockWhitespaceState);
      assert.equal(result, null);
    });

    it('should handle text with no whitespace', () => {
      const mockNoWhitespaceState = {
        sliceDoc: () => "hello"
      };
      const node = { from: 5, to: 10 };
      const result = getTrimmedRange(node, mockNoWhitespaceState);
      assert.deepEqual(result, { from: 5, to: 10 });
    });

    it('should handle text with only leading whitespace', () => {
      const mockLeadingState = {
        sliceDoc: () => "   hello"
      };
      const node = { from: 0, to: 8 };
      const result = getTrimmedRange(node, mockLeadingState);
      assert.deepEqual(result, { from: 3, to: 8 });
    });

    it('should handle text with only trailing whitespace', () => {
      const mockTrailingState = {
        sliceDoc: () => "hello   "
      };
      const node = { from: 0, to: 8 };
      const result = getTrimmedRange(node, mockTrailingState);
      assert.deepEqual(result, { from: 0, to: 5 });
    });
  });

  describe('isStructuralToken', () => {
    it('should identify parentheses as structural', () => {
      assert.equal(isStructuralToken("("), true);
      assert.equal(isStructuralToken(")"), true);
    });

    it('should identify brackets as structural', () => {
      assert.equal(isStructuralToken("["), true);
      assert.equal(isStructuralToken("]"), true);
      assert.equal(isStructuralToken("Bracket"), true);
    });

    it('should identify braces as structural', () => {
      assert.equal(isStructuralToken("{"), true);
      assert.equal(isStructuralToken("}"), true);
      assert.equal(isStructuralToken("Brace"), true);
    });

    it('should identify Paren token as structural', () => {
      assert.equal(isStructuralToken("Paren"), true);
    });

    it('should not identify non-structural tokens', () => {
      assert.equal(isStructuralToken("Number"), false);
      assert.equal(isStructuralToken("String"), false);
      assert.equal(isStructuralToken("Identifier"), false);
      assert.equal(isStructuralToken("Symbol"), false);
      assert.equal(isStructuralToken(""), false);
      assert.equal(isStructuralToken(null), false);
      assert.equal(isStructuralToken(undefined), false);
    });
  });

  describe('isOperatorNode', () => {
    it('should identify operator nodes with children', () => {
      const operatorNode = {
        type: "Operator",
        children: [{ type: "Symbol", text: "+" }]
      };
      assert.equal(isOperatorNode(operatorNode), true);
    });

    it('should not identify operator nodes without children', () => {
      const operatorNode = {
        type: "Operator",
        children: []
      };
      assert.equal(isOperatorNode(operatorNode), false);
    });

    it('should not identify operator nodes with null/undefined children', () => {
      assert.equal(isOperatorNode({ type: "Operator", children: null }), false);
      assert.equal(isOperatorNode({ type: "Operator" }), false);
    });

    it('should not identify non-operator nodes', () => {
      const nonOperatorNode = {
        type: "Number",
        children: [{ type: "Symbol", text: "42" }]
      };
      assert.equal(isOperatorNode(nonOperatorNode), false);
    });

    it('should handle invalid input', () => {
      assert.equal(isOperatorNode(null), false);
      assert.equal(isOperatorNode(undefined), false);
      assert.equal(isOperatorNode({}), false);
      assert.equal(isOperatorNode({ type: null }), false);
    });
  });

  describe('isContainerNode', () => {
    it('should identify List as container', () => {
      assert.equal(isContainerNode({ type: "List" }), true);
    });

    it('should identify Vector as container', () => {
      assert.equal(isContainerNode({ type: "Vector" }), true);
    });

    it('should identify Program as container', () => {
      assert.equal(isContainerNode({ type: "Program" }), true);
    });

    it('should identify Map as container', () => {
      assert.equal(isContainerNode({ type: "Map" }), true);
    });

    it('should not identify non-container nodes', () => {
      assert.equal(isContainerNode({ type: "Number" }), false);
      assert.equal(isContainerNode({ type: "String" }), false);
      assert.equal(isContainerNode({ type: "Symbol" }), false);
      assert.equal(isContainerNode({ type: "Keyword" }), false);
    });

    it('should handle invalid input', () => {
      assert.equal(isContainerNode(null), false);
      assert.equal(isContainerNode(undefined), false);
      assert.equal(isContainerNode({}), false);
      assert.equal(isContainerNode({ type: null }), false);
    });
  });

  describe('getMatchColor', () => {
    it('should return colors for valid matches', () => {
      const match1 = ['a1 ', 'a', '1'];
      const match2 = ['d2 ', 'd', '2'];
      const match3 = ['a8 ', 'a', '8'];
      
      const color1 = getMatchColor(match1);
      const color2 = getMatchColor(match2);
      const color3 = getMatchColor(match3);
      
      // Colors should be strings (hex codes)
      assert.equal(typeof color1, 'string');
      assert.equal(typeof color2, 'string');
      assert.equal(typeof color3, 'string');
      
      // Different digits should potentially give different colors
      // (though they might wrap around in the palette)
      assert.ok(color1.startsWith('#') || color1.includes('rgb'));
      assert.ok(color2.startsWith('#') || color2.includes('rgb'));
      assert.ok(color3.startsWith('#') || color3.includes('rgb'));
    });

    it('should handle edge cases', () => {
      const matchWithMissingDigit = ['a ', 'a', undefined];
      const matchWithZero = ['a0 ', 'a', '0'];
      
      // Should not throw errors
      assert.doesNotThrow(() => getMatchColor(matchWithMissingDigit));
      assert.doesNotThrow(() => getMatchColor(matchWithZero));
    });

    it('should cycle through palette for high digits', () => {
      const match9 = ['a9 ', 'a', '9'];
      const match10 = ['a10 ', 'a', '10'];
      
      // Should not throw errors and return valid colors
      const color9 = getMatchColor(match9);
      const color10 = getMatchColor(match10);
      
      assert.equal(typeof color9, 'string');
      assert.equal(typeof color10, 'string');
    });
  });
});