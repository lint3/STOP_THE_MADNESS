// Partser — app.js

// --------------------------------------------------------------------------
// Panel state
// Panels are objects with id, label, tokens[], and raw text.
// Adding/removing panels means mutating this array, then calling
// renderPanels() + runComparison().
// --------------------------------------------------------------------------
const PANEL_IDS = ['a', 'b', 'c', 'd']; // max 4 panels, fixed slot order

const panels = [
  { id: 'a', label: 'List A', tokens: [], raw: '', inputType: 'refdes', outputType: 'refdes', unresolvedTokens: [], parseErrors: [], sourceRefdesOf: new Map() },
  { id: 'b', label: 'List B', tokens: [], raw: '', inputType: 'refdes', outputType: 'refdes', unresolvedTokens: [], parseErrors: [], sourceRefdesOf: new Map() },
];

// --------------------------------------------------------------------------
// Config state
// --------------------------------------------------------------------------
const config = {
  highlight:     true,
  diffOnly:      false,
  rangeOutput:   false,
  partialItalic: true,
  showSides:     false,
  delimiter:     ', ',
  sideFilter:    'all',
};

// --------------------------------------------------------------------------
// Escape sequence helpers for the delimiter text input.
// interpretEscapes: user-typed "\n" → actual newline (used on input event)
// escapeForDisplay: actual newline → "\n" for display (used when restoring state)
// --------------------------------------------------------------------------
function interpretEscapes(str) {
  return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function escapeForDisplay(str) {
  return str.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

// --------------------------------------------------------------------------
// Config bar wiring
// initConfigBar: wires event listeners (called once at startup).
// syncConfigBarUI: sets UI elements to match config (called after any config reset).
// --------------------------------------------------------------------------
function initConfigBar() {
  [
    ['chk-highlight',    'highlight'],
    ['chk-diff-only',    'diffOnly'],
    ['chk-range-output', 'rangeOutput'],
    ['chk-partial',      'partialItalic'],
    ['chk-side',         'showSides'],
  ].forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', e => {
      config[key] = e.target.checked;
      runComparison();
    });
  });

  document.querySelectorAll('input[name="side-filter"]').forEach(radio => {
    radio.addEventListener('change', e => {
      config.sideFilter = e.target.value;
      runComparison();
    });
  });

  const delimiterInput = document.getElementById('txt-delimiter');
  delimiterInput.addEventListener('focus', () => delimiterInput.select());
  delimiterInput.addEventListener('input', e => {
    config.delimiter = interpretEscapes(e.target.value);
    syncDelimiterPreview();
    runComparison();
  });
}

function syncConfigBarUI() {
  [
    ['chk-highlight',    'highlight'],
    ['chk-diff-only',    'diffOnly'],
    ['chk-range-output', 'rangeOutput'],
    ['chk-partial',      'partialItalic'],
    ['chk-side',         'showSides'],
  ].forEach(([id, key]) => {
    document.getElementById(id).checked = config[key];
  });
  document.getElementById('txt-delimiter').value = escapeForDisplay(config.delimiter);
  syncDelimiterPreview();
  document.querySelectorAll('input[name="side-filter"]').forEach(radio => {
    radio.checked = radio.value === config.sideFilter;
  });
}

// Renders the delimiter preview overlay: replaces space characters with ␣ (U+2423).
function syncDelimiterPreview() {
  const raw = document.getElementById('txt-delimiter').value;
  document.getElementById('delimiter-preview').textContent = raw.replaceAll(' ', '␣');
}

