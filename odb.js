// odb.js — ODB++ archive parsing
//
// Exports (browser globals): readTar, parseOdbComponentsFile, parseOdbTgz
//
// Depends on: pako (global), naturalSort (from parser.js)

// --------------------------------------------------------------------------
// readTar(bytes) → { [path]: Uint8Array }
// Parses a decompressed tar archive and returns a map of path → raw bytes.
// Handles standard POSIX/ustar archives. Paths longer than 100 bytes (using
// the ustar prefix field) are not expected for ODB++ archives and not needed.
// --------------------------------------------------------------------------
function readTar(bytes) {
  const entries = {};
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);

    // All-zero block = end-of-archive sentinel
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (header[i] !== 0) { allZero = false; break; } }
    if (allZero) break;

    // Name: bytes 0–99, null-terminated ASCII
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder('ascii').decode(header.subarray(0, nameEnd));

    // Size: bytes 124–135, zero-padded octal string
    let sizeStr = '';
    for (let i = 124; i < 136; i++) {
      if (header[i] === 0 || header[i] === 32) break;
      sizeStr += String.fromCharCode(header[i]);
    }
    const size = parseInt(sizeStr, 8);

    offset += 512;

    if (name && !isNaN(size) && size >= 0) {
      entries[name] = bytes.subarray(offset, offset + size);
    }

    // Data blocks are padded to a 512-byte boundary
    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

// --------------------------------------------------------------------------
// parseOdbComponentsFile(text) → string[]
// Extracts refdes strings from one ODB++ components text file (top or bot).
// Only "CMP" lines are parsed; field index 6 (0-based) is the refdes.
//
// CMP line format:
//   CMP <idx> <x> <y> <rot> <mirror> <REFDES> <part> ;<attrs>
//    [0]  [1] [2] [3]  [4]    [5]      [6]     [7]
//
// Returns a deduplicated, naturalSort-sorted array of uppercase refdes.
// --------------------------------------------------------------------------
function parseOdbComponentsFile(text) {
  const refdes = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('CMP ')) continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length < 7) continue;
    refdes.push(fields[6].toUpperCase());
  }
  return [...new Set(refdes)].sort(naturalSort);
}

// --------------------------------------------------------------------------
// parseOdbTgz(arrayBuffer) → Map<string, 'top'|'bottom'>
// Decompresses a .tgz ODB++ archive and extracts side data from the two
// component layer files.
//
// Returns: Map of uppercase refdes → 'top' | 'bottom'
// Throws:  A user-facing error string on any failure (missing files,
//          corrupt gzip, or refdes found on both sides).
// --------------------------------------------------------------------------
function parseOdbTgz(arrayBuffer) {
  const TOP_PATH = 'odb/steps/pcb/layers/comp_+_top/components';
  const BOT_PATH = 'odb/steps/pcb/layers/comp_+_bot/components';

  // Decompress gzip layer with pako
  let bytes;
  try {
    bytes = pako.inflate(new Uint8Array(arrayBuffer));
  } catch (e) {
    throw `Failed to decompress file: ${e.message || e}. Is this a valid .tgz archive?`;
  }

  // Parse tar layer
  const entries = readTar(bytes);

  // Locate the component files by exact path
  if (!entries[TOP_PATH]) {
    throw `Could not find ${TOP_PATH} in archive — is this a valid ODB++ export?`;
  }
  if (!entries[BOT_PATH]) {
    throw `Could not find ${BOT_PATH} in archive — is this a valid ODB++ export?`;
  }

  const decode = u8 => new TextDecoder().decode(u8);
  const topRefdes = parseOdbComponentsFile(decode(entries[TOP_PATH]));
  const botRefdes = parseOdbComponentsFile(decode(entries[BOT_PATH]));

  // Hard error if any refdes appears on both sides — this indicates corrupt data
  const topSet  = new Set(topRefdes);
  const overlap = botRefdes.filter(r => topSet.has(r));
  if (overlap.length > 0) {
    const listed = overlap.slice(0, 10).join(', ');
    const extra  = overlap.length > 10 ? ` (and ${overlap.length - 10} more)` : '';
    throw `Refdes found on both top and bottom sides: ${listed}${extra} — archive may be corrupt`;
  }

  const map = new Map();
  for (const r of topRefdes) map.set(r, 'top');
  for (const r of botRefdes) map.set(r, 'bottom');
  return map;
}
