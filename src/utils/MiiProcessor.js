/**
 * MiiProcessor.js
 * Port of ShareMii.py — import/export Miis from Tomodachi Life Mii.sav + Player.sav.
 * Mirrors ShareMii.py exactly: same offsets, same LTD v3 format, same facepaint logic.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

// ─── Offset locator (mirrors Python offsetLocator) ────────────────────────────

/**
 * Search `data` (Uint8Array) for a 4-byte LE magic derived from hashHex.
 * Returns the array-base offset (= found index + 8, skipping magic + count header).
 * Returns null if not found.
 */
const offsetLocator = (data, hashHex) => {
  const hash = new Uint8Array(4);
  for (let i = 0; i < 4; i++) hash[i] = parseInt(hashHex.slice(6 - i*2, 8 - i*2), 16);
  // hash is little-endian bytes of the hex value
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const target = (parseInt(hashHex, 16)) >>> 0;
  for (let i = 0; i <= data.length - 8; i++) {
    if (view.getUint32(i, true) === target) {
      return view.getUint32(i + 4, true) + 4;
    }
  }
  return null;
};

// ─── Sexuality bit codec (mirrors Python DecodeSexuality/EncodeSexuality) ─────

const decodeSexuality = (data) => {
  const bits = [];
  for (let b = 0; b < data.length; b++) {
    const byte = data[b];
    for (let j = 0; j < 8; j++) bits.push((byte >> j) & 1); // LSB first
  }
  return bits;
};

const encodeSexuality = (bits) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[Math.floor(i / 8)] |= (1 << (i % 8));
  }
  return out;
};

// ─── Personality offset hashes (order = persOffsets list in ShareMii.py) ──────

const PERS_HASHES = [
  '43CD364F', 'CD8DBAF8', '25B48224', '607BA160', '68E1134E', // P1-P5
  '4913AE1A', '141EE086', '07B9D175', '81CF470A', '4D78E262', 'FBC3FFB0', // V1-V6
  '236E2D73', 'F3C3DE59', '660C5247', // S1-S3
  '5D7D3F45', 'AB8AE08B', '2545E583', '6CF484F4', // B1-B4
];

// ─── All hashes needed from each save file ────────────────────────────────────

const MII_SAV_HASHES = [
  '5E32ADF4', // FacePaintIndex
  '2499BFDA', // Mii Names
  '3A5EDA05', // Pronunciation
  '881CA27A', // Raw Mii data
  'DFC82223', // Sexuality
  '9999B7D9', // Level
  ...PERS_HASHES,
];

const PLAYER_SAV_MII_HASHES = [
  '4C9819E4', // FacePaint.Price
  'DECC8954', // FacePaint.TextureSourceType
  '23135BC5', // FacePaint.State
  'FFC750B6', // FacePaint.Unknown
  'A56E42EC', // FacePaint.Hash
  '114EFF89', // Temp slot offset (raw value, not +4)
];

// ─── Build offset maps ────────────────────────────────────────────────────────

const buildOffsets = (data, hashes, specialRaw = []) => {
  const result = {};
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const targets = new Map();
  for (const h of hashes) targets.set((parseInt(h, 16)) >>> 0, h);

  for (let i = 0; i <= data.length - 8; i++) {
    const val = view.getUint32(i, true);
    const h = targets.get(val);
    if (h !== undefined && result[h] === undefined) {
      if (specialRaw.includes(h)) {
        // Return the raw found index (used for temp slot offset)
        result[h] = view.getUint32(i + 4, true);
      } else {
        result[h] = view.getUint32(i + 4, true) + 4;
      }
    }
  }
  return result;
};

// ─── UTF-16 LE decoder (Hermes doesn't support TextDecoder('utf-16le')) ──────

const decodeUtf16LE = (bytes) => {
  let str = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    if (lo === 0 && hi === 0) break;
    const code = lo | (hi << 8);
    if (code >= 0xD800 && code <= 0xDBFF && i + 3 < bytes.length) {
      const lo2 = bytes[i + 2];
      const hi2 = bytes[i + 3];
      const trail = lo2 | (hi2 << 8);
      if (trail >= 0xDC00 && trail <= 0xDFFF) {
        str += String.fromCodePoint(0x10000 + ((code - 0xD800) << 10) + (trail - 0xDC00));
        i += 2;
        continue;
      }
    }
    str += String.fromCharCode(code);
  }
  return str;
};

