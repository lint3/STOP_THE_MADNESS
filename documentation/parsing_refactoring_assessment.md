# Parsing Refactoring Assessment

## Current Quality

The parsing logic in `parser.js` is **functional, concise (180 lines), well-commented, and handles edge cases correctly** (reversed ranges, pure-letter tokens, pure-digit tokens, internal underscores/digits in prefixes). However, several design choices make the code harder to understand, maintain, and extend than necessary.

---

## Problem 1: Duplicate "Last Digit Group" Logic

### What's wrong

Two independent mechanisms implement the same concept — identifying the last contiguous group of digits in a refdes token so everything before it becomes the prefix:

| Location | Mechanism | Purpose |
|----------|-----------|---------|
| `RANGE_PATTERN` (`parser.js:14`) | Non-greedy `*?` + regex backtracking | Detect and decompose range tokens (`R1-R5` → prefix `R`, nums `1`/`5`) |
| `splitRefdes` (`parser.js:81`) | `^(.*?)(\d+)$` non-greedy capture | Decompose single tokens for sorting (`TP10` → prefix `TP`, num `10`) |

Both produce the correct result for all practical inputs, but:

1. **The RANGE_PATTERN approach is opaque.** Understanding why `U11_M1-U11_M8` splits at `U11_M`/`1` rather than `U`/`11` requires tracing regex backtracking across the full pattern. The comment describes the *intent* clearly, but the regex implements it indirectly.

2. **They could diverge.** If someone modified one without realizing the other exists, the range parser and the sorter could start using different prefix boundaries, producing subtly wrong results.

3. **`splitRefdes` is the cleaner implementation.** The `^(.*?)(\d+)$` pattern is self-explanatory: capture the shortest prefix that leaves at least one digit for the suffix. This should be the single source of truth.

### Suggested fix

Replace `RANGE_PATTERN` with a `splitPrefixNum`-based approach for range detection. Instead of:

```js
const RANGE_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*?)(\d+)-([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/;
// ... then regex.match() + backtracking
```

Use a function that splits on `-`, then decomposes each side with the same `splitRefdes` logic:

```js
function tryExpandRange(token) {
  const hyphenIdx = token.indexOf('-');
  if (hyphenIdx === -1) return null;  // not a range

  const a = splitRefdes(token.slice(0, hyphenIdx));
  const b = splitRefdes(token.slice(hyphenIdx + 1));

  // Only a range if both sides are valid refdes (have digits) and share prefix
  if (a.prefix === b.prefix) { /* expand numeric range */ }
  // else: different prefixes → two separate tokens ("R1-C5" case)
}
```

This reads like the comment describes it, with no backtracking magic.

---

## Problem 2: `collapseToRanges` Mixes Parsing and Rendering

### What's wrong

`collapseToRanges` (`parser.js:122-156`) lives in `parser.js` — a file described as "refdes parsing logic" — but half its concerns are UI-oriented:

- It accepts `classOf`/`titleOf` callbacks, passed from `app.js`.
- It returns `{ display, statusClass, title }` — display strings, CSS class names, and tooltip text.
- It aggregates tooltip text across runs (`[...new Set(tokens...flatMap(t => titleOf(t)))]`).
- The `statusClass` key name implies HTML/CSS, not data.

A clean architecture separates:
- **Parsing:** pure data transformations (token arrays → run arrays)
- **Rendering:** data → display strings, CSS classes, tooltips

### Suggested fix

Split into two layers:

**Parser layer** — a pure function returning runs as data:

```js
function collapseToRuns(tokens, groupKeyOf) {
  // Returns Array<Array<string>> — each inner array is a consecutive run
  // A run only extends while: same prefix, consecutive number, same groupKey
  const runs = [];
  let i = 0;
  while (i < tokens.length) {
    const run = [tokens[i]];
    const { prefix, num } = splitRefdes(tokens[i]);
    const key = groupKeyOf(tokens[i]);
    let j = i + 1;
    while (j < tokens.length) {
      const { prefix: p2, num: n2 } = splitRefdes(tokens[j]);
      if (p2 === prefix && n2 === num + (j - i) && groupKeyOf(tokens[j]) === key) {
        run.push(tokens[j]);
        j++;
      } else break;
    }
    runs.push(run);
    i = j;
  }
  return runs;
}
```

