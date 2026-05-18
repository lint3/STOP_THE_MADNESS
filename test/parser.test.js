// parser.test.js — tests for parser.js (refdes parsing logic)
//
// Run with: node --test
// Requires Node 18+ for built-in test runner.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseRefdesList, splitRefdes, collapseToRuns, naturalSort } = require('../parser.js');

// ==========================================================================
// splitRefdes
// ==========================================================================

describe('splitRefdes', () => {
  it('splits a standard refdes into prefix and number', () => {
    assert.deepStrictEqual(splitRefdes('TP10'), { prefix: 'TP', num: 10 });
    assert.deepStrictEqual(splitRefdes('R1'), { prefix: 'R', num: 1 });
    assert.deepStrictEqual(splitRefdes('C99'), { prefix: 'C', num: 99 });
  });

  it('splits at the last digit group (supports internal digits)', () => {
    assert.deepStrictEqual(splitRefdes('U11_M1'), { prefix: 'U11_M', num: 1 });
    assert.deepStrictEqual(splitRefdes('R14_05'), { prefix: 'R14_', num: 5 });
    assert.deepStrictEqual(splitRefdes('A1B2C3'), { prefix: 'A1B2C', num: 3 });
  });

  it('handles pure digit tokens', () => {
    assert.deepStrictEqual(splitRefdes('20'), { prefix: '', num: 20 });
    assert.deepStrictEqual(splitRefdes('0'), { prefix: '', num: 0 });
    assert.deepStrictEqual(splitRefdes('999'), { prefix: '', num: 999 });
  });

  it('handles pure letter tokens', () => {
    assert.deepStrictEqual(splitRefdes('GND'), { prefix: 'GND', num: 0 });
    assert.deepStrictEqual(splitRefdes('VCC'), { prefix: 'VCC', num: 0 });
  });
});

// ==========================================================================
// naturalSort
// ==========================================================================

describe('naturalSort', () => {
  it('sorts by prefix then number (not lexicographically)', () => {
    const input = ['R10', 'R2', 'R1'];
    const sorted = input.sort(naturalSort);
    assert.deepStrictEqual(sorted, ['R1', 'R2', 'R10']);
  });

  it('sorts different prefixes alphabetically', () => {
    const input = ['C5', 'R1', 'A10', 'C1'];
    const sorted = input.sort(naturalSort);
    assert.deepStrictEqual(sorted, ['A10', 'C1', 'C5', 'R1']);
  });

  it('sorts pure-number tokens before letter-prefixed tokens', () => {
    const input = ['R1', '20', 'C5', '10'];
    const sorted = input.sort(naturalSort);
    assert.deepStrictEqual(sorted, ['10', '20', 'C5', 'R1']);
  });

  it('sorts pure-letter tokens before numbered variants of same prefix', () => {
    const input = ['GND1', 'GND', 'GND2'];
    const sorted = input.sort(naturalSort);
    assert.deepStrictEqual(sorted, ['GND', 'GND1', 'GND2']);
  });

  it('handles complex prefixes correctly', () => {
    const input = ['U11_M10', 'U11_M1', 'U11_M2'];
    const sorted = input.sort(naturalSort);
    assert.deepStrictEqual(sorted, ['U11_M1', 'U11_M2', 'U11_M10']);
  });
});

// ==========================================================================
// parseRefdesList
// ==========================================================================