// --------------------------------------------------------------------------
// Panel rendering
// Rebuilds panel DOM from the panels array. Stores element refs on each
// panel object so runComparison() can update them without re-querying the DOM.
// Restores textarea content from panel.raw (needed after add/delete rebuilds).
// --------------------------------------------------------------------------
function renderPanels() {
  const container = document.getElementById('panel-container');
  container.innerHTML = '';

  for (const panel of panels) {
    const col = document.createElement('div');
    col.className = 'panel';
    col.dataset.panelId = panel.id;

    col.innerHTML = `
      <div class="panel-header">
        <input type="text" class="panel-label" value="${panel.label}">
        <button class="btn-fade btn-panel-icon btn-danger btn-delete-panel" tabindex="-1">×</button>
      </div>

      <div class="sub-area">
        <textarea class="raw-input" placeholder="Paste list here..."></textarea>
      </div>

      <div class="panel-type-row">
        <select class="panel-input-type" tabindex="-1" title="Input data type">
          <option value="refdes">Refdes</option>
          <option value="fn">FN</option>
          <option value="ipn">IPN</option>
          <option value="mpn">MPN</option>
          <option value="cpn">CPN</option>
        </select>
        <span class="type-arrow">→</span>
        <select class="panel-output-type" tabindex="-1" title="Output data type (requires BOM)">
          <option value="refdes">Refdes</option>
          <option value="fn">FN</option>
          <option value="ipn">IPN</option>
          <option value="mpn">MPN</option>
          <option value="cpn">CPN</option>
        </select>
        <button class="btn-fade btn-panel-icon btn-danger btn-clear-input" tabindex="-1" title="Clear input">⌫</button>
        <button class="btn-fade btn-panel-icon btn-swap" tabindex="-1" title="Swap input ↔ output">⇄</button>
      </div>

      <span class="footer-errors"></span>
      <div class="error-detail" hidden></div>

      <div class="sub-area">
        <div class="parsed-output-wrapper">
          <div class="parsed-output output-area">---</div>
          <button class="btn-fade btn-copy btn-copy-parsed" tabindex="-1">Copy</button>
        </div>
      </div>

      <div class="panel-footer">
        <span class="footer-label">0 items</span>
      </div>
    `;

    // Store element refs for use in runComparison() and renderErrorExpando()
    panel.parsedEl       = col.querySelector('.parsed-output');
    panel.footerEl       = col.querySelector('.footer-label');
    panel.errorTriggerEl = col.querySelector('.footer-errors');
    panel.errorDetailEl  = col.querySelector('.error-detail');

    const labelInput = col.querySelector('.panel-label');
    labelInput.addEventListener('input', () => { panel.label = labelInput.value; saveState(); });
    labelInput.addEventListener('focus', () => labelInput.select());

    const textarea = col.querySelector('.raw-input');
    textarea.value = panel.raw;
    textarea.addEventListener('input', () => {
      panel.raw = textarea.value;
      runComparison();
    });

    // Clear input button: empties the textarea and re-runs
    const clearInputBtn = col.querySelector('.btn-clear-input');
    clearInputBtn.addEventListener('click', () => {
      panel.raw = '';
      textarea.value = '';
      runComparison();
    });

    // Input type dropdown: restore saved value, re-run on change
    const inputTypeSelect = col.querySelector('.panel-input-type');
    inputTypeSelect.value = panel.inputType;
    inputTypeSelect.addEventListener('change', e => {
      panel.inputType = e.target.value;
      runComparison();
    });

    // Output type dropdown: enabled only when BOM is loaded (requires resolution)
    const outputTypeSelect = col.querySelector('.panel-output-type');
    outputTypeSelect.value    = panel.outputType;
    outputTypeSelect.disabled = !bom.loaded;
    outputTypeSelect.addEventListener('change', e => {
      panel.outputType = e.target.value;
      runComparison();
    });

    // Swap button: swaps raw↔parsed content and flips input/output types.
    // New raw = current output tokens joined with delimiter, so the converted
    // list becomes the new input ready for further conversion or comparison.
    const swapBtn = col.querySelector('.btn-swap');
    swapBtn.addEventListener('click', () => {
      panel.raw = panel.tokens.join(config.delimiter);
      [panel.inputType, panel.outputType] = [panel.outputType, panel.inputType];
      renderPanels();
      runComparison();
    });

    // Error expando: toggle the detail div visibility on click
    panel.errorTriggerEl.addEventListener('click', () => {
      if (panel.errorDetailEl.hasAttribute('hidden')) {
        panel.errorDetailEl.removeAttribute('hidden');
      } else {
        panel.errorDetailEl.setAttribute('hidden', '');
      }
      renderErrorExpando(panel); // refresh ▶/▼ indicator
    });

    // Copy button: copies the parsed output text to the clipboard
    const copyBtn = col.querySelector('.btn-copy-parsed');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(panel.parsedEl.innerText).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      });
    });

    // Delete button: disabled when only 1 panel remains
    const deleteBtn = col.querySelector('.btn-delete-panel');
    deleteBtn.disabled = panels.length <= 1;
    deleteBtn.addEventListener('click', () => deletePanel(panel.id));

    container.appendChild(col);
  }

  // Add button: disabled at the 4-panel cap
  document.getElementById('btn-add-panel').disabled = panels.length >= 4;
}

// --------------------------------------------------------------------------
// addPanel() / deletePanel(id)
// --------------------------------------------------------------------------
function addPanel() {
  if (panels.length >= 4) return;
  // Find the first slot ID not currently in use
  const usedIds = new Set(panels.map(p => p.id));
  const id      = PANEL_IDS.find(s => !usedIds.has(s));
  panels.push({ id, label: 'List ' + id.toUpperCase(), tokens: [], raw: '', inputType: 'refdes', outputType: 'refdes', unresolvedTokens: [], parseErrors: [], sourceRefdesOf: new Map() });
  renderPanels();
  runComparison();
}

function deletePanel(id) {
  if (panels.length <= 1) return;
  panels.splice(panels.findIndex(p => p.id === id), 1);
  renderPanels();
  runComparison();
}

