// parser.test.js
// Run with: node tests/parser.test.js
// All tests should FAIL until parser.js is fully implemented.

const assert = require('assert');
const { parseRefdesList } = require('../src/parser');

// --------------------------------------------------------------------------
// Minimal test runner — no dependencies
// --------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

// Convenience: assert two arrays contain the same elements in the same order
function assertArrayEqual(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected,
    `${msg || ''}\n        expected: [${expected.join(', ')}]\n        actual:   [${actual.join(', ')}]`
  );
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

console.log('\nparser.js tests\n');

test('empty string returns empty array', () => {
  assertArrayEqual(parseRefdesList(''), []);
});

test('whitespace-only string returns empty array', () => {
  assertArrayEqual(parseRefdesList('   \n\t  '), []);
});

test('mixed separators: comma, semicolon, space, newline', () => {
  assertArrayEqual(parseRefdesList('R1, R2; R3\nR4'), ['R1', 'R2', 'R3', 'R4']);
});

test('case normalization: lowercase → uppercase', () => {
  assertArrayEqual(parseRefdesList('r1, c5'), ['C5', 'R1']);
});

test('basic range expansion: R1-R5', () => {
  assertArrayEqual(parseRefdesList('R1-R5'), ['R1', 'R2', 'R3', 'R4', 'R5']);
});

test('multi-digit range: U10-U12', () => {
  assertArrayEqual(parseRefdesList('U10-U12'), ['U10', 'U11', 'U12']);
});

test('multi-letter prefix range: TP1-TP3', () => {
  assertArrayEqual(parseRefdesList('TP1-TP3'), ['TP1', 'TP2', 'TP3']);
});

test('cross-prefix token is NOT expanded as a range: R1-C5', () => {
  // R1-C5 has different prefixes — treat as two separate tokens, not a range
  assertArrayEqual(parseRefdesList('R1-C5'), ['C5', 'R1']);
});

test('deduplication after range expansion: R1, R1-R3', () => {
  assertArrayEqual(parseRefdesList('R1, R1-R3'), ['R1', 'R2', 'R3']);
});

test('natural sort: R1 R10 R2 sorts as R1 R2 R10', () => {
  // Lexicographic sort would give R1, R10, R2 — wrong
  assertArrayEqual(parseRefdesList('R1 R10 R2'), ['R1', 'R2', 'R10']);
});

test('reversed range R8-R1 expands in correct ascending order', () => {
  assertArrayEqual(parseRefdesList('R8-R1'), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
});

// --------------------------------------------------------------------------
// Summary
// --------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
