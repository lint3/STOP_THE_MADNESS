// odb.test.js — tests for odb.js (ODB++ archive parsing)
//
// Run with: node --test

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readTar, parseOdbComponentsFile, parseOdbTgz } = require('../odb.js');
const pako = require('../lib/pako.min.js');

// --------------------------------------------------------------------------
// Tar builders for test fixtures
// --------------------------------------------------------------------------

// Builds a single tar entry header block (512 bytes).
// The data block(s) must be appended separately.
function makeTarHeader(name, contentBytes) {
  const buf = new Uint8Array(512);
  buf.fill(0);

  // Name (bytes 0-99, null-terminated ASCII)
  const nameBytes = new TextEncoder().encode(name);
  for (let i = 0; i < Math.min(nameBytes.length, 100); i++) buf[i] = nameBytes[i];

  // Mode (bytes 100-107): "0000644\0"
  const mode = '0000644\0';
  for (let i = 0; i < mode.length; i++) buf[100 + i] = mode.charCodeAt(i);

  // UID / GID (bytes 108-123): "0000000\0"
  const uid = '0000000\0';
  for (let i = 0; i < uid.length; i++) {
    buf[108 + i] = uid.charCodeAt(i);
    buf[116 + i] = uid.charCodeAt(i);
  }

  // Size (bytes 124-135): octal string, space-padded
  const sizeOctal = contentBytes.length.toString(8).padStart(11, '0') + ' ';
  for (let i = 0; i < 12; i++) buf[124 + i] = sizeOctal.charCodeAt(i);

  // Mtime (bytes 136-147): "0000000000\0" (zero timestamp)
  const mtime = '0000000000\0';
  for (let i = 0; i < mtime.length; i++) buf[136 + i] = mtime.charCodeAt(i);

  // Typeflag (byte 156): '0' for regular file
  buf[156] = 0x30;

  // Ustar magic (bytes 257-263): "ustar\0"
  const ustar = 'ustar\0';
  for (let i = 0; i < ustar.length; i++) buf[257 + i] = ustar.charCodeAt(i);

  // Checksum (bytes 148-155): first fill with spaces, then compute
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  for (let i = 0; i < 8; i++) buf[148 + i] = checksumOctal.charCodeAt(i);

  return buf;
}

// Builds a complete tar archive from { name: content } map.
function buildTar(entries) {
  const parts = [];
  for (const [name, content] of Object.entries(entries)) {
    const contentBytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
    parts.push(makeTarHeader(name, contentBytes));
    parts.push(contentBytes);
    // Pad data to 512-byte boundary
    const padLen = (512 - (contentBytes.length % 512)) % 512;
    if (padLen > 0) parts.push(new Uint8Array(padLen));
  }
  // End-of-archive: two zero blocks
  parts.push(new Uint8Array(512));
  parts.push(new Uint8Array(512));

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

// Builds a gzipped tar (simulating a .tgz archive).
function buildTgz(entries) {
  return pako.gzip(buildTar(entries));
}

// ==========================================================================
// readTar
// ==========================================================================

describe('readTar', () => {
  it('parses a single-file tar archive', () => {
    const tar = buildTar({ 'hello.txt': 'Hello, world!' });
    const entries = readTar(tar);
    assert.strictEqual(Object.keys(entries).length, 1);
    const decoded = new TextDecoder().decode(entries['hello.txt']);
    assert.strictEqual(decoded, 'Hello, world!');
  });

  it('parses multiple files in a tar archive', () => {
    const tar = buildTar({
      'a.txt': 'AAAA',
      'b.txt': 'BBBBBB',
    });
    const entries = readTar(tar);
    assert.strictEqual(Object.keys(entries).length, 2);
    assert.strictEqual(new TextDecoder().decode(entries['a.txt']), 'AAAA');
    assert.strictEqual(new TextDecoder().decode(entries['b.txt']), 'BBBBBB');
  });

  it('returns empty object for empty tar (just end-of-archive blocks)', () => {
    const buf = new Uint8Array(1024);
    buf.fill(0);
    const entries = readTar(buf);
    assert.strictEqual(Object.keys(entries).length, 0);
  });

  it('handles file content that spans multiple 512-byte blocks', () => {
    const bigContent = 'X'.repeat(1000);
    const tar = buildTar({ 'big.txt': bigContent });
    const entries = readTar(tar);
    assert.strictEqual(new TextDecoder().decode(entries['big.txt']), bigContent);
  });

  it('handles empty files', () => {
    const tar = buildTar({ 'empty.txt': '' });
    const entries = readTar(tar);
    assert.strictEqual(Object.keys(entries).length, 1);
    assert.strictEqual(entries['empty.txt'].length, 0);
  });

  it('preserves binary content', () => {
    const binary = new Uint8Array([0x00, 0xFF, 0x42, 0x7F, 0x80]);
    const tar = buildTar({ 'bin.dat': binary });
    const entries = readTar(tar);
    assert.deepStrictEqual(entries['bin.dat'], binary);
  });
});

// ==========================================================================
// parseOdbComponentsFile
// ==========================================================================

describe('parseOdbComponentsFile', () => {
  it('extracts refdes from CMP lines', () => {
    const text = [
      'CMP 1 100 200 0 0 R1 RES_0805 ;comment',
      'CMP 2 150 250 90 0 C5 CAP_0603',
      'CMP 3 200 300 180 0 U11 IC_SOIC8',
    ].join('\n');
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['C5', 'R1', 'U11']);
  });

  it('ignores non-CMP lines', () => {
    const text = [
      '# This is a comment',
      'CMP 1 0 0 0 0 R1 RES_0805',
      '  CMP 2 0 0 0 0 C5 CAP_0603',
      'NOTACMP 3 0 0 0 0 X1 BAD',
      '',
    ].join('\n');
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['C5', 'R1']);
  });

  it('skips malformed CMP lines (too few fields)', () => {
    const text = [
      'CMP',
      'CMP 1',
      'CMP 1 0 0 0 0',
      'CMP 1 0 0 0 0 R1 RES_0805',
    ].join('\n');
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['R1']);
  });

  it('deduplicates refdes', () => {
    const text = [
      'CMP 1 0 0 0 0 R1 RES_0805',
      'CMP 2 0 0 0 0 R1 RES_0805',  // duplicate refdes
    ].join('\n');
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['R1']);
  });

  it('uppercases refdes', () => {
    const text = 'CMP 1 0 0 0 0 r1 RES_0805';
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['R1']);
  });

  it('sorts output with natural sort', () => {
    const text = [
      'CMP 1 0 0 0 0 R10 RES_0805',
      'CMP 2 0 0 0 0 R2 RES_0805',
      'CMP 3 0 0 0 0 R1 RES_0805',
    ].join('\n');
    const result = parseOdbComponentsFile(text);
    assert.deepStrictEqual(result, ['R1', 'R2', 'R10']);
  });

  it('returns empty array for empty input', () => {
    const result = parseOdbComponentsFile('');
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when no CMP lines present', () => {
    const result = parseOdbComponentsFile('Just some text\nNo CMP here');
    assert.deepStrictEqual(result, []);
  });
});