// ─── SAF helpers ─────────────────────────────────────────────────────────────

const getFilename = (uri) => decodeURIComponent(uri).split('/').pop() || '';

const readDirSaf = async (uri) => {
  if (uri.startsWith('content://')) return StorageAccessFramework.readDirectoryAsync(uri);
  const names = await FileSystem.readDirectoryAsync(uri);
  return names.map(n => `${uri.replace(/\/$/, '')}/${n}`);
};

const buildSafChildUri = (parentTreeUri, childName) => {
  const m = parentTreeUri.match(/^(content:\/\/[^/]+\/tree\/)(.+)$/);
  if (!m) return null;
  return m[1] + encodeURIComponent(decodeURIComponent(m[2]) + '/' + childName);
};

const readSavFile = async (savFolderUri, name) => {
  const files = await readDirSaf(savFolderUri);
  const uri = files.find(u => getFilename(u).toLowerCase() === name.toLowerCase());
  if (!uri) throw new Error(`${name} not found in save folder.`);
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { bytes: new Uint8Array(Buffer.from(b64, 'base64')), uri };
};

const writeSavFile = async (savFolderUri, existingUri, name, data) => {
  const b64 = Buffer.from(data).toString('base64');
  if (existingUri) {
    try { await FileSystem.deleteAsync(existingUri, { idempotent: true }); } catch { }
  }
  const newUri = await StorageAccessFramework.createFileAsync(
    savFolderUri, name, 'application/octet-stream'
  );
  await StorageAccessFramework.writeAsStringAsync(newUri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return newUri;
};

// ─── Find facepaint texture files ─────────────────────────────────────────────

const facepaintFilename = (id, ext) => {
  const pad = id < 10 ? '00' : '0';
  return `UgcFacePaint${pad}${id}${ext}`;
};

const findUgcFolderUri = async (saveFolderUri) => {
  const files = await readDirSaf(saveFolderUri);
  const ugcEntry = files.find(u => getFilename(u).toLowerCase() === 'ugc');
  if (!ugcEntry) return null;
  return buildSafChildUri(saveFolderUri, getFilename(ugcEntry));
};

// ─── Public: list all initialised Mii slots ───────────────────────────────────

/**
 * Returns [{slot (1-based), name (string), initialized (bool)}] for all 70 slots.
 * saveFolderUri: SAF tree URI of the save folder (contains Mii.sav).
 */
export const listMiis = async (saveFolderUri) => {
  const { bytes: miisav } = await readSavFile(saveFolderUri, 'Mii.sav');
  const off = buildOffsets(miisav, ['881CA27A', '2499BFDA']);

  const miiDataBase  = off['881CA27A']; // raw Mii data, 156 bytes/slot
  const miiNamesBase = off['2499BFDA']; // names, 64 bytes/slot
  if (miiDataBase == null || miiNamesBase == null) {
    throw new Error('Could not locate Mii offsets in Mii.sav. Is this a valid save file?');
  }

  const result = [];

  for (let s = 0; s < 70; s++) {
    const miiSlice = miisav.subarray(miiDataBase + 156 * s, miiDataBase + 156 * s + 156);
    // Uninitialized slot: all bytes sum to 152 (all 0x01)
    const sum = miiSlice.reduce((a, b) => a + b, 0);
    const initialized = sum !== 152;

    let name = '';
    if (initialized) {
      const nameRaw = miisav.subarray(miiNamesBase + 64 * s, miiNamesBase + 64 * s + 64);
      try { name = decodeUtf16LE(nameRaw); } catch { }
    }

    result.push({ slot: s + 1, name, initialized });
  }
  return result;
};

// ─── Public: export one Mii as .ltd bytes ─────────────────────────────────────

/**
 * Export the Mii at `slot` (1-based) as a Uint8Array in LTD v3 format.
 * Returns { ltd: Uint8Array, name: string }.
 */
export const exportMii = async (slot, saveFolderUri, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  const s = slot - 1; // 0-based

  progress('Reading Mii.sav…');
  const { bytes: miisav } = await readSavFile(saveFolderUri, 'Mii.sav');
  progress('Reading Player.sav…');
  const { bytes: playersav } = await readSavFile(saveFolderUri, 'Player.sav');

  const moff = buildOffsets(miisav, MII_SAV_HASHES);
  const poff = buildOffsets(playersav, PLAYER_SAV_MII_HASHES, ['114EFF89']);

  const miiDataBase   = moff['881CA27A'];
  const miiNamesBase  = moff['2499BFDA'];
  const miiPronBase   = moff['3A5EDA05'];
  const fpIndexBase   = moff['5E32ADF4'];
  const sexBase       = moff['DFC82223'];

  if (miiDataBase == null) throw new Error('Mii.sav: could not locate raw Mii data offset.');

  const miiIndex = miiDataBase + 156 * s;
  const miiSlice = miisav.subarray(miiIndex, miiIndex + 156);
  const sum = miiSlice.reduce((a, b) => a + b, 0);
  if (sum === 152) throw new Error(`Slot ${slot} is uninitialized. Create a Mii there first.`);

  // Personality (18 fields × 4 bytes/slot)
  progress('Reading personality…');
  const personality = new Uint8Array(18 * 4);
  for (let x = 0; x < 18; x++) {
    const base = moff[PERS_HASHES[x]];
    if (base != null) personality.set(miisav.subarray(base + s * 4, base + s * 4 + 4), x * 4);
  }

  // Sexuality (3 bits for this slot)
  const sexBits = sexBase != null
    ? decodeSexuality(miisav.subarray(sexBase, sexBase + 27)).slice(s * 3, s * 3 + 3)
    : [0, 0, 0];

  // Name + pronunciation
  const name64   = miiNamesBase != null ? miisav.slice(miiNamesBase  + s * 64,  miiNamesBase  + s * 64  + 64)  : new Uint8Array(64);
  const pronoun128 = miiPronBase  != null ? miisav.slice(miiPronBase  + s * 128, miiPronBase   + s * 128 + 128) : new Uint8Array(128);

  // Facepaint detection
  let hasFacepaint = false;
  let facepaintId = 255;
  let canvasTex = new Uint8Array(0);
  let ugctexTex = new Uint8Array(0);

  if (fpIndexBase != null) {
    const fpId = miisav[fpIndexBase + 4 * s];
    if (fpId !== 0xFF) {
      hasFacepaint = true;
      facepaintId = fpId;
    }
  }

  if (hasFacepaint) {
    progress(`Reading facepaint (ID ${facepaintId})…`);
    const ugcUri = await findUgcFolderUri(saveFolderUri);
    if (ugcUri) {
      const ugcFiles = await readDirSaf(ugcUri);
      const canvasName = facepaintFilename(facepaintId, '.canvas.zs');
      const ugcName    = facepaintFilename(facepaintId, '.ugctex.zs');
      const canvasUri  = ugcFiles.find(u => getFilename(u).toLowerCase() === canvasName.toLowerCase());
      const ugcUri2    = ugcFiles.find(u => getFilename(u).toLowerCase() === ugcName.toLowerCase());
      if (canvasUri) {
        const b64 = await FileSystem.readAsStringAsync(canvasUri, { encoding: FileSystem.EncodingType.Base64 });
        canvasTex = new Uint8Array(Buffer.from(b64, 'base64'));
      }
      if (ugcUri2) {
        const b64 = await FileSystem.readAsStringAsync(ugcUri2, { encoding: FileSystem.EncodingType.Base64 });
        ugctexTex = new Uint8Array(Buffer.from(b64, 'base64'));
      }
    }
  }

  // Decode name for return value
  let nameStr = '';
  try { nameStr = decodeUtf16LE(name64); } catch { }

  // Assemble LTD v3
  progress('Assembling LTD…');
  const ltdHeader = new Uint8Array([
    3,                          // version
    hasFacepaint ? 1 : 0,       // has canvas facepaint
    hasFacepaint ? 1 : 0,       // has ugctex facepaint
    0,                          // padding
  ]);
  const sexPadded = new Uint8Array([sexBits[0], sexBits[1], sexBits[2], 0]);
  const CANVAS_MARKER = new Uint8Array([0xA3, 0xA3, 0xA3, 0xA3]);
  const UGCTEX_MARKER = new Uint8Array([0xA4, 0xA4, 0xA4, 0xA4]);

  const parts = [ltdHeader, miiSlice, personality, name64, pronoun128, sexPadded,
                 CANVAS_MARKER, canvasTex, UGCTEX_MARKER, ugctexTex];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const ltd = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { ltd.set(p, pos); pos += p.length; }

  return { ltd, name: nameStr };
};

// ─── Public: import a Mii from .ltd bytes ─────────────────────────────────────

/**
 * Import a Mii .ltd file into `slot` (1-based).
 * ltdBytes: Uint8Array of the .ltd file content.
 * Returns updated { miisav: Uint8Array, playersav: Uint8Array } (not yet written to disk).
 */
export const importMiiBytes = async (slot, ltdBytes, saveFolderUri, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  const s = slot - 1; // 0-based
  const mii = ltdBytes instanceof Uint8Array ? ltdBytes : new Uint8Array(ltdBytes);

  // Version check
  if (mii[0] < 1 || mii[0] > 3) throw new Error(`Unsupported LTD version: ${mii[0]}. Expected 1–3.`);

  // Convert old formats to v3 layout (mirrors Python conversion block)
  let miiData = mii.slice();
  if (miiData[0] < 3) {
    // v1/v2: delete byte at index 4 (was a padding byte in old format)
    const tmp = new Uint8Array(miiData.length - 1);
    tmp.set(miiData.subarray(0, 4));
    tmp.set(miiData.subarray(5), 4);
    miiData = tmp;

    if (mii[0] === 2) {
      // v2: insert zero byte at index 427, and fix A3/A4 markers
      const tmp2 = new Uint8Array(miiData.length + 1);
      tmp2.set(miiData.subarray(0, 427));
      tmp2[427] = 0;
      tmp2.set(miiData.subarray(427), 428);
      miiData = tmp2;

      // Fix canvas marker: ensure A3 A3 A3 A3
      const canvasStart = findMarker(miiData, new Uint8Array([0xA3, 0xA3, 0xA3])) + 3;
      miiData[canvasStart] = 0xA3;

      // Fix ugctex marker: find second A3.. and replace with A4 A4 A4 A4
      const ugcMark = findLastMarker(miiData, new Uint8Array([0xA3, 0xA3, 0xA3]));
      miiData[ugcMark + 1] = 0xA4;
      miiData[ugcMark + 2] = 0xA4;
      miiData[ugcMark + 3] = 0xA4;
    }
  }

  const CANVAS_MARKER = new Uint8Array([0xA3, 0xA3, 0xA3, 0xA3]);
  const UGCTEX_MARKER = new Uint8Array([0xA4, 0xA4, 0xA4, 0xA4]);

  const canvasPos = findMarker(miiData, CANVAS_MARKER);
  const ugctexPos = findLastMarkerOf(miiData, UGCTEX_MARKER);

  // Facepaint detection
  let facepaintMode = 0; // 0=none, 1=embedded, 2=external (not used here)
  if (miiData[1] === 1 && miiData[2] === 1) {
    facepaintMode = 1;
    miiData[47] = 1;
  }

  progress('Reading Mii.sav…');
  const { bytes: miisav, uri: miiSavUri } = await readSavFile(saveFolderUri, 'Mii.sav');
  progress('Reading Player.sav…');
  const { bytes: playersav, uri: playerSavUri } = await readSavFile(saveFolderUri, 'Player.sav');

  const moff = buildOffsets(miisav, MII_SAV_HASHES);
  const poff = buildOffsets(playersav, PLAYER_SAV_MII_HASHES, []);

  const miiDataBase = moff['881CA27A'];
  const miiNamesBase = moff['2499BFDA'];
  const miiPronBase  = moff['3A5EDA05'];
  const fpIndexBase  = moff['5E32ADF4'];
  const sexBase      = moff['DFC82223'];
  const levelBase    = moff['9999B7D9'];
  const fpPrice   = poff['4C9819E4'];
  const fpTexType = poff['DECC8954'];
  const fpState   = poff['23135BC5'];
  const fpUnknown = poff['FFC750B6'];
  const fpHash    = poff['A56E42EC'];

  if (miiDataBase == null) throw new Error('Mii.sav: could not locate Mii data offset.');

  // Validate slot is initialized
  const miiIndex = miiDataBase + 156 * s;
  const existing = miisav.subarray(miiIndex, miiIndex + 156);
  const sum = existing.reduce((a, b) => a + b, 0);
  if (sum === 152) throw new Error(`Slot ${slot} is not initialized. Create a Mii there first.`);

  // Work on copies
  const newMiisav   = miisav.slice();
  const newPlayersav = playersav.slice();

  // Determine current facepaint ID for this slot
  let facepaintId = 0xFF;
  if (fpIndexBase != null) facepaintId = miisav[fpIndexBase + 4 * s];

  // Write raw Mii data (156 bytes starting at offset 4 in LTD)
  progress('Writing Mii data…');
  newMiisav.set(miiData.subarray(4, 4 + 156), miiIndex);

  // Handle facepaint
  if (facepaintMode !== 0 && canvasPos !== -1 && ugctexPos !== -1) {
    progress('Writing facepaint…');

    // Find or assign a facepaint ID
    if (facepaintId === 0xFF) {
      // Find unused ID
      const usedIds = new Set();
      for (let x = 0; x < 70; x++) {
        if (fpIndexBase != null) {
          const id = miisav[fpIndexBase + 4 * x];
          if (id !== 0xFF) usedIds.add(id);
        }
      }
      for (let i = 0; i < 70; i++) {
        if (!usedIds.has(i)) { facepaintId = i; break; }
      }
    }

    // Update Mii.sav facepaint index for this slot
    if (fpIndexBase != null) {
      newMiisav[fpIndexBase + 4 * s] = facepaintId;
      newMiisav[fpIndexBase + 4 * s + 1] = 0;
      newMiisav[fpIndexBase + 4 * s + 2] = 0;
      newMiisav[fpIndexBase + 4 * s + 3] = 0;
    }

    // Update Player.sav facepaint entries
    if (fpPrice   != null) { newPlayersav.set(new Uint8Array([0xF4,0x01,0x00,0x00]), fpPrice   + 4 * facepaintId); }
    if (fpTexType != null) { newPlayersav.set(new Uint8Array([0x41,0x49,0x93,0x56]), fpTexType + 4 * facepaintId); }
    if (fpState   != null) { newPlayersav.set(new Uint8Array([0xF4,0xAD,0x7F,0x1D]), fpState   + 4 * facepaintId); }
    if (fpUnknown != null) { newPlayersav.set(new Uint8Array([0x00,0x80,0x00,0x00]), fpUnknown + 4 * facepaintId); }
    if (fpHash    != null) { newPlayersav.set(new Uint8Array([facepaintId,0x00,0x08,0x00]), fpHash + 4 * facepaintId); }

    // Write facepaint texture files to Ugc folder
    const ugcUri = await findUgcFolderUri(saveFolderUri);
    if (ugcUri) {
      const canvasBytes = miiData.slice(canvasPos + 4, ugctexPos);
      const ugctexBytes = miiData.slice(ugctexPos + 4);
      const canvasName  = facepaintFilename(facepaintId, '.canvas.zs');
      const ugcName     = facepaintFilename(facepaintId, '.ugctex.zs');

      const ugcFiles = await readDirSaf(ugcUri);
      const existCanvas = ugcFiles.find(u => getFilename(u).toLowerCase() === canvasName.toLowerCase());
      const existUgctex = ugcFiles.find(u => getFilename(u).toLowerCase() === ugcName.toLowerCase());

      await writeTexFile(ugcUri, existCanvas, canvasName, canvasBytes);
      await writeTexFile(ugcUri, existUgctex, ugcName, ugctexBytes);
    }
  } else if (facepaintMode === 0 && facepaintId !== 0xFF) {
    // New Mii has no facepaint — clear old facepaint entries
    if (fpIndexBase != null) {
      newMiisav.set(new Uint8Array([0xFF,0xFF,0xFF,0xFF]), fpIndexBase + 4 * s);
    }
    if (fpPrice   != null) { newPlayersav.set(new Uint8Array([0x00,0x00,0x00,0x00]), fpPrice   + 4 * facepaintId); }
    if (fpTexType != null) { newPlayersav.set(new Uint8Array([0x09,0xDE,0xEE,0xB6]), fpTexType + 4 * facepaintId); }
    if (fpState   != null) { newPlayersav.set(new Uint8Array([0xA5,0x8A,0xFF,0xAF]), fpState   + 4 * facepaintId); }
    if (fpUnknown != null) { newPlayersav.set(new Uint8Array([0x00,0x00,0x00,0x00]), fpUnknown + 4 * facepaintId); }
    if (fpHash    != null) { newPlayersav.set(new Uint8Array([0x00,0x00,0x00,0x00]), fpHash    + 4 * facepaintId); }
  }

  // Apply personality data (version >= 2)
  if (miiData[0] >= 2) {
    progress('Writing personality…');
    for (let x = 0; x < 18; x++) {
      const base = moff[PERS_HASHES[x]];
      if (base != null) newMiisav.set(miiData.subarray(160 + x*4, 160 + x*4 + 4), base + s * 4);
    }

    // Name (64 bytes at offset 232)
    if (miiNamesBase != null) newMiisav.set(miiData.subarray(232, 296), miiNamesBase + s * 64);
    // Pronunciation (128 bytes at offset 296)
    if (miiPronBase != null) newMiisav.set(miiData.subarray(296, 424), miiPronBase + s * 128);

    // Sexuality (3 bits at offset 424, only if level <= 1)
    const level = levelBase != null
      ? new DataView(miisav.buffer, miisav.byteOffset + levelBase + s * 4, 4).getUint32(0, true)
      : 0;
    if (level < 2 && sexBase != null) {
      const sexBits = decodeSexuality(newMiisav.subarray(sexBase, sexBase + 27));
      sexBits[s * 3]     = miiData[424] & 1;
      sexBits[s * 3 + 1] = miiData[425] & 1;
      sexBits[s * 3 + 2] = miiData[426] & 1;
      newMiisav.set(encodeSexuality(sexBits), sexBase);
    }
  }

  return {
    miisav: newMiisav,
    playersav: newPlayersav,
    miiSavUri,
    playerSavUri,
  };
};

/**
 * Write updated Mii.sav and Player.sav back to the save folder.
 */
export const writeMiiSavFiles = async (saveFolderUri, miiSavUri, playerSavUri, newMiisav, newPlayersav) => {
  await writeSavFile(saveFolderUri, miiSavUri, 'Mii.sav', newMiisav);
  await writeSavFile(saveFolderUri, playerSavUri, 'Player.sav', newPlayersav);
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const findMarker = (data, marker) => {
  outer: for (let i = 0; i <= data.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (data[i + j] !== marker[j]) continue outer;
    }
    return i;
  }
  return -1;
};

const findLastMarkerOf = (data, marker) => {
  let last = -1;
  outer: for (let i = 0; i <= data.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (data[i + j] !== marker[j]) continue outer;
    }
    last = i;
  }
  return last;
};

const writeTexFile = async (folderUri, existingUri, filename, data) => {
  const b64 = Buffer.from(data).toString('base64');
  if (existingUri) {
    try { await FileSystem.deleteAsync(existingUri, { idempotent: true }); } catch { }
  }
  const newUri = await StorageAccessFramework.createFileAsync(
    folderUri, filename, 'application/octet-stream'
  );
  await StorageAccessFramework.writeAsStringAsync(newUri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return newUri;
};