**Render layer** (in `app.js`) — converts runs to display objects:

```js
const runs = collapseToRuns(visible, token => `${statusOf(token)}|${side}`);
const items = runs.map(run => ({
  display:     run.length > 1 ? `${run[0]}-${formatSuffix(run)}` : run[0],
  statusClass: fullClassOf(run[0]),
  title:       titleOf ? aggregateTitle(run, titleOf) : '',
}));
```

This moves CSS, tooltip, and formatting logic out of the parser file entirely.

---

## Problem 3: Error Handling Uses Awkward Out-Parameter Pattern

### What's wrong

`parseRefdesList` and `expandToken` accept an optional `errorsOut` array that is mutated as a side effect:

```js
function parseRefdesList(rawText, errorsOut) {  // mutated by reference
  // ...
  tokens.flatMap(t => expandToken(t, errorsOut));  // passed through
  // ...
}

function expandToken(token, errorsOut) {
  // ...
  if (errorsOut) errorsOut.push(token);  // side-effect push
  return [];
}
```

The calling convention is unclear: does the caller provide the array, or does the function create one? In practice, `app.js:461` creates an empty array and passes it in — but the function signature alone doesn't convey this.

### Suggested fix

Return a structured result object:

```js
function parseRefdesList(rawText) {
  const errors = [];
  if (!rawText || rawText.trim() === '') return { tokens: [], errors };

  const cleaned  = stripComments(rawText);
  const chunks   = cleaned.split(/[\s,;]+/).filter(Boolean);
  const expanded = [];
  for (const chunk of chunks) {
    const result = expandToken(chunk);
    expanded.push(...result.tokens);
    errors.push(...result.errors);
  }
  const unique = [...new Set(expanded)];
  return { tokens: unique.sort(naturalSort), errors };
}

function expandToken(token) {
  // ... parses token ...
  return { tokens: [...], errors: [...] };
}
```

The caller always gets both results. No optional parameters, no side effects.

---

## Problem 4: No Tests

### What's wrong

There are zero automated tests for any parsing logic. The `documentation/` directory was created during this session; no `test/` or `spec/` directory exists.

### Suggested fix

Add unit tests covering at minimum:

- Basic refdes parsing: `"R1"`, `"C5"`, `"TP10"`
- Range expansion: `"R1-R5"`, `"TP10-TP12"`, reversed `"R8-R1"`
- Complex prefixes: `"U11_M1-U11_M8"`
- Cross-prefix tokens: `"R1-C5"` → two separate tokens
- Pure letters: `"GND"`
- Pure digits: `"20"`
- Comments: `"R1 // note"`
- Mixed input: `"R1, C3-C5, GND, 20"`
- Deduplication: `"R1, R1, R1"` → `["R1"]`
- Natural sort order: `"R10, R2, R1"` → `["R1", "R2", "R10"]`
- Range collapse: `["R1","R2","R3","R5"]` → `["R1-R3","R5"]`
- Range collapse with group boundaries
- Invalid tokens with and without error collection

---

## Summary of Recommendations

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Unify prefix-number split into single `splitRefdes` function; rewrite range expansion to use it | Small | Removes backtracking dependency, makes logic trivially auditable |
| 2 | Separate `collapseToRanges` into parser (pure data) and renderer (UI objects) layers | Small | Clean separation of concerns, no HTML/CSS in parser file |
| 3 | Switch from out-parameter error handling to `{ tokens, errors }` return objects | Trivial | More conventional, no side effects, easier to test |
| 4 | Add unit tests | Medium | Enables safe refactoring, catches regressions |

Items 1–2 are the ones that address the actual "hacky" or "patched together" feel. Items 3–4 are good engineering hygiene that makes future work safer.