// ==========================================================================
// parseOdbTgz (integration test)
// ==========================================================================

describe('parseOdbTgz', () => {
  const TOP_SUFFIX = 'layers/comp_+_top/components';
  const BOT_SUFFIX = 'layers/comp_+_bot/components';

  it('extracts side data from a valid ODB++ tgz', () => {
    const topContent = [
      'CMP 1 0 0 0 0 R1 RES_0805',
      'CMP 2 0 0 0 0 R3 RES_0805',
    ].join('\n');
    const botContent = [
      'CMP 1 0 0 0 0 C1 CAP_0603',
      'CMP 2 0 0 0 0 C2 CAP_0603',
    ].join('\n');

    // Variable prefix simulates real ODB++ paths with project/step names
    const prefix = 'myproject/steps/pcb/';
    const tgz = buildTgz({
      [prefix + TOP_SUFFIX]: topContent,
      [prefix + BOT_SUFFIX]: botContent,
    });

    const map = parseOdbTgz(tgz.buffer.slice(tgz.byteOffset, tgz.byteOffset + tgz.byteLength));
    assert.strictEqual(map.get('R1'), 'top');
    assert.strictEqual(map.get('R3'), 'top');
    assert.strictEqual(map.get('C1'), 'bottom');
    assert.strictEqual(map.get('C2'), 'bottom');
    assert.strictEqual(map.size, 4);
  });

  it('throws when top components file is missing', () => {
    const tgz = buildTgz({
      ['layers/comp_+_bot/components']: 'CMP 1 0 0 0 0 C1 CAP_0603',
    });
    assert.throws(
      () => parseOdbTgz(tgz.buffer.slice(tgz.byteOffset, tgz.byteOffset + tgz.byteLength)),
      /Could not find.*comp_\+_top/,
    );
  });

  it('throws when bottom components file is missing', () => {
    const tgz = buildTgz({
      ['layers/comp_+_top/components']: 'CMP 1 0 0 0 0 R1 RES_0805',
    });
    assert.throws(
      () => parseOdbTgz(tgz.buffer.slice(tgz.byteOffset, tgz.byteOffset + tgz.byteLength)),
      /Could not find.*comp_\+_bot/,
    );
  });

  it('throws when refdes appear on both sides', () => {
    const prefix = 'proj/step/';
    const tgz = buildTgz({
      [prefix + TOP_SUFFIX]: 'CMP 1 0 0 0 0 R1 RES_0805',
      [prefix + BOT_SUFFIX]: 'CMP 1 0 0 0 0 R1 RES_0805',
    });
    assert.throws(
      () => parseOdbTgz(tgz.buffer.slice(tgz.byteOffset, tgz.byteOffset + tgz.byteLength)),
      /Refdes found on both top and bottom sides/,
    );
  });

  it('throws on corrupt gzip data', () => {
    assert.throws(
      () => parseOdbTgz(new Uint8Array([0x00, 0x01, 0x02]).buffer),
      /Failed to decompress/,
    );
  });
});
