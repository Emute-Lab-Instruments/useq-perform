// Vitest unit tests for pure functions in visReadability extension.
// These functions are DOM-independent and can be tested without a browser.

import { describe, it, expect } from 'vitest';
import {
  getLineContentBounds,
  groupIntoBlocks,
  buildBlockPolygonPath,
  type PixelLineBounds,
} from './visReadability.ts';

// ---------------------------------------------------------------------------
// getLineContentBounds
// ---------------------------------------------------------------------------
describe('getLineContentBounds', () => {
  it('empty string returns start=0 end=0', () => {
    expect(getLineContentBounds('')).toEqual({ start: 0, end: 0 });
  });

  it('whitespace-only string returns start=end=length', () => {
    const result = getLineContentBounds('   ');
    expect(result.start).toBe(result.end);
  });

  it('no leading/trailing spaces: start=0, end=length', () => {
    expect(getLineContentBounds('hello')).toEqual({ start: 0, end: 5 });
  });

  it('leading spaces only', () => {
    expect(getLineContentBounds('  foo')).toEqual({ start: 2, end: 5 });
  });

  it('trailing spaces only', () => {
    expect(getLineContentBounds('bar   ')).toEqual({ start: 0, end: 3 });
  });

  it('leading and trailing spaces', () => {
    expect(getLineContentBounds('  baz  ')).toEqual({ start: 2, end: 5 });
  });

  it('internal spaces are included (not trimmed)', () => {
    expect(getLineContentBounds('  a b c  ')).toEqual({ start: 2, end: 7 });
  });

  it('single non-space character', () => {
    expect(getLineContentBounds(' x ')).toEqual({ start: 1, end: 2 });
  });

  it('tabs are treated as non-space (only space is stripped)', () => {
    // Tabs are whitespace but the function only strips ASCII space (32)
    expect(getLineContentBounds('\tfoo\t')).toEqual({ start: 0, end: 5 });
  });
});

// ---------------------------------------------------------------------------
// groupIntoBlocks
// ---------------------------------------------------------------------------

function makeLine(lineIndex: number, left = 0, right = 100): PixelLineBounds {
  const top = (lineIndex - 1) * 20;
  return { lineIndex, left, right, top, bottom: top + 20 };
}

describe('groupIntoBlocks', () => {
  it('empty input returns empty array', () => {
    expect(groupIntoBlocks([])).toEqual([]);
  });

  it('single line is one group', () => {
    const lines = [makeLine(1)];
    expect(groupIntoBlocks(lines)).toEqual([[makeLine(1)]]);
  });

  it('two adjacent lines form one group', () => {
    const lines = [makeLine(1), makeLine(2)];
    expect(groupIntoBlocks(lines)).toEqual([lines]);
  });

  it('non-adjacent lines form separate groups', () => {
    const l1 = makeLine(1);
    const l3 = makeLine(3);
    const groups = groupIntoBlocks([l1, l3]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([l1]);
    expect(groups[1]).toEqual([l3]);
  });

  it('mixed adjacent and non-adjacent lines', () => {
    const l1 = makeLine(1);
    const l2 = makeLine(2);
    const l4 = makeLine(4);
    const l5 = makeLine(5);
    const groups = groupIntoBlocks([l1, l2, l4, l5]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([l1, l2]);
    expect(groups[1]).toEqual([l4, l5]);
  });

  it('three separate single-line groups', () => {
    const groups = groupIntoBlocks([makeLine(1), makeLine(3), makeLine(5)]);
    expect(groups).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// buildBlockPolygonPath
// ---------------------------------------------------------------------------

function makePx(lineIndex: number, left: number, right: number): PixelLineBounds {
  const top = (lineIndex - 1) * 20;
  return { lineIndex, left, right, top, bottom: top + 20 };
}

describe('buildBlockPolygonPath', () => {
  it('empty group returns empty string', () => {
    expect(buildBlockPolygonPath([], 0)).toBe('');
  });

  it('single line produces a rectangular path', () => {
    const line = makePx(1, 10, 50);
    const path = buildBlockPolygonPath([line], 0);
    // The path should be a closed polygon (starts with M, ends with Z)
    expect(path).toMatch(/^M/);
    expect(path).toMatch(/Z$/);
    // Should contain the four corners: (10,0), (50,0), (50,20), (10,20)
    expect(path).toContain('10,0');
    expect(path).toContain('50,0');
    expect(path).toContain('50,20');
    expect(path).toContain('10,20');
  });

  it('padding expands bounds outward', () => {
    const line = makePx(1, 10, 50);
    const path = buildBlockPolygonPath([line], 5);
    // With P=5: left=5, right=55, top=-5, bottom=25
    expect(path).toContain('5,-5');
    expect(path).toContain('55,-5');
    expect(path).toContain('55,25');
    expect(path).toContain('5,25');
  });

  it('two same-width lines produce a rectangle', () => {
    const lines = [makePx(1, 10, 50), makePx(2, 10, 50)];
    const path = buildBlockPolygonPath(lines, 0);
    expect(path).toMatch(/^M/);
    expect(path).toMatch(/Z$/);
    // Should be a simple rectangle: no staircase steps
    expect(path).toContain('50,0');
    expect(path).toContain('50,40'); // bottom of line 2
    expect(path).toContain('10,40');
    expect(path).toContain('10,0');
  });

  it('second line wider on right creates step-out on right side', () => {
    // Line 1: right=50, Line 2: right=80
    const lines = [makePx(1, 10, 50), makePx(2, 10, 80)];
    const path = buildBlockPolygonPath(lines, 0);
    // Right side should have a step: (50,20) then (80,20)
    expect(path).toContain('50,20');
    expect(path).toContain('80,20');
    expect(path).toContain('80,40');
  });

  it('second line narrower on right creates step-in on right side', () => {
    // Line 1: right=80, Line 2: right=50
    const lines = [makePx(1, 10, 80), makePx(2, 10, 50)];
    const path = buildBlockPolygonPath(lines, 0);
    // Right side should have a step: (80,20) then (50,20)
    expect(path).toContain('80,20');
    expect(path).toContain('50,20');
    expect(path).toContain('50,40');
  });

  it('second line more indented creates step-in on left side', () => {
    // Line 1: left=10, Line 2: left=20 (more indented)
    const lines = [makePx(1, 10, 60), makePx(2, 20, 60)];
    const path = buildBlockPolygonPath(lines, 0);
    // Left side going up: from (20,40) step to (20,20) then (10,20) then (10,0)
    expect(path).toContain('20,40');
    expect(path).toContain('20,20');
    expect(path).toContain('10,20');
    expect(path).toContain('10,0');
  });

  it('returns a valid SVG path string format', () => {
    const lines = [makePx(1, 10, 50), makePx(2, 5, 70)];
    const path = buildBlockPolygonPath(lines, 0);
    // Should be parseable as SVG path (starts with M, coordinates, ends with Z)
    expect(path).toMatch(/^M[-\d.,]+(?:L[-\d.,]+)*Z$/);
  });
});