// --------------------------------------------------------------------------
// runComparison()
// Computes diff status across all panels and re-renders each one.
// Called whenever any panel's input or any config setting changes.
// --------------------------------------------------------------------------
function runComparison() {
  // Compute each panel's output tokens from its raw input.
  // If a BOM is loaded and input/output types differ, resolve through the BOM.
  for (const panel of panels) {
    const { tokens: inputTokens, parseErrors } = parseInputTokens(panel.raw, panel.inputType);
    panel.parseErrors = parseErrors;

    if (!bom.loaded || panel.inputType === panel.outputType) {
      // No BOM available, or input and output types are the same: pass through.
      // No partial fulfillment concept applies here.
      panel.tokens           = inputTokens;
      panel.unresolvedTokens = [];
      panel.partialTokens    = new Set();
      panel.sourceRefdesOf   = new Map();
    } else {
      const result           = resolveTokens(inputTokens, panel.inputType, panel.outputType, bom);
      panel.tokens           = result.resolved;
      panel.unresolvedTokens = result.unresolved;
      panel.partialTokens    = result.partial;
      panel.sourceRefdesOf   = result.sourceRefdesOf;
    }

    // Apply side filter before frequency counting (filter-then-diff).
    // Mixed and unknown tokens are never dropped — only the opposite side is.
    if (sideData.loaded && config.sideFilter !== 'all') {
      panel.tokens = panel.tokens.filter(token => {
        const side = getSideForToken(token, panel.outputType, panel.sourceRefdesOf, sideData.map);
        if (config.sideFilter === 'top')    return side !== 'bottom';
        if (config.sideFilter === 'bottom') return side !== 'top';
        return true;
      });
    }
  }

  // Count how many panels contain each output token
  const freq = new Map();
  for (const panel of panels) {
    for (const token of panel.tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }

  for (const panel of panels) {
    renderParsedOutput(panel, freq);
    const n = panel.tokens.length;
    panel.footerEl.textContent = n === 1 ? '1 item' : `${n} items`;
    renderErrorExpando(panel);
  }

  updateDiffCount(freq);
  updateRangeToggleState();
  updateComparisonValidity();
  updatePartialToggleState();
  saveState();
}

// --------------------------------------------------------------------------
// renderParsedOutput(panel, freq)
// Renders the parsed output div for one panel with colored refdes spans.
// --------------------------------------------------------------------------
function renderParsedOutput(panel, freq) {
  // Update output wrapper border to reflect the active side filter. Done first
  // so it applies even when the panel is empty and we return early below.
  const wrapper = panel.parsedEl.parentElement;
  wrapper.classList.toggle('side-filter-top',    sideData.loaded && config.sideFilter === 'top');
  wrapper.classList.toggle('side-filter-bottom', sideData.loaded && config.sideFilter === 'bottom');

  const totalPanels = panels.length;

  if (panel.tokens.length === 0) {
    panel.parsedEl.innerHTML = '---';
    return;
  }

  // Diff features (colors, diffOnly) are only meaningful when panels share an
  // input type (or a BOM resolves them to a common output type). If not valid,
  // treat both as off so the raw token lists are shown without any comparison.
  const valid           = comparisonValid();
  const effectiveDiffOnly  = config.diffOnly  && valid;
  const effectiveHighlight = config.highlight && valid;

  // When "show differences only" is on, hide items present in every panel
  const visible = effectiveDiffOnly
    ? panel.tokens.filter(t => freq.get(t) < totalPanels)
    : panel.tokens;

  if (visible.length === 0) {
    panel.parsedEl.innerHTML = '---';
    return;
  }

  // statusOf returns a CSS class string for a token — used both for rendering
  // and as the grouping key in collapseToRanges (equal keys can form a range).
  // Diff status and partial-fulfillment status are both encoded here so that
  // ranges are never collapsed across a diff-status or partial boundary.
  const statusOf = (token) => {
    let cls = '';
    if (effectiveHighlight) {
      const count = freq.get(token);
      if (count === totalPanels) cls = 'status-all';
      else if (count === 1)      cls = 'status-unique';
      else                       cls = 'status-partial';
    }
    if (config.partialItalic && panel.partialTokens && panel.partialTokens.has(token)) {
      cls = cls ? cls + ' partial-token' : 'partial-token';
    }
    return cls;
  };

  // Side stripe class for a token. Returns '' when side toggle is off or no data.
  const sideClassOf = token => {
    if (!sideData.loaded || !config.showSides) return '';
    const side = getSideForToken(token, panel.outputType, panel.sourceRefdesOf, sideData.map);
    return side === 'unknown' ? '' : `side-${side}`;
  };

  // Combined CSS class: diff status + optional side stripe.
  const fullClassOf = token => [statusOf(token), sideClassOf(token)].filter(Boolean).join(' ');

  // Build display items: either collapsed ranges or individual tokens.
  // When side data is loaded, ranges are not allowed to cross side boundaries
  // (requirement 8). The grouping key combines diff-status and side; the CSS
  // class (fullClassOf) is kept separate so the key delimiter never leaks into HTML.
  const items = config.rangeOutput
    ? collapseToRanges(
        visible,
        token => {
          const side = sideData.loaded
            ? getSideForToken(token, panel.outputType, panel.sourceRefdesOf, sideData.map)
            : '';
          return `${statusOf(token)}|${side}`;
        },
        fullClassOf,
      )
    : visible.map(t => ({ display: t, statusClass: fullClassOf(t) }));

  panel.parsedEl.innerHTML = items
    .map(({ display, statusClass }) => `<span class="token ${statusClass}">${display}</span>`)
    .join(config.delimiter);
}

// --------------------------------------------------------------------------
// updateDiffCount(freq)
// Updates the "N differences" label in the diff block header.
// --------------------------------------------------------------------------
function updateDiffCount(freq) {
  const totalPanels = panels.length;
  let diffCount = 0;
  for (const count of freq.values()) {
    if (count < totalPanels) diffCount++;
  }
  const el = document.getElementById('diff-count');
  el.textContent = diffCount === 1 ? '1 difference' : `${diffCount} differences`;
  el.classList.toggle('diff-count-zero', diffCount === 0);
  el.classList.toggle('diff-count-nonzero', diffCount > 0);
}

// --------------------------------------------------------------------------
// parseInputTokens(rawText, inputType)
// Parses raw input text into tokens according to the panel's input type.
//   refdes:      uses parseRefdesList() — range expansion, natural sort
//   fn:          splits, keeps pure-integer tokens, natural sort
//   ipn/mpn/cpn: splits, uppercases, deduplicates, lexicographic sort
//
// Returns { tokens, parseErrors } where parseErrors is an array of
// human-readable strings describing tokens that could not be interpreted.
// --------------------------------------------------------------------------
function parseInputTokens(rawText, inputType) {
  if (!rawText || rawText.trim() === '') return { tokens: [], parseErrors: [] };

  if (inputType === 'refdes') {
    const rawErrors = [];
    const tokens    = parseRefdesList(rawText, rawErrors);
    const parseErrors = rawErrors.map(t => `Could not parse ${t} as Refdes`);
    return { tokens, parseErrors };
  }

  // All non-refdes types: strip comments then split
  const parts = stripComments(rawText).split(/[\s,;]+/).filter(Boolean).map(t => t.toUpperCase());

  if (inputType === 'fn') {
    // FNs are pure integers. Expand range notation (e.g. "10-15" → 10,11,...,15).
    // Reversed ranges (e.g. "15-10") are handled via Math.min/max.
    const expanded    = [];
    const parseErrors = [];
    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = Math.min(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10));
        const end   = Math.max(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10));
        for (let i = start; i <= end; i++) expanded.push(String(i));
      } else if (/^\d+$/.test(part)) {
        expanded.push(part);
      } else {
        parseErrors.push(`Could not parse ${part} as FN`);
      }
    }
    return { tokens: [...new Set(expanded)].sort(naturalSort), parseErrors };
  }

  // IPN, MPN, CPN: accept any non-empty token — no parse errors possible
  return { tokens: [...new Set(parts)].sort(), parseErrors: [] };
}

