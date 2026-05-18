// parser.js — refdes parsing logic
//
// Main export: parseRefdesList(rawText) → { tokens, errors }
//   Tokens is a sorted, deduplicated array of refdes strings.
//   Errors is an array of raw input tokens that could not be parsed.
//   e.g. parseRefdesList("R1-R3, c5") → { tokens: ["C5","R1","R2","R3"], errors: [] }
//
// This file works in both the browser (loaded via <script>) and Node.js
// (loaded via require()). The conditional export at the bottom enables this.

// Matches a single valid token: standard refdes (R1, TP3, U11_M1, R14_05),
// pure letters (GND), or pure digits (20).  Underscores and internal digits
// are accepted anywhere before the final digit suffix.
const REFDES_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\d+$|^[A-Za-z_]+$|^\d+$/;

// --------------------------------------------------------------------------
// stripComments(text)
// Removes // ... and # ... to end of line.
// --------------------------------------------------------------------------
function stripComments(text) {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '');
}

// --------------------------------------------------------------------------
// splitRefdes(s)
// Splits a token into a sortable { prefix, num } pair.  This is the single
// source of truth for the prefix/number boundary.  Splits at the *last*
// contiguous group of digits, so prefixes may include internal underscores
// and digits.
//
//   Standard refdes "TP10" → { prefix: "TP", num: 10 }
//   Complex prefix  "U11_M1" → { prefix: "U11_M", num: 1 }
//   Pure number  "20"   → { prefix: "",   num: 20  }  (sorts before all letters)
//   Pure letters "GND"  → { prefix: "GND", num: 0  }  (sorts before GND1, etc.)
// --------------------------------------------------------------------------
function splitRefdes(s) {
  const m = s.match(/^(.*?)(\d+)$/);
  if (m) return { prefix: m[1], num: parseInt(m[2], 10) };
  if (/^\d+$/.test(s)) return { prefix: '', num: parseInt(s, 10) };
  return { prefix: s, num: 0 };
}

// --------------------------------------------------------------------------
// naturalSort(a, b)
// Sorts refdes strings by prefix alphabetically, then by number numerically.
// Ensures R1, R2, R10 rather than the lexicographic R1, R10, R2.
// --------------------------------------------------------------------------
function naturalSort(a, b) {
  const pa = splitRefdes(a);
  const pb = splitRefdes(b);
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  return pa.num - pb.num;
}

// --------------------------------------------------------------------------
// expandToken(token)
// Takes a single whitespace/comma-separated token and returns
// { tokens: string[], errors: string[] }.
//
// Range syntax: if the token contains a hyphen, both sides are decomposed
// via splitRefdes.  Matching prefixes → expand the numeric range (reversed
// ranges like R8-R1 are tolerated via Math.min/max).  Mismatched prefixes
// (e.g. R1-C3) are reported as errors.  Single tokens are validated against
// REFDES_PATTERN; unrecognised tokens become errors.
// --------------------------------------------------------------------------
function expandToken(token) {
  // Range detection: split on hyphen, decompose both sides
  const hyphenIdx = token.indexOf('-');
  if (hyphenIdx !== -1) {
    const left  = token.slice(0, hyphenIdx);
    const right = token.slice(hyphenIdx + 1);

    // Guard against malformed ranges like "R1-" or "-R5"
    if (left && right) {
      const a = splitRefdes(left);
      const b = splitRefdes(right);

      if (a.prefix.toUpperCase() === b.prefix.toUpperCase()) {
        // Same prefix — expand the numeric range.
        const start  = Math.min(a.num, b.num);
        const end    = Math.max(a.num, b.num);
        const prefix = a.prefix.toUpperCase();
        const items  = [];
        for (let i = start; i <= end; i++) items.push(prefix + i);
        return { tokens: items, errors: [] };
      }

      // Different prefixes — not a valid range
      return { tokens: [], errors: [token] };
    }
  }

  // Single refdes token — uppercase and return if valid
  if (REFDES_PATTERN.test(token)) {
    return { tokens: [token.toUpperCase()], errors: [] };
  }

  // Unrecognised
  return { tokens: [], errors: [token] };
}

// --------------------------------------------------------------------------
// collapseToRuns(tokens, groupKeyOf)
// Collapses a sorted refdes array into consecutive runs.
//
//   tokens:     sorted array of refdes strings
//   groupKeyOf: function(token) → string key; runs that share the same key
//               are eligible to form a range.  Ranges never cross key
//               boundaries.  Pass () => '' to collapse purely by sequence.
//
// A run can only extend while: same prefix, consecutive number, same groupKey.
// Returns Array<Array<string>> — each inner array is one run of consecutive,
// same-group tokens.
// --------------------------------------------------------------------------
function collapseToRuns(tokens, groupKeyOf) {
  const runs = [];
  let i = 0;

  while (i < tokens.length) {
    const run = [tokens[i]];
    const { prefix, num } = splitRefdes(tokens[i]);
    const key = groupKeyOf(tokens[i]);

    // Extend the run as long as prefix, consecutive number, and groupKey match
    let j = i + 1;
    while (j < tokens.length) {
      const { prefix: p2, num: n2 } = splitRefdes(tokens[j]);
      if (p2 === prefix && n2 === num + (j - i) && groupKeyOf(tokens[j]) === key) {
        run.push(tokens[j]);
        j++;
      } else {
        break;
      }
    }

    runs.push(run);
    i = j;
  }

  return runs;
}

// --------------------------------------------------------------------------
// parseRefdesList(rawText) — public entry point
//
// Returns { tokens: string[], errors: string[] }.
//   tokens: sorted, deduplicated, uppercased refdes strings.
//   errors: raw input tokens that could not be parsed (for use in
//           caller-provided error messages).
//
// Pipeline: strip comments → split on whitespace/commas/semicolons
//           → expand each token (ranges + validation) → deduplicate
//           → natural sort
// --------------------------------------------------------------------------
function parseRefdesList(rawText) {
  if (!rawText || rawText.trim() === '') return { tokens: [], errors: [] };

  const cleaned  = stripComments(rawText);
  const chunks   = cleaned.split(/[\s,;]+/).filter(Boolean);

  const allTokens = [];
  const allErrors = [];

  for (const chunk of chunks) {
    const { tokens, errors } = expandToken(chunk);
    allTokens.push(...tokens);
    allErrors.push(...errors);
  }

  const unique = [...new Set(allTokens)];
  return { tokens: unique.sort(naturalSort), errors: allErrors };
}

// --------------------------------------------------------------------------
// Node.js compatibility — allows require('./parser') outside the browser
// --------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = { parseRefdesList, splitRefdes, collapseToRuns, naturalSort };
}