describe('parseRefdesList', () => {
  describe('basic parsing', () => {
    it('returns empty arrays for empty input', () => {
      assert.deepStrictEqual(parseRefdesList(''), { tokens: [], errors: [] });
      assert.deepStrictEqual(parseRefdesList('   '), { tokens: [], errors: [] });
      assert.deepStrictEqual(parseRefdesList(null), { tokens: [], errors: [] });
      assert.deepStrictEqual(parseRefdesList(undefined), { tokens: [], errors: [] });
    });

    it('parses a single refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1').tokens, ['R1']);
      assert.deepStrictEqual(parseRefdesList('c5').tokens, ['C5']);
    });

    it('parses comma-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R2, R3').tokens, ['R1', 'R2', 'R3']);
    });

    it('parses whitespace-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1 R2 R3').tokens, ['R1', 'R2', 'R3']);
    });

    it('parses semicolon-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1;R2;R3').tokens, ['R1', 'R2', 'R3']);
    });

    it('handles mixed delimiters', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R2 R3;C5').tokens, ['C5', 'R1', 'R2', 'R3']);
    });

    it('normalizes to uppercase', () => {
      assert.deepStrictEqual(parseRefdesList('r1, c5, tp10').tokens, ['C5', 'R1', 'TP10']);
    });
  });

  describe('range expansion', () => {
    it('expands a simple range', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R5').tokens, ['R1', 'R2', 'R3', 'R4', 'R5']);
    });

    it('expands a range with multi-char prefix', () => {
      assert.deepStrictEqual(parseRefdesList('TP10-TP12').tokens, ['TP10', 'TP11', 'TP12']);
    });

    it('handles reversed ranges', () => {
      assert.deepStrictEqual(parseRefdesList('R8-R1').tokens, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
    });

    it('handles mixed-case ranges', () => {
      assert.deepStrictEqual(parseRefdesList('r1-R3').tokens, ['R1', 'R2', 'R3']);
    });

    it('expands ranges with complex prefixes (internal digits/underscores)', () => {
      assert.deepStrictEqual(
        parseRefdesList('U11_M1-U11_M3').tokens,
        ['U11_M1', 'U11_M2', 'U11_M3']
      );
    });

    it('expands pure-number ranges', () => {
      assert.deepStrictEqual(parseRefdesList('10-15').tokens, ['10', '11', '12', '13', '14', '15']);
    });

    it('reports mismatched-prefix ranges as errors', () => {
      const result = parseRefdesList('R1-C3');
      assert.deepStrictEqual(result.tokens, []);
      assert.deepStrictEqual(result.errors, ['R1-C3']);
    });

    it('expands ranges within a larger mixed list', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1-R3, C5-C7, TP10').tokens,
        ['C5', 'C6', 'C7', 'R1', 'R2', 'R3', 'TP10']
      );
    });
  });

  describe('deduplication', () => {
    it('removes duplicate tokens', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R1, R1').tokens, ['R1']);
    });

    it('removes duplicates produced by range overlap', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R3, R2-R4').tokens, ['R1', 'R2', 'R3', 'R4']);
    });
  });

  describe('sort order', () => {
    it('sorts naturally (prefix then number)', () => {
      assert.deepStrictEqual(
        parseRefdesList('R10, R2, R1').tokens,
        ['R1', 'R2', 'R10']
      );
    });

    it('sorts different prefixes alphabetically', () => {
      assert.deepStrictEqual(
        parseRefdesList('C5, R1, D3').tokens,
        ['C5', 'D3', 'R1']
      );
    });
  });

  describe('comment handling', () => {
    it('strips // style comments', () => {
      assert.deepStrictEqual(parseRefdesList('R1 // this is a note').tokens, ['R1']);
    });

    it('strips # style comments', () => {
      assert.deepStrictEqual(parseRefdesList('R1 # comment').tokens, ['R1']);
    });

    it('handles comments on their own lines', () => {
      assert.deepStrictEqual(parseRefdesList('# header comment\nR1, R2').tokens, ['R1', 'R2']);
    });

    it('handles inline comments within a list', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1, // comment\nR2 # note\nR3').tokens,
        ['R1', 'R2', 'R3']
      );
    });
  });

  describe('pure letter and digit tokens', () => {
    it('accepts pure letter tokens like GND', () => {
      assert.deepStrictEqual(parseRefdesList('GND').tokens, ['GND']);
    });

    it('accepts pure digit tokens', () => {
      assert.deepStrictEqual(parseRefdesList('20').tokens, ['20']);
    });

    it('sorts pure-digit before pure-letter and both before standard refdes', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1, GND, 20').tokens,
        ['20', 'GND', 'R1']
      );
    });

    it('sorts pure-letter before numbered variants', () => {
      assert.deepStrictEqual(
        parseRefdesList('GND1, GND2, GND').tokens,
        ['GND', 'GND1', 'GND2']
      );
    });
  });

  describe('error collection', () => {
    it('reports unrecognized tokens in errors array', () => {
      const result = parseRefdesList('R1, NOTVALID!, C5');
      assert.deepStrictEqual(result.tokens, ['C5', 'R1']);
      assert.deepStrictEqual(result.errors, ['NOTVALID!']);
    });

    it('reports multiple errors', () => {
      const result = parseRefdesList('R1, NOTVALID!, C5, @@@');
      assert.deepStrictEqual(result.tokens, ['C5', 'R1']);
      assert.deepStrictEqual(result.errors, ['NOTVALID!', '@@@']);
    });

    it('returns empty errors for valid input', () => {
      const result = parseRefdesList('R1-R3, C5');
      assert.deepStrictEqual(result.errors, []);
    });

    it('reports mismatched-prefix ranges as errors', () => {
      const result = parseRefdesList('R1-C3, U2-U5, X10');
      assert.deepStrictEqual(result.tokens, ['U2', 'U3', 'U4', 'U5', 'X10']);
      assert.deepStrictEqual(result.errors, ['R1-C3']);
    });
  });

  describe('edge cases', () => {
    it('handles extra whitespace', () => {
      assert.deepStrictEqual(
        parseRefdesList('  R1 ,  R2  , R3  ').tokens,
        ['R1', 'R2', 'R3']
      );
    });

    it('handles newlines as delimiters', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1\nR2\nR3').tokens,
        ['R1', 'R2', 'R3']
      );
    });

    it('handles single-element range (R1-R1)', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R1').tokens, ['R1']);
    });

    it('handles range where start num has more digits than end', () => {
      assert.deepStrictEqual(parseRefdesList('R100-R99').tokens, ['R99', 'R100']);
    });

    it('accepts zero-based refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R0').tokens, ['R0']);
    });

    it('expands zero-based ranges', () => {
      assert.deepStrictEqual(parseRefdesList('R0-R3').tokens, ['R0', 'R1', 'R2', 'R3']);
    });

    it('handles refdes with underscores', () => {
      assert.deepStrictEqual(parseRefdesList('TP_1').tokens, ['TP_1']);
    });

    it('reports malformed range R1- as error', () => {
      const result = parseRefdesList('R1-');
      assert.deepStrictEqual(result.errors, ['R1-']);
    });

    it('reports malformed range -R5 as error', () => {
      const result = parseRefdesList('-R5');
      assert.deepStrictEqual(result.errors, ['-R5']);
    });
  });
});