// --------------------------------------------------------------------------
// resolveTokens(inputTokens, inputType, outputType, bom)
// Looks up each input token in the BOM and collects matching output values.
// Returns { resolved, unresolved, partial, sourceRefdesOf }
//   resolved:       sorted, deduplicated output tokens found in the BOM
//   unresolved:     input tokens that matched no BOM row
//   partial:        Set of output tokens with incomplete input coverage
//   sourceRefdesOf: Map<outputToken, string[]> — the refdes from all BOM rows
//                   that can produce each output token. Used by getSideForToken
//                   to derive side for non-refdes output types without re-scanning
//                   the BOM. For refdes output, each token maps to itself.
// --------------------------------------------------------------------------
function resolveTokens(inputTokens, inputType, outputType, bom) {
  const resolved   = [];
  const unresolved = [];

  for (const token of inputTokens) {
    // Find all BOM rows where the input-type column contains this token.
    // Refdes is stored as an array (one row → many refdes), so use .includes().
    const matchingRows = bom.rows.filter(row => {
      if (inputType === 'refdes') {
        return Array.isArray(row.refdes) && row.refdes.includes(token);
      }
      return row[inputType] === token;
    });

    if (matchingRows.length === 0) {
      unresolved.push(token);
      continue;
    }

    // Collect all output values from matching rows
    for (const row of matchingRows) {
      if (outputType === 'refdes') {
        if (Array.isArray(row.refdes)) resolved.push(...row.refdes);
      } else if (row[outputType]) {
        resolved.push(row[outputType]);
      }
    }
  }

  // Deduplicate and sort: natural sort for refdes/fn, lexicographic for part numbers
  const unique = [...new Set(resolved)];
  const sorted = (outputType === 'refdes' || outputType === 'fn')
    ? unique.sort(naturalSort)
    : unique.sort();

  // Determine partial fulfillment for each output token, and simultaneously
  // build sourceRefdesOf (Map<outputToken, string[]>).
  // An output token T is "partial" if any BOM row that can produce T has an
  // input-type value that was NOT in the user's input.
  // Example: refdes→FN, FN 12 has [R1, R2, R7]. User input [R2] → FN 12 is partial.
  const inputSet     = new Set(inputTokens);
  const partial      = new Set();
  const sourceRefdesOf = new Map();

  for (const outputToken of unique) {
    // Find all BOM rows that can produce this output token
    const contributingRows = bom.rows.filter(row => {
      if (outputType === 'refdes') return Array.isArray(row.refdes) && row.refdes.includes(outputToken);
      return row[outputType] === outputToken;
    });

    // For each such row, check whether all of its input-type values were provided
    for (const row of contributingRows) {
      const inputVals = inputType === 'refdes'
        ? (Array.isArray(row.refdes) ? row.refdes : [])
        : (row[inputType] ? [row[inputType]] : []);

      if (inputVals.some(v => !inputSet.has(v))) {
        partial.add(outputToken);
        break; // one missing contributor is enough
      }
    }

    // Collect source refdes for side derivation (getSideForToken).
    // For refdes output the token is its own source; for other output types
    // gather all refdes from the contributing rows.
    if (outputType === 'refdes') {
      sourceRefdesOf.set(outputToken, [outputToken]);
    } else {
      const srcRefdes = [];
      for (const row of contributingRows) {
        if (Array.isArray(row.refdes)) srcRefdes.push(...row.refdes);
      }
      sourceRefdesOf.set(outputToken, [...new Set(srcRefdes)]);
    }
  }

  return { resolved: sorted, unresolved, partial, sourceRefdesOf };
}

// --------------------------------------------------------------------------
// getSideForToken(token, outputType, sourceRefdesOf, sideMap)
// Returns the board side for an output token: 'top', 'bottom', 'mixed', or
// 'unknown'. For refdes output, looks up the token directly in sideMap.
// For other output types, unions the sides of all source refdes (from
// sourceRefdesOf, pre-computed by resolveTokens) — no additional BOM scan.
// --------------------------------------------------------------------------
function getSideForToken(token, outputType, sourceRefdesOf, sideMap) {
  if (outputType === 'refdes') {
    return sideMap.get(token) ?? 'unknown';
  }
  const srcRefdes = sourceRefdesOf.get(token) ?? [];
  const sides = [...new Set(srcRefdes.map(r => sideMap.get(r)).filter(Boolean))];
  if (sides.length === 0) return 'unknown';
  if (sides.length === 1) return sides[0];
  return 'mixed';
}

// --------------------------------------------------------------------------
// handleSideFile(file)
// Reads an ODB++ .tgz file and populates sideData. Entry point wired to
// the side import file input's change event.
// --------------------------------------------------------------------------
function handleSideFile(file) {
  const reader = new FileReader();
  reader.onload = function (ev) {
    let map;
    try {
      map = parseOdbTgz(ev.target.result);
    } catch (err) {
      alert(`Side data import failed:\n\n${err}`);
      return;
    }
    sideData.map    = map;
    sideData.loaded = true;
    updateBomStatus();
    runComparison();
  };
  reader.readAsArrayBuffer(file);
}

// --------------------------------------------------------------------------
// updateSideControls()
// Enables/disables side-related controls based on current state.
// Called from updateBomStatus() so it stays in sync whenever BOM or side
// data changes.
// --------------------------------------------------------------------------
function updateSideControls() {
  const noSideData = !sideData.loaded;
  ['radio-side-top', 'radio-side-all', 'radio-side-bot'].forEach(id => {
    document.getElementById(id).disabled = noSideData;
  });
  const sideChk = document.getElementById('chk-side');
  sideChk.disabled = noSideData;
  if (noSideData) sideChk.checked = false;
}

// --------------------------------------------------------------------------
// renderErrorExpando(panel)
// Updates the error expando in the panel footer.
// Combines parse errors (bad input format) and BOM resolution failures into
// one list. Each entry is a human-readable line item.
// The click handler (wired in renderPanels) toggles the detail visibility;
// this function only refreshes the text content of both elements.
// --------------------------------------------------------------------------
function renderErrorExpando(panel) {
  const parseErrors = panel.parseErrors    || [];
  const unresolved  = panel.unresolvedTokens || [];

  // Build one flat list of message strings
  const allErrors = [
    ...parseErrors,
    ...unresolved.map(t => `${t} not found in BOM`),
  ];

  if (allErrors.length === 0) {
    panel.errorTriggerEl.textContent = '';
    panel.errorDetailEl.setAttribute('hidden', '');
    return;
  }

  const open = !panel.errorDetailEl.hasAttribute('hidden');
  panel.errorTriggerEl.textContent = `${allErrors.length} error${allErrors.length !== 1 ? 's' : ''} ${open ? '▼' : '▶'}`;
  panel.errorDetailEl.innerHTML    = allErrors.map(e => `<div>${e}</div>`).join('');
}

// --------------------------------------------------------------------------
// updateTypeSelectors()
// Enables or disables all data-type dropdowns depending on whether a BOM
// is loaded. Called whenever bom.loaded changes.
// --------------------------------------------------------------------------
function updateTypeSelectors() {
  // Output type selectors require a BOM; input type selectors are always usable.
  document.querySelectorAll('.panel-output-type').forEach(sel => {
    sel.disabled = !bom.loaded;
  });
}

// --------------------------------------------------------------------------
// updateRangeToggleState()
// Range output is only meaningful for Refdes and FN output types.
// Disables the Range checkbox (and clears rangeOutput) for other types.
// --------------------------------------------------------------------------
function updateRangeToggleState() {
  // Range collapse is only meaningful for refdes or fn token types.
  // The effective token type per panel: outputType when BOM resolves, otherwise inputType.
  const anyRangeable = panels.some(p => {
    const tokenType = (bom.loaded && p.inputType !== p.outputType) ? p.outputType : p.inputType;
    return tokenType === 'refdes' || tokenType === 'fn';
  });
  const el = document.getElementById('chk-range-output');
  el.disabled = !anyRangeable;
  if (!anyRangeable && config.rangeOutput) {
    config.rangeOutput = false;
    el.checked         = false;
  }
}

// --------------------------------------------------------------------------
// comparisonValid()
// Returns true if panel outputs can be meaningfully compared — i.e., all
// panels are producing the same data type. This is true when:
//   - A BOM is loaded (tokens are resolved to a common output type), OR
//   - All panels share the same input type (so their tokens are comparable)
// --------------------------------------------------------------------------
function comparisonValid() {
  if (panels.length < 2) return false; // nothing to compare against
  if (bom.loaded) {
    // With BOM, each panel resolves to its own outputType.
    // Comparison only makes sense when all panels produce the same token type.
    const outTypes = new Set(panels.map(p => p.outputType));
    return outTypes.size === 1;
  }
  // Without BOM, tokens pass through (effective type = inputType).
  const inTypes = new Set(panels.map(p => p.inputType));
  return inTypes.size === 1;
}

// --------------------------------------------------------------------------
// updateComparisonValidity()
// Syncs the Colors and DiffOnly checkboxes and the diff count label to
// reflect whether a valid cross-panel comparison is possible.
// When invalid: the checkboxes are unchecked+disabled and diff count is hidden.
// When valid:   checkboxes reflect config and diff count is shown.
// config.highlight / config.diffOnly are NOT mutated, so user preferences
// are restored automatically when comparison becomes valid again.
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// updatePartialToggleState()
// The Partial toggle is only meaningful when a BOM is loaded (partial
// fulfillment requires BOM resolution). Disables and visually unchecks it
// otherwise, without touching config.partialItalic.
// --------------------------------------------------------------------------
function updatePartialToggleState() {
  const el = document.getElementById('chk-partial');
  el.disabled = !bom.loaded;
  el.checked  = bom.loaded ? config.partialItalic : false;
}

function updateComparisonValidity() {
  const valid       = comparisonValid();
  const highlightEl = document.getElementById('chk-highlight');
  const diffOnlyEl  = document.getElementById('chk-diff-only');
  const diffCountEl = document.getElementById('diff-count');

  highlightEl.disabled = !valid;
  diffOnlyEl.disabled  = !valid;

  highlightEl.checked = valid ? config.highlight : false;
  diffOnlyEl.checked  = valid ? config.diffOnly  : false;

  diffCountEl.hidden = !valid;
}

// --------------------------------------------------------------------------
// BOM state
// bom.rows: array of row objects with keys matching assigned role names.
//   e.g. { fn: '35', ipn: 'ABC-123', mpn: 'XYZ-456', refdes: ['R1','C3'] }
// Refdes cells are pre-parsed into arrays at import time.
// All non-refdes values are stored as uppercase strings.
// --------------------------------------------------------------------------
const bom = {
  loaded: false,
  rows:   [],
};

// --------------------------------------------------------------------------
// Side data state
// Populated by importing an ODB++ .tgz file. Not persisted to sessionStorage.
// sideData.map: refdes (uppercase) → 'top' | 'bottom'
// --------------------------------------------------------------------------
const sideData = {
  loaded: false,
  map:    new Map(),
};

// --------------------------------------------------------------------------
// Role auto-detection: maps common BOM header text to a role name.
// Tested against the trimmed header string, case-insensitive.
// --------------------------------------------------------------------------
const ROLE_DETECT = [
  { role: 'fn',     pattern: /^(fn|find|find\s*num\.?|find\s*number|find\s*no\.?|item\s*no?\.?|line\s*item)$/i },
  { role: 'ipn',    pattern: /^(ipn|internal\s*part(\s*number)?|part\s*#?)$/i },
  { role: 'mpn',    pattern: /^(mpn|mfr\.?\s*part(\s*number)?|manufacturer\s*part(\s*number)?|mfg\.?\s*part)$/i },
  { role: 'cpn',    pattern: /^(cpn|customer\s*part(\s*number)?|design\s*part(\s*number)?)$/i },
  { role: 'refdes', pattern: /^(refdes|ref\.?\s*des\.?|reference|designator|ref\.?|reference\s*designator\(s\))$/i },
  { role: 'qty',    pattern: /^(qty|quantity|count|bom\s*qty)$/i },
  { role: 'side',   pattern: /^(side|mount|placement|layer)$/i },
];

function detectRole(headerText) {
  const h = String(headerText).trim();
  for (const { role, pattern } of ROLE_DETECT) {
    if (pattern.test(h)) return role;
  }
  return 'ignore';
}

// Options shown in each column-role dropdown, in display order.
const ROLE_OPTIONS = [
  { value: 'ignore', label: '-' },
  { value: 'fn',     label: 'FN' },
  { value: 'ipn',    label: 'IPN' },
  { value: 'mpn',    label: 'MPN' },
  { value: 'cpn',    label: 'CPN' },
  { value: 'refdes', label: 'Refdes' },
  { value: 'qty',    label: 'Qty' },
];

// --------------------------------------------------------------------------
// BOM import
// Drag-and-drop anywhere on the page is the only import mechanism.
// File type is detected by extension: .xlsx → BOM, .tgz/.tar.gz → side data.
// SheetJS reads the xlsx; the column-mapping modal is shown for BOM files.
// --------------------------------------------------------------------------

// Stored while the modal is open; cleared on cancel or confirm.
let _pendingWorkbook = null; // the full SheetJS workbook object
let _pendingAllRows  = null; // raw rows from the currently selected sheet

// --------------------------------------------------------------------------
// handleBomFile(file)
// Reads a File object with SheetJS and opens the column-mapping modal.
// --------------------------------------------------------------------------
function handleBomFile(file) {
  const reader = new FileReader();
  reader.onload = function (ev) {
    const data     = new Uint8Array(ev.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    showMappingModal(workbook);
  };
  reader.readAsArrayBuffer(file);
}

// --------------------------------------------------------------------------
// loadSheetRows(sheetName)
// Extracts rows from the named sheet into _pendingAllRows and refreshes the
// mapping table. Called when the modal first opens and on sheet-select change.
// --------------------------------------------------------------------------
function loadSheetRows(sheetName) {
  const sheet   = _pendingWorkbook.Sheets[sheetName];
  // header:1 → every row returned as a plain array; defval:'' fills empty cells
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawRows.length === 0) {
    alert('The selected sheet appears to be empty.');
    return;
  }

  _pendingAllRows = rawRows;

  const headerRowInput = document.getElementById('bom-header-row');
  headerRowInput.max   = rawRows.length;
  headerRowInput.value = '1';

  repopulateMappingTable(0); // row 1 → index 0
}

// --------------------------------------------------------------------------
// BOM load warning
// Shows once (via localStorage) before the first Browse or drop action.
// After dismissal, the user must re-trigger their action (click Browse again
// or drop the file again). bomAlreadyWarned() is checked inline at each
// trigger site; initBomWarning() wires the OK button.
// --------------------------------------------------------------------------
const BOM_WARNED_KEY = 'partser_bom_warned';

function bomAlreadyWarned() {
  return localStorage.getItem(BOM_WARNED_KEY) === '1';
}

function showBomWarning() {
  document.getElementById('bom-warn-modal').removeAttribute('hidden');
}

function initBomWarning() {
  // The ⚠️ emoji is the real dismiss button; "I understand" does nothing.
  document.getElementById('bom-warn-emoji').addEventListener('click', () => {
    localStorage.setItem(BOM_WARNED_KEY, '1');
    document.getElementById('bom-warn-modal').setAttribute('hidden', '');
  });
}

function initBomImport() {
  // ---- Drag-and-drop anywhere on the page ----
  // File type is detected by extension on drop:
  //   .xlsx        → BOM import (shows one-time warning on first use)
  //   .tgz/.tar.gz → side data import (requires BOM to already be loaded)
  // Uses a depth counter to handle dragenter/dragleave on child elements.
  let dragDepth = 0;

  const configBar = document.getElementById('config-bar');
  const dragHint  = document.getElementById('drag-hint');

  function activateDrag() {
    configBar.classList.add('drag-active');
    dragHint.removeAttribute('hidden');
  }

  function deactivateDrag() {
    configBar.classList.remove('drag-active');
    dragHint.setAttribute('hidden', '');
  }

  document.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    if (dragDepth === 1) activateDrag();
  });

  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth === 0) deactivateDrag();
  });

  document.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  });

  document.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    deactivateDrag();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx')) {
      if (!bomAlreadyWarned()) { showBomWarning(); return; }
      handleBomFile(file);
    } else if (name.endsWith('.tgz') || name.endsWith('.tar.gz')) {
      if (!bom.loaded) {
        alert('Load a BOM first before importing side data.');
        return;
      }
      handleSideFile(file);
    } else {
      alert(`Unrecognised file type: "${file.name}"\n\nDrop an .xlsx file to load a BOM, or a .tgz file to load side data.`);
    }
  });

  // Sheet selector: reload rows from the chosen sheet and reset the header row
  document.getElementById('bom-sheet-select').addEventListener('change', e => {
    loadSheetRows(e.target.value);
  });

  // Header row input: re-populate the column table when the user changes the row number
  document.getElementById('bom-header-row').addEventListener('change', e => {
    const idx = Math.max(0, parseInt(e.target.value, 10) - 1);
    e.target.value = idx + 1; // write back the clamped value
    repopulateMappingTable(idx);
  });

  document.getElementById('btn-modal-close').addEventListener('click',   closeMappingModal);
  document.getElementById('btn-modal-cancel').addEventListener('click',  closeMappingModal);
  document.getElementById('btn-modal-confirm').addEventListener('click', confirmMapping);
}

