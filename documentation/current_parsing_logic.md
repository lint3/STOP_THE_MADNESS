# Current Parsing Logic

## Project Overview

**Partser** ("STOP THE MADNESS") is a client-side browser tool for parsing, deduplicating, comparing, and converting electronic component lists. It handles five data types: **Refdes** (reference designators like `R1`, `C5`, `U11_M1`), **FN** (find numbers / line item numbers), **IPN**, **MPN**, and **CPN** (part numbers).

Parsing logic lives primarily in `parser.js`, with additional type-specific handling and BOM integration in `app.js`.

---

## 1. Refdes Parsing (`parser.js`)

### 1.1 Entry Point: `parseRefdesList(rawText, errorsOut?)`

The main public function. Pipeline:

```
raw text → strip comments → split on whitespace/commas/semicolons
→ expand each token (expandToken) → deduplicate (Set)
→ natural sort → return array
```

- **Line:** `parser.js:165`
- **Input:** raw string (e.g. `"R1-R3, c5, C1  // note"`)
- **Output:** sorted, deduplicated array of uppercase refdes strings (e.g. `["C1", "C5", "R1", "R2", "R3"]`)
- `errorsOut` (optional array): if provided, unrecognizable tokens are pushed into it as raw strings. If omitted, unrecognized tokens are silently dropped (used by BOM import which doesn't care about parse errors).

### 1.2 Comment Stripping: `stripComments(text)`

- **Line:** `parser.js:25`
- Removes `//` and `#` style comments through end of line.
- Uses two regex substitutions: `/\/\/.*$/gm` and `/#.*$/gm`.

### 1.3 Token Splitting

After stripping comments, `parseRefdesList` splits the text on `[\s,;]+` — i.e., whitespace, commas, and semicolons. Empty tokens are filtered out.

### 1.4 Single Refdes Validation: `REFDES_PATTERN`

- **Line:** `parser.js:19`
- **Regex:** `/^[A-Za-z_][A-Za-z0-9_]*\d+$|^[A-Za-z_]+$|^\d+$/`
- Accepts three forms:
  1. **Standard refdes:** starts with a letter or underscore, followed by any alphanumeric/underscore chars, ending in one or more digits. Examples: `R1`, `TP3`, `U11_M1`, `R14_05`.
  2. **Pure letters:** one or more letters/underscores only. Example: `GND`.
  3. **Pure digits:** one or more digits only. Example: `20`.

### 1.5 Token Expansion: `expandToken(token, errorsOut?)`

- **Line:** `parser.js:40`
- Takes a single whitespace/comma-separated token and returns an array of individual uppercase refdes strings.
- **Three cases:**
  1. **Token matches `RANGE_PATTERN` with matching prefixes:** expands the numeric range (see §2.2).
  2. **Token matches `RANGE_PATTERN` with different prefixes** (e.g. `R1-C5`): treats as two separate tokens — returns `["R1", "C5"]`.
  3. **Token matches `REFDES_PATTERN`:** returns `[token.toUpperCase()]`.
  4. **Token matches nothing:** if `errorsOut` provided, pushes token to it; returns `[]`.

### 1.6 Refdes Decomposition for Sorting: `splitRefdes(s)`

- **Line:** `parser.js:81`
- Splits a refdes string into `{ prefix, num }` for sort comparison.
- **Logic:**
  1. Try to match `^(.*?)(\d+)$` — splits at the *last* group of digits. The `(.*?)` is non-greedy, so it captures the shortest possible prefix that still allows `(\d+)` to match at the end. This design permits internal digits/underscores in the prefix.
     - `"TP10"` → `{ prefix: "TP", num: 10 }`
     - `"U11_M1"` → `{ prefix: "U11_M", num: 1 }`
     - `"R14_05"` → `{ prefix: "R14_0", num: 5 }`
  2. Pure digits (`/^\d+$/`) → `{ prefix: "", num: parseInt(s) }` — sorts before all letters (empty prefix < any non-empty).
  3. Pure letters → `{ prefix: s, num: 0 }` — sorts before any numbered variant of the same prefix (e.g. `GND` before `GND1`).

### 1.7 Natural Sort: `naturalSort(a, b)`

- **Line:** `parser.js:95`
- Comparator for `Array.sort()`.
- Sorts by prefix alphabetically first, then by number numerically. Ensures `R1, R2, R10` rather than lexicographic `R1, R10, R2`.

---

## 2. Range Parsing (`parser.js`)

### 2.1 Range Pattern: `RANGE_PATTERN`

- **Line:** `parser.js:14`
- **Regex:** `/^([A-Za-z_][A-Za-z0-9_]*?)(\d+)-([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/`
- **Groups:** `(prefix1)(num1)-(prefix2)(num2)`
- Each prefix starts with a letter/underscore, followed by any alphanumeric/underscore chars (non-greedy `*?`). Because `*?` is non-greedy and `\d+` follows immediately, the regex matches the *shortest* prefix that allows `\d+` to succeed. Through backtracking, the engine settles on splitting at the last digit group before the hyphen/end.

- **How the non-greedy prefix captures the correct prefix:**
  - For `R1-R5`: prefix1=`R`, num1=`1`, prefix2=`R`, num2=`5` ✓
  - For `TP10-TP12`: prefix1=`TP`, num1=`10`, prefix2=`TP`, num2=`12` ✓
  - For `U11_M1-U11_M8`: prefix1=`U11_M`, num1=`1`, prefix2=`U11_M`, num2=`8` ✓
  - The engine backtracks to extend prefix1/prefix2 only when the current split fails to match the rest of the pattern (e.g., `U` → num1=`11`, then `_M1` can't be consumed by the `-`, etc.).

### 2.2 Range Expansion (in `expandToken`)

When a token matches `RANGE_PATTERN` and `prefix1.toUpperCase() === prefix2.toUpperCase()`:
1. Parse `num1str` and `num2str` as base-10 integers.
2. Use `Math.min`/`Math.max` to determine the actual bounds — reversed ranges like `R8-R1` are automatically normalized.
3. Generate all integers from `start` to `end` inclusive, prepending the uppercased prefix to each.
4. Example: `"r1-R3"` → `["R1", "R2", "R3"]`

### 2.3 Range Collapse: `collapseToRanges(tokens, groupKeyOf, classOf?, titleOf?)`

- **Line:** `parser.js:122`
- Reverse of expansion: takes a sorted array of refdes strings (output of `parseRefdesList`) and collapses consecutive runs into range notation.

- **Parameters:**
  - `tokens`: sorted array of refdes strings.
  - `groupKeyOf`: function(token) → string key. Runs only form within the same group key. Ranges never cross key boundaries.
  - `classOf` (optional): function(token) → CSS class string for the output span. Defaults to `groupKeyOf` when omitted.
  - `titleOf` (optional): function(token) → string[] of source tokens for tooltip. Aggregates across the run for range spans.

- **Run extension rule:** a run can only extend while all three conditions hold:
  1. Same prefix (from `splitRefdes`).
  2. Consecutive number (next number = current number + run length).
  3. Same group key.

- **Output:** array of `{ display, statusClass, title }` objects.
  - `display`: `"R1-R5"` for runs of 2+; `"R3"` for singletons.
  - `statusClass`: `classOf(firstTokenInRun)`.
  - `title`: aggregated sorted tooltip string for the run, or `''`.

### 2.4 Range Collapse Usage in the App (`app.js:401-428`)

In `renderParsedOutput`, when the user enables `config.rangeOutput`:
- A combined grouping key is built from diff status (`statusOf`) and board side (`getSideForToken`), separated by `|`: `"status-unique|top"`.
- This ensures ranges are never collapsed across diff-status or board-side boundaries.
- The CSS class is kept separate (`fullClassOf`) so the `|` delimiter never leaks into HTML class attributes.
- When range output is off, each token is rendered individually.

---

## 3. Non-Refdes Parsing (`app.js:parseInputTokens`)

### 3.1 FN (Find Number) Parsing

- **Line:** `app.js:470`
- FNs are pure integers.
- **Handles its own range notation:** `/^(\d+)-(\d+)$/` — expand `"10-15"` → `["10", "11", "12", "13", "14", "15"]`. Reversed ranges handled via `Math.min/max`.
- Valid FN tokens must match `/^\d+$/`. Invalid tokens produce parse errors.
- Result is deduplicated and naturally sorted (using `naturalSort` from `parser.js`).

### 3.2 IPN / MPN / CPN Parsing

- **Line:** `app.js:491`
- Strips comments, splits on `[\s,;]+`, uppercases, deduplicates, lexicographically sorts.
- No range expansion — these are opaque part number strings.
- No parse errors possible (any non-empty token is accepted).

---

## 4. BOM Import Integration

### 4.1 BOM Refdes Column Parsing (`app.js:buildBomRows`)

- **Line:** `app.js:1092`
- When a BOM column is assigned the "refdes" role, each cell is pre-parsed through `parseRefdesList()` at import time.
- Example: a cell containing `"R1-R5, C3, C7-C9"` becomes `["C3", "C7", "C8", "C9", "R1", "R2", "R3", "R4", "R5"]`.
- Refdes cells in BOM are stored as arrays; all other types are stored as uppercase strings.

### 4.2 Cross-Type Resolution (`app.js:resolveTokens`)

- **Line:** `app.js:525`
- When a BOM is loaded and input/output types differ, each input token is looked up in BOM rows.
- For refdes input type, rows are matched via `row.refdes.includes(token)` (since refdes is an array).
- For other input types, rows are matched via `row[inputType] === token` (exact string match).
- When output type is refdes, `row.refdes` array is spread into the resolved output.
- Results are deduplicated and sorted (natural sort for refdes/fn, lexicographic for part numbers).

---

## 5. Side Data (`odb.js`)

### 5.1 ODB++ Component File Parsing

- **Line:** `odb.js:62`
- Parses ODB++ component text files (`layers/comp_+_top/components` and `layers/comp_+_bot/components`).
- Only `CMP` lines are processed. The refdes is at field index 6 (0-based) in the space-separated CMP line.
- Output: deduplicated array of uppercase refdes, natural-sorted.
- The `parseOdbTgz` function combines both top and bottom layers into a `Map<refdes, 'top'|'bottom'>`.

---

## 6. Key Design Decisions

1. **Last-digit-group-as-number rule:** Both `RANGE_PATTERN` and `splitRefdes` treat the *last* contiguous group of digits in a token as the numeric suffix, and everything before it as the prefix. This allows prefixes like `U11_M` (from `U11_M1`).

2. **Case insensitivity:** All parsing normalizes to uppercase. This applies everywhere — refdes patterns, range expansion, and the ODB parser.

3. **Reversed range tolerance:** `R8-R1` produces the same result as `R1-R8`. Implemented by using `Math.min`/`Math.max` on the parsed numbers.

4. **Silent error handling:** `parseRefdesList` silently drops unrecognized tokens unless the caller provides an `errorsOut` array. The BOM import uses the silent mode; the panel UI uses the error-reporting mode.

5. **Group-key-gated range collapse:** `collapseToRanges` prevents ranges from crossing boundaries of diff status, board side, or partial-fulfillment status. This ensures visual grouping integrity in the UI.

6. **Empty prefix for pure numbers:** Pure-digit refdes tokens get `prefix: ""`, placing them before all letter-prefixed tokens in sorted output. Pure-letter tokens get `num: 0`, placing them before numbered variants of the same prefix.
