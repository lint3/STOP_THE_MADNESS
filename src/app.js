// RefDes Comparator — app.js

// --------------------------------------------------------------------------
// Panel state
// Each panel is an object with an id, label, and runtime state.
// Adding/removing panels later means adding/removing from this array,
// then calling renderPanels() + runComparison().
// --------------------------------------------------------------------------
const panels = [
  { id: 'a', label: 'List A', tokens: [] },
  { id: 'b', label: 'List B', tokens: [] },
];

// --------------------------------------------------------------------------
// Config state
// --------------------------------------------------------------------------
const config = {
  highlight:   true,
  diffOnly:    false,
  rangeOutput: false,
  delimiter:   ', ',
};

// --------------------------------------------------------------------------
// Escape sequence interpreter for the delimiter text input
// --------------------------------------------------------------------------
function interpretEscapes(str) {
  return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

// --------------------------------------------------------------------------
// Config bar wiring
// Re-runs comparison when any config changes so display updates immediately.
// --------------------------------------------------------------------------
function initConfigBar() {
  const chkHighlight   = document.getElementById('chk-highlight');
  const chkDiffOnly    = document.getElementById('chk-diff-only');
  const chkRangeOutput = document.getElementById('chk-range-output');
  const txtDelimiter   = document.getElementById('txt-delimiter');

  chkHighlight.addEventListener('change', () => {
    config.highlight = chkHighlight.checked;
    runComparison();
  });

  chkDiffOnly.addEventListener('change', () => {
    config.diffOnly = chkDiffOnly.checked;
    runComparison();
  });

  chkRangeOutput.addEventListener('change', () => {
    config.rangeOutput = chkRangeOutput.checked;
    runComparison();
  });

  txtDelimiter.addEventListener('input', () => {
    config.delimiter = interpretEscapes(txtDelimiter.value);
    runComparison();
  });
}

// --------------------------------------------------------------------------
// Diff block: click header to expand/collapse content
// --------------------------------------------------------------------------
function initDiffBlock() {
  const diffOutput = document.getElementById('diff-output');
  const header     = document.getElementById('diff-output-header');
  const copyBtn    = document.getElementById('btn-copy-diff');

  header.addEventListener('click', (e) => {
    if (e.target === copyBtn) return;
    diffOutput.classList.toggle('expanded');
  });
}

// --------------------------------------------------------------------------
// Panel rendering
// Builds panel DOM from the panels array and stores element refs on each
// panel object so runComparison() can update them without re-querying the DOM.
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
        <div class="panel-label">${panel.label}</div>
        <button class="btn-delete-panel" title="Remove panel">×</button>
      </div>

      <div class="sub-area">
        <textarea class="raw-input" placeholder="Paste refdes list here..."></textarea>
      </div>

      <div class="sub-area">
        <div class="parsed-output-wrapper">
          <div class="parsed-output output-area">---</div>
          <button class="btn-copy btn-copy-parsed" title="Copy parsed list">Copy</button>
        </div>
      </div>

      <div class="panel-footer">
        <span class="footer-label">0 items</span>
      </div>
    `;

    // Store element refs on the panel object for use in runComparison()
    panel.parsedEl = col.querySelector('.parsed-output');
    panel.footerEl = col.querySelector('.footer-label');

    const textarea = col.querySelector('.raw-input');
    textarea.addEventListener('input', () => {
      panel.tokens = parseRefdesList(textarea.value);
      runComparison();
    });

    container.appendChild(col);
  }
}

// --------------------------------------------------------------------------
// runComparison()
// Computes diff status across all panels and re-renders each one.
// Called whenever any panel's input or any config setting changes.
// --------------------------------------------------------------------------
function runComparison() {
  // Count how many panels contain each refdes
  const freq = new Map(); // refdes → number of panels containing it
  for (const panel of panels) {
    for (const token of panel.tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }

  for (const panel of panels) {
    renderParsedOutput(panel, freq);
    updatePanelFooter(panel);
  }

  updateDiffCount(freq);
}

// --------------------------------------------------------------------------
// renderParsedOutput(panel, freq)
// Renders the parsed output div for one panel with colored refdes spans.
// --------------------------------------------------------------------------
function renderParsedOutput(panel, freq) {
  const totalPanels = panels.length;

  if (panel.tokens.length === 0) {
    panel.parsedEl.innerHTML = '---';
    return;
  }

  // When "show differences only" is on, hide items present in every panel
  const visible = config.diffOnly
    ? panel.tokens.filter(t => freq.get(t) < totalPanels)
    : panel.tokens;

  if (visible.length === 0) {
    panel.parsedEl.innerHTML = '(no differences)';
    return;
  }

  // statusOf maps a token to its highlight class ('' when highlighting is off,
  // which also causes collapseToRanges to ignore status when grouping runs)
  const statusOf = (token) => {
    if (!config.highlight) return '';
    const count = freq.get(token);
    if (count === totalPanels) return 'status-all';
    if (count === 1)           return 'status-unique';
    return 'status-partial';
  };

  // Build display items: either collapsed ranges or individual tokens
  const items = config.rangeOutput
    ? collapseToRanges(visible, statusOf)
    : visible.map(t => ({ display: t, statusClass: statusOf(t) }));

  const parts = items.map(({ display, statusClass }) =>
    `<span class="refdes ${statusClass}">${display}</span>`
  );

  panel.parsedEl.innerHTML = parts.join(config.delimiter);
}

// --------------------------------------------------------------------------
// updatePanelFooter(panel)
// --------------------------------------------------------------------------
function updatePanelFooter(panel) {
  const n = panel.tokens.length;
  panel.footerEl.textContent = n === 1 ? '1 item' : `${n} items`;
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
  const label = diffCount === 1 ? '1 difference' : `${diffCount} differences`;
  document.getElementById('diff-count').textContent = label;
}

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
initConfigBar();
initDiffBlock();
renderPanels();
