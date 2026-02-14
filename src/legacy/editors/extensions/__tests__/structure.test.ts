// @ts-nocheck
// Unit tests for expression tracking logic
import { 
    findExpressionAtPosition, 
    isRangeActive, 
    createMarkersForRange,
    processExpressionRanges,
    findExpressionRanges 
} from '../structure.ts';

// Test data
const mockDocLines = [
    { text: '(a1 foo)', from: 0 },
    { text: '(a1 bar)', from: 9 },
    { text: '(d1 baz)', from: 18 }
];

const mockFindBoundsFn = (matchStart) => {
    // Mock implementation: each expression spans one line
    if (matchStart <= 8) return { from: 1, to: 1 };
    if (matchStart <= 17) return { from: 2, to: 2 };
    return { from: 3, to: 3 };
};

const mockDocLineFn = (line) => ({ from: (line - 1) * 9 });

// Test 1: findExpressionAtPosition should find expressions correctly
function testFindExpressionAtPosition() {
    console.log('Testing findExpressionAtPosition...');
    
    // Test case: cursor inside first (a1 foo)
    const result1 = findExpressionAtPosition(
        2, // cursor at position 2
        '(a1 foo)', // line text
        0, // line from
        (matchStart) => ({
            from: 1,
            startPos: 0,
            endPos: 8
        })
    );
    
    console.assert(result1 !== null, 'Should find expression');
    console.assert(result1.expressionType === 'a1', 'Should detect a1 expression');
    console.assert(result1.position.line === 1, 'Should be on line 1');
    
    // Test case: cursor outside expression
    const result2 = findExpressionAtPosition(
        50, // cursor way outside
        '(a1 foo)',
        0,
        (matchStart) => ({
            from: 1,
            startPos: 0,
            endPos: 8
        })
    );
    
    console.assert(result2 === null, 'Should not find expression when cursor is outside');
    
    console.log('✓ findExpressionAtPosition tests passed');
}

// Test 2: isRangeActive should determine activity correctly
function testIsRangeActive() {
    console.log('Testing isRangeActive...');
    
    const range = { from: 1, to: 3 };
    
    // Test case: no evaluation yet
    console.assert(isRangeActive(range, null) === false, 'Should be inactive when no evaluation');
    
    // Test case: evaluation within range
    const lastEval1 = { line: 2 };
    console.assert(isRangeActive(range, lastEval1) === true, 'Should be active when evaluation within range');
    
    // Test case: evaluation outside range
    const lastEval2 = { line: 5 };
    console.assert(isRangeActive(range, lastEval2) === false, 'Should be inactive when evaluation outside range');
    
    console.log('✓ isRangeActive tests passed');
}

// Test 3: processExpressionRanges should handle multiple expressions correctly
function testProcessExpressionRanges() {
    console.log('Testing processExpressionRanges...');
    
    const expressionRanges = new Map([
        ['a1', [
            { color: 'red', from: 1, to: 1 },
            { color: 'red', from: 2, to: 2 }
        ]],
        ['d1', [
            { color: 'blue', from: 3, to: 3 }
        ]]
    ]);
    
    // Test case: no evaluations yet - all should be inactive
    const lastEvaluatedEmpty = new Map();
    const markers1 = processExpressionRanges(expressionRanges, lastEvaluatedEmpty, mockDocLineFn);
    
    console.assert(markers1.length === 3, 'Should create 3 markers');
    console.assert(markers1.every(m => !m.marker.isActive), 'All markers should be inactive initially');
    
    // Test case: a1 evaluated at line 2 - only second a1 should be active
    const lastEvaluatedA1 = new Map([['a1', { line: 2 }]]);
    const markers2 = processExpressionRanges(expressionRanges, lastEvaluatedA1, mockDocLineFn);
    
    const a1Markers = markers2.filter(m => m.pos === 0 || m.pos === 9); // positions for a1 expressions
    const d1Markers = markers2.filter(m => m.pos === 18); // position for d1 expression
    
    console.assert(!a1Markers[0].marker.isActive, 'First a1 should be inactive');
    console.assert(a1Markers[1].marker.isActive, 'Second a1 should be active');
    console.assert(!d1Markers[0].marker.isActive, 'D1 should remain inactive');
    
    console.log('✓ processExpressionRanges tests passed');
}

// Test 4: Expression tracking behavior
function testExpressionTrackingBehavior() {
    console.log('Testing complete expression tracking behavior...');
    
    // Simulate the scenario described in requirements:
    // 1. Initially all expressions are greyed out
    // 2. When (a1 ...) is evaluated, it becomes active
    // 3. When a different (a1 ...) is evaluated, the new one becomes active and the old one becomes inactive
    
    const expressionRanges = new Map([
        ['a1', [
            { color: 'red', from: 1, to: 1, matchStart: 1 }, // First a1 expression
            { color: 'red', from: 3, to: 3, matchStart: 19 }, // Second a1 expression  
            { color: 'red', from: 5, to: 5, matchStart: 37 }  // Third a1 expression
        ]]
    ]);
    
    // Step 1: Initially no evaluations - all greyed out
    let lastEvaluated = new Map();
    let markers = processExpressionRanges(expressionRanges, lastEvaluated, mockDocLineFn);
    console.assert(markers.every(m => !m.marker.isActive), 'Step 1: All expressions should be greyed out initially');
    
    // Step 2: Evaluate first a1 expression
    lastEvaluated = new Map([['a1', { line: 1 }]]);
    markers = processExpressionRanges(expressionRanges, lastEvaluated, mockDocLineFn);
    const activeMarkers = markers.filter(m => m.marker.isActive);
    const inactiveMarkers = markers.filter(m => !m.marker.isActive);
    console.assert(activeMarkers.length === 1, 'Step 2: Only one expression should be active');
    console.assert(inactiveMarkers.length === 2, 'Step 2: Two expressions should be inactive');
    
    // Step 3: Evaluate second a1 expression - first becomes inactive, second becomes active
    lastEvaluated = new Map([['a1', { line: 3 }]]);
    markers = processExpressionRanges(expressionRanges, lastEvaluated, mockDocLineFn);
    const activeMarkers2 = markers.filter(m => m.marker.isActive);
    const inactiveMarkers2 = markers.filter(m => !m.marker.isActive);
    console.assert(activeMarkers2.length === 1, 'Step 3: Only one expression should be active');
    console.assert(inactiveMarkers2.length === 2, 'Step 3: Two expressions should be inactive');
    console.assert(activeMarkers2[0].pos === 18, 'Step 3: Second expression should be the active one');
    
    console.log('✓ Expression tracking behavior tests passed');
}

// Run all tests
function runAllTests() {
    console.log('Running expression tracking unit tests...\n');
    
    try {
        testFindExpressionAtPosition();
        testIsRangeActive();
        testProcessExpressionRanges();
        testExpressionTrackingBehavior();
        
        console.log('\n🎉 All tests passed!');
        return true;
    } catch (error) {
        console.error('\n❌ Tests failed:', error);
        return false;
    }
}

// Export for use in other contexts
export { runAllTests };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests();
}