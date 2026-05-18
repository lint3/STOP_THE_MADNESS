// parser.test.js — tests for parser.js (refdes parsing logic)
//
// Run with: node --test
// Requires Node 18+ for built-in test runner.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseRefdesList, splitRefdes, collapseToRanges, naturalSort } = require('../parser.js');

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
    it('returns empty array for empty input', () => {
      assert.deepStrictEqual(parseRefdesList(''), []);
      assert.deepStrictEqual(parseRefdesList('   '), []);
      assert.deepStrictEqual(parseRefdesList(null), []);
      assert.deepStrictEqual(parseRefdesList(undefined), []);
    });

    it('parses a single refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1'), ['R1']);
      assert.deepStrictEqual(parseRefdesList('c5'), ['C5']);
    });

    it('parses comma-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R2, R3'), ['R1', 'R2', 'R3']);
    });

    it('parses whitespace-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1 R2 R3'), ['R1', 'R2', 'R3']);
    });

    it('parses semicolon-separated refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1;R2;R3'), ['R1', 'R2', 'R3']);
    });

    it('handles mixed delimiters', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R2 R3;C5'), ['C5', 'R1', 'R2', 'R3']);
    });

    it('normalizes to uppercase', () => {
      assert.deepStrictEqual(parseRefdesList('r1, c5, tp10'), ['C5', 'R1', 'TP10']);
    });
  });

  describe('range expansion', () => {
    it('expands a simple range', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R5'), ['R1', 'R2', 'R3', 'R4', 'R5']);
    });

    it('expands a range with multi-char prefix', () => {
      assert.deepStrictEqual(parseRefdesList('TP10-TP12'), ['TP10', 'TP11', 'TP12']);
    });

    it('handles reversed ranges', () => {
      assert.deepStrictEqual(parseRefdesList('R8-R1'), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
    });

    it('handles mixed-case ranges', () => {
      assert.deepStrictEqual(parseRefdesList('r1-R3'), ['R1', 'R2', 'R3']);
    });

    it('expands ranges with complex prefixes (internal digits/underscores)', () => {
      assert.deepStrictEqual(
        parseRefdesList('U11_M1-U11_M3'),
        ['U11_M1', 'U11_M2', 'U11_M3']
      );
    });

    it('treats different-prefix hyphen tokens as two separate refdes', () => {
      assert.deepStrictEqual(parseRefdesList('R1-C5'), ['C5', 'R1']);
    });

    it('expands ranges within a larger mixed list', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1-R3, C5-C7, TP10'),
        ['C5', 'C6', 'C7', 'R1', 'R2', 'R3', 'TP10']
      );
    });
  });

  describe('deduplication', () => {
    it('removes duplicate tokens', () => {
      assert.deepStrictEqual(parseRefdesList('R1, R1, R1'), ['R1']);
    });

    it('removes duplicates produced by range overlap', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R3, R2-R4'), ['R1', 'R2', 'R3', 'R4']);
    });
  });

  describe('sort order', () => {
    it('sorts naturally (prefix then number)', () => {
      assert.deepStrictEqual(
        parseRefdesList('R10, R2, R1'),
        ['R1', 'R2', 'R10']
      );
    });

    it('sorts different prefixes alphabetically', () => {
      assert.deepStrictEqual(
        parseRefdesList('C5, R1, D3'),
        ['C5', 'D3', 'R1']
      );
    });
  });

  describe('comment handling', () => {
    it('strips // style comments', () => {
      assert.deepStrictEqual(parseRefdesList('R1 // this is a note'), ['R1']);
    });

    it('strips # style comments', () => {
      assert.deepStrictEqual(parseRefdesList('R1 # comment'), ['R1']);
    });

    it('handles comments on their own lines', () => {
      assert.deepStrictEqual(parseRefdesList('# header comment\nR1, R2'), ['R1', 'R2']);
    });

    it('handles inline comments within a list', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1, // comment\nR2 # note\nR3'),
        ['R1', 'R2', 'R3']
      );
    });
  });

  describe('pure letter and digit tokens', () => {
    it('accepts pure letter tokens like GND', () => {
      assert.deepStrictEqual(parseRefdesList('GND'), ['GND']);
    });

    it('accepts pure digit tokens', () => {
      assert.deepStrictEqual(parseRefdesList('20'), ['20']);
    });

    it('sorts pure-digit before pure-letter and both before standard refdes', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1, GND, 20'),
        ['20', 'GND', 'R1']
      );
    });

    it('sorts pure-letter before numbered variants', () => {
      assert.deepStrictEqual(
        parseRefdesList('GND1, GND2, GND'),
        ['GND', 'GND1', 'GND2']
      );
    });
  });

  describe('error collection', () => {
    it('silently drops invalid tokens when no errorsOut array', () => {
      const result = parseRefdesList('R1, NOTVALID!, C5');
      assert.deepStrictEqual(result, ['C5', 'R1']);
    });

    it('collects invalid tokens in errorsOut array', () => {
      const errors = [];
      const result = parseRefdesList('R1, NOTVALID!, C5, @@@', errors);
      assert.deepStrictEqual(result, ['C5', 'R1']);
      assert.deepStrictEqual(errors, ['NOTVALID!', '@@@']);
    });

    it('errorsOut array is not modified for valid tokens', () => {
      const errors = [];
      parseRefdesList('R1-R3, C5', errors);
      assert.deepStrictEqual(errors, []);
    });
  });

  describe('edge cases', () => {
    it('handles extra whitespace', () => {
      assert.deepStrictEqual(
        parseRefdesList('  R1 ,  R2  , R3  '),
        ['R1', 'R2', 'R3']
      );
    });

    it('handles newlines as delimiters', () => {
      assert.deepStrictEqual(
        parseRefdesList('R1\nR2\nR3'),
        ['R1', 'R2', 'R3']
      );
    });

    it('handles single-element range (R1-R1)', () => {
      assert.deepStrictEqual(parseRefdesList('R1-R1'), ['R1']);
    });

    it('handles range where start num has more digits than end', () => {
      assert.deepStrictEqual(parseRefdesList('R100-R99'), ['R99', 'R100']);
    });

    it('handles refdes with underscores', () => {
      assert.deepStrictEqual(parseRefdesList('TP_1'), ['TP_1']);
    });
  });
});