// ==========================================================================
// collapseToRuns
// ==========================================================================

describe('collapseToRuns', () => {
  const identityKey = () => '';

  it('collapses a consecutive run into a single group', () => {
    const result = collapseToRuns(['R1', 'R2', 'R3'], identityKey);
    assert.deepStrictEqual(result, [['R1', 'R2', 'R3']]);
  });

  it('leaves singletons as single-element groups', () => {
    const result = collapseToRuns(['R1', 'R3', 'R5'], identityKey);
    assert.deepStrictEqual(result, [['R1'], ['R3'], ['R5']]);
  });

  it('collapses multiple independent runs', () => {
    const result = collapseToRuns(['R1', 'R2', 'R3', 'R5', 'R6'], identityKey);
    assert.deepStrictEqual(result, [['R1', 'R2', 'R3'], ['R5', 'R6']]);
  });

  it('does not collapse across different prefixes', () => {
    const result = collapseToRuns(['C1', 'C2', 'R1', 'R2'], identityKey);
    assert.deepStrictEqual(result, [['C1', 'C2'], ['R1', 'R2']]);
  });

  it('does not collapse across group key boundaries', () => {
    const tokens = ['R1', 'R2', 'R3', 'R4'];
    const keyOf = (t) => t === 'R3' ? 'barrier' : 'default';
    const result = collapseToRuns(tokens, keyOf);
    assert.deepStrictEqual(result, [
      ['R1', 'R2'],
      ['R3'],
      ['R4'],
    ]);
  });

  it('returns empty array for empty input', () => {
    const result = collapseToRuns([], identityKey);
    assert.deepStrictEqual(result, []);
  });

  it('handles single-element array', () => {
    const result = collapseToRuns(['R1'], identityKey);
    assert.deepStrictEqual(result, [['R1']]);
  });

  it('handles complex prefix refdes in runs', () => {
    const tokens = ['U11_M1', 'U11_M2', 'U11_M3'];
    const result = collapseToRuns(tokens, identityKey);
    assert.deepStrictEqual(result, [['U11_M1', 'U11_M2', 'U11_M3']]);
  });

  it('collapses zero-based runs', () => {
    const result = collapseToRuns(['R0', 'R1', 'R2', 'R3'], identityKey);
    assert.deepStrictEqual(result, [['R0', 'R1', 'R2', 'R3']]);
  });

  it('does not collapse non-consecutive numbers with same prefix', () => {
    const result = collapseToRuns(['R1', 'R2', 'R5', 'R6'], identityKey);
    assert.deepStrictEqual(result, [['R1', 'R2'], ['R5', 'R6']]);
  });
});