// --------------------------------------------------------------------------
// showMappingModal(allRows)
// Stores all rows from the file and opens the column-mapping modal.
// The user picks which row contains the headers via the number input;
// repopulateMappingTable() rebuilds the column table whenever that changes.
// --------------------------------------------------------------------------
function showMappingModal(workbook) {
  _pendingWorkbook = workbook;

  // Populate and show/hide the sheet selector
  const sheetSelect = document.getElementById('bom-sheet-select');
  sheetSelect.innerHTML = '';
  workbook.SheetNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value       = name;
    opt.textContent = name;
    sheetSelect.appendChild(opt);
  });
  // Only show the sheet selector when there's more than one sheet
  document.getElementById('bom-sheet-label').hidden = workbook.SheetNames.length <= 1;

  loadSheetRows(workbook.SheetNames[0]);

  document.getElementById('bom-modal').removeAttribute('hidden');
}

// --------------------------------------------------------------------------
// repopulateMappingTable(headerRowIdx)
// Rebuilds the mapping table using the given row (0-based) as column headers.
// Auto-detects roles from the header text.
// --------------------------------------------------------------------------
function repopulateMappingTable(headerRowIdx) {
  const headers = (_pendingAllRows[headerRowIdx] || []).map(String);

  const tbody = document.querySelector('#modal-mapping-table tbody');
  tbody.innerHTML = '';

  headers.forEach((header, colIdx) => {
    const detectedRole = detectRole(header);

    const optionsHtml = ROLE_OPTIONS
      .map(opt => `<option value="${opt.value}"${opt.value === detectedRole ? ' selected' : ''}>${opt.label}</option>`)
      .join('');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="modal-col-header">${header || '(empty)'}</td>
      <td><select class="modal-role-select" data-col="${colIdx}">${optionsHtml}</select></td>
    `;
    tbody.appendChild(tr);
  });
}

function closeMappingModal() {
  document.getElementById('bom-modal').setAttribute('hidden', '');
  _pendingAllRows = null;
}

// --------------------------------------------------------------------------
// confirmMapping()
// Reads role assignments from the modal dropdowns, builds bom.rows,
// updates bom state, and closes the modal.
// --------------------------------------------------------------------------
function confirmMapping() {
  // Data rows are everything after the selected header row
  const headerRowIdx = Math.max(0, parseInt(document.getElementById('bom-header-row').value, 10) - 1);
  const dataRows     = _pendingAllRows.slice(headerRowIdx + 1);

  // Build colIndex → role map from the dropdowns
  const mapping = {};
  document.querySelectorAll('.modal-role-select').forEach(sel => {
    mapping[parseInt(sel.dataset.col, 10)] = sel.value;
  });

  bom.rows   = buildBomRows(dataRows, mapping);
  bom.loaded = true;

  updateBomStatus();
  closeMappingModal();
  runComparison();
}

// --------------------------------------------------------------------------
// buildBomRows(rawRows, mapping)
// Converts SheetJS array-of-arrays rows into typed row objects.
//   rawRows: array of arrays (data rows only, header row excluded)
//   mapping: { colIndex: role, ... }
// Refdes cells are pre-parsed through parseRefdesList().
// All other values are uppercased strings.
// Empty rows (no non-ignore cells) are skipped.
// --------------------------------------------------------------------------
function buildBomRows(rawRows, mapping) {
  const result = [];

  for (const rawRow of rawRows) {
    const row = {};

    for (const [colIdxStr, role] of Object.entries(mapping)) {
      if (role === 'ignore') continue;
      const colIdx    = parseInt(colIdxStr, 10);
      const cellValue = String(rawRow[colIdx] ?? '').trim();
      if (!cellValue) continue;

      if (role === 'refdes') {
        // Refdes cells may contain ranges or delimited lists — pre-parse them
        row.refdes = parseRefdesList(cellValue);
      } else {
        row[role] = cellValue.toUpperCase();
      }
    }

    if (Object.keys(row).length > 0) result.push(row);
  }

  return result;
}

// --------------------------------------------------------------------------
// updateBomStatus()
// Updates the BOM status indicator in the config bar.
// --------------------------------------------------------------------------
function updateBomStatus() {
  const el = document.getElementById('bom-status');
  let text = bom.loaded ? `BOM: ${bom.rows.length} rows` : 'No BOM';
  if (bom.loaded && sideData.loaded) text += ' + sides';
  el.textContent = text;
  updateTypeSelectors();
  updateSideControls();
}

// --------------------------------------------------------------------------
// Session persistence
// Saves panels (data only), config, and bom to sessionStorage on every
// runComparison(), and restores them at startup. DOM refs on panel objects
// (parsedEl, footerEl, etc.) are excluded — they're set by renderPanels().
// --------------------------------------------------------------------------
const SESSION_KEY = 'partser_state';

function saveState() {
  const state = {
    panels: panels.map(({ id, label, raw, inputType, outputType }) =>
      ({ id, label, raw, inputType, outputType })
    ),
    config,
    bom: { loaded: bom.loaded, rows: bom.rows },
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

function loadState() {
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch (_) {
    // Corrupted storage — ignore and start fresh
  }
  if (!state) return;

  panels.length = 0;
  for (const p of state.panels) {
    panels.push({ ...p, tokens: [], unresolvedTokens: [], parseErrors: [], partialTokens: new Set(), sourceRefdesOf: new Map() });
  }
  Object.assign(config, state.config);
  Object.assign(bom, state.bom);
}

function clearState() {
  sessionStorage.removeItem(SESSION_KEY);
  // Reset panels to default two-panel state
  panels.length = 0;
  panels.push(
    { id: 'a', label: 'List A', tokens: [], raw: '', inputType: 'refdes', outputType: 'refdes', unresolvedTokens: [], parseErrors: [], partialTokens: new Set(), sourceRefdesOf: new Map() },
    { id: 'b', label: 'List B', tokens: [], raw: '', inputType: 'refdes', outputType: 'refdes', unresolvedTokens: [], parseErrors: [], partialTokens: new Set(), sourceRefdesOf: new Map() },
  );
  // Reset config to defaults
  config.highlight     = true;
  config.diffOnly      = false;
  config.rangeOutput   = false;
  config.partialItalic = true;
  config.showSides     = false;
  config.delimiter     = ', ';
  config.sideFilter    = 'all';
  // Clear BOM
  bom.loaded = false;
  bom.rows   = [];
  // Clear side data
  sideData.loaded = false;
  sideData.map    = new Map();
  // Sync config bar UI to the reset config values (without re-wiring listeners)
  syncConfigBarUI();
  renderPanels();
  updateBomStatus();
  runComparison();
}

// --------------------------------------------------------------------------
// Help modal
// --------------------------------------------------------------------------
function initHelpModal() {
  const modal = document.getElementById('help-modal');

  document.getElementById('btn-help').addEventListener('click', () => {
    modal.removeAttribute('hidden');
  });

  document.getElementById('btn-help-close').addEventListener('click', () => {
    modal.setAttribute('hidden', '');
  });

  // Close when clicking the backdrop (outside the modal box)
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.setAttribute('hidden', '');
  });
}

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
loadState();
initConfigBar();
syncConfigBarUI();
initBomWarning();
initBomImport();
initHelpModal();
updateBomStatus();
renderPanels();
runComparison();
document.getElementById('btn-add-panel').addEventListener('click', addPanel);
// Two-click confirmation: first click arms the button; second click within
// 2 seconds executes. Clicking elsewhere or waiting resets it.
(function () {
  const btn = document.getElementById('btn-clear');
  let armed = false;
  let timer = null;

  function disarm() {
    armed = false;
    btn.textContent = 'Clear everything';
    btn.classList.remove('btn-clear-armed');
  }

  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Sure?';
      btn.classList.add('btn-clear-armed');
      timer = setTimeout(disarm, 2000);
    } else {
      clearTimeout(timer);
      disarm();
      clearState();
    }
  });

  // Clicking anywhere else disarms
  document.addEventListener('click', e => {
    if (armed && e.target !== btn) disarm();
  });
})();