// ==========================================================================
// collapseToRanges
// ==========================================================================

describe('collapseToRanges', () => {
  const identityKey = () => '';
  const identityCls = (t) => t.startsWith('R') ? 'r' : 'c';

  it('collapses a consecutive run into range notation', () => {
    const result = collapseToRanges(['R1', 'R2', 'R3'], identityKey);
    assert.deepStrictEqual(result, [
      { display: 'R1-R3', statusClass: '', title: '' },
    ]);
  });

  it('leaves singletons alone', () => {
    const result = collapseToRanges(['R1', 'R3', 'R5'], identityKey);
    assert.deepStrictEqual(result, [
      { display: 'R1', statusClass: '', title: '' },
      { display: 'R3', statusClass: '', title: '' },
      { display: 'R5', statusClass: '', title: '' },
    ]);
  });

  it('collapses multiple independent runs', () => {
    const result = collapseToRanges(['R1', 'R2', 'R3', 'R5', 'R6'], identityKey);
    assert.deepStrictEqual(result, [
      { display: 'R1-R3', statusClass: '', title: '' },
      { display: 'R5-R6', statusClass: '', title: '' },
    ]);
  });

  it('does not collapse across different prefixes', () => {
    const result = collapseToRanges(['C1', 'C2', 'R1', 'R2'], identityKey);
    assert.deepStrictEqual(result, [
      { display: 'C1-C2', statusClass: '', title: '' },
      { display: 'R1-R2', statusClass: '', title: '' },
    ]);
  });

  it('does not collapse across group key boundaries', () => {
    const tokens = ['R1', 'R2', 'R3', 'R4'];
    const keyOf = (t) => t === 'R3' ? 'barrier' : 'default';
    const result = collapseToRanges(tokens, keyOf);
    assert.deepStrictEqual(result, [
      { display: 'R1-R2', statusClass: 'default', title: '' },
      { display: 'R3', statusClass: 'barrier', title: '' },
      { display: 'R4', statusClass: 'default', title: '' },
    ]);
  });

  it('uses classOf for statusClass', () => {
    const result = collapseToRanges(['R1', 'R2'], identityKey, identityCls);
    assert.strictEqual(result[0].statusClass, 'r');
  });

  it('returns empty array for empty input', () => {
    const result = collapseToRanges([], identityKey);
    assert.deepStrictEqual(result, []);
  });

  it('handles single-element array', () => {
    const result = collapseToRanges(['R1'], identityKey);
    assert.deepStrictEqual(result, [
      { display: 'R1', statusClass: '', title: '' },
    ]);
  });

  it('when classOf is omitted, defaults to groupKeyOf', () => {
    const keyOf = (t) => 'some-key';
    const result = collapseToRanges(['R1'], keyOf);
    assert.strictEqual(result[0].statusClass, 'some-key');
  });

  it('aggregates titles across a run via titleOf', () => {
    const titleOf = (t) => {
      if (t === 'R1') return ['src-A', 'src-B'];
      if (t === 'R2') return ['src-C'];
      return [];
    };
    const result = collapseToRanges(['R1', 'R2', 'R3'], identityKey, undefined, titleOf);
    assert.strictEqual(result[0].title, 'src-A, src-B, src-C');
  });

  it('leaves title empty when titleOf is omitted', () => {
    const result = collapseToRanges(['R1', 'R2'], identityKey);
    assert.strictEqual(result[0].title, '');
  });

  it('deduplicates titles within a run', () => {
    const titleOf = (t) => ['src-A'];
    const result = collapseToRanges(['R1', 'R2'], identityKey, undefined, titleOf);
    assert.strictEqual(result[0].title, 'src-A');
  });

  it('handles complex prefix refdes in runs', () => {
    const tokens = ['U11_M1', 'U11_M2', 'U11_M3'];
    const result = collapseToRanges(tokens, identityKey);
    assert.deepStrictEqual(result, [
      { display: 'U11_M1-U11_M3', statusClass: '', title: '' },
    ]);
  });
});
