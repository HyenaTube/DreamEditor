/**
 * SaveEditor.js
 * Read/write helpers for Player.sav and Mii.sav fields not covered by
 * BinaryTextureProcessor (UGC) or MiiProcessor (Mii import/export).
 *
 * Hash values come from LivingTheDreamToolkit (C#) / ShareMii.py.
 * Set MONEY_HASH to the actual hex string once sourced from the toolkit.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { exportMii, listMiis } from './MiiProcessor';

// ─── Mii.sav field hashes ────────────────────────────────────────────────────

const LEVEL_HASH = '9999B7D9'; // uint32 LE, 4 bytes/slot (0-based)

// Personality / trait hashes (mirrored from ShareMii.py PERS_HASHES order)
export const PERSONALITY_FIELDS = [
  { key: 'p1', label: 'Easygoing',  hash: '43CD364F' },
  { key: 'p2', label: 'Outgoing',   hash: 'CD8DBAF8' },
  { key: 'p3', label: 'Confident',  hash: '25B48224' },
  { key: 'p4', label: 'Airhead',    hash: '607BA160' },
  { key: 'p5', label: 'Laid-back',  hash: '68E1134E' },
  { key: 'v1', label: 'Voice 1',    hash: '4913AE1A' },
  { key: 'v2', label: 'Voice 2',    hash: '141EE086' },
  { key: 'v3', label: 'Voice 3',    hash: '07B9D175' },
  { key: 'v4', label: 'Voice 4',    hash: '81CF470A' },
  { key: 'v5', label: 'Voice 5',    hash: '4D78E262' },
  { key: 'v6', label: 'Voice 6',    hash: 'FBC3FFB0' },
  { key: 's1', label: 'Aptitude 1', hash: '236E2D73' },
  { key: 's2', label: 'Aptitude 2', hash: 'F3C3DE59' },
  { key: 's3', label: 'Aptitude 3', hash: '660C5247' },
  { key: 'b1', label: 'Body 1',     hash: '5D7D3F45' },
  { key: 'b2', label: 'Body 2',     hash: 'AB8AE08B' },
  { key: 'b3', label: 'Body 3',     hash: '2545E583' },
  { key: 'b4', label: 'Body 4',     hash: '6CF484F4' },
];

// ─── Gameplay stat hashes (per-slot in Mii.sav) ─────────────────────────────

export const STAT_FIELDS = [
  { key: 'hunger',   label: 'Hunger',    hash: 'EF25B456' }, // EatFullness
  { key: 'bond',     label: 'Bond',      hash: 'D0882636' }, // BondInfo.Meter
  { key: 'stress',   label: 'Stress',    hash: '197237E7' }, // SatisfyInfo.Meter
  { key: 'mood',     label: 'Mood',      hash: '176C29EB' }, // Feeling.Type enum
  { key: 'miimoney', label: 'Mii Money', hash: 'F334FD2E' }, // Mii pocket money
];

// ─── Player.sav field hashes ─────────────────────────────────────────────────

const MONEY_HASH  = 'B82DE527'; // CoinGold  — G-coin balance in Player.sav
const SILVER_HASH = 'B6E959DC'; // CoinSilver

// ─── Offset scanner (same pattern as MiiProcessor) ──────────────────────────

const buildOffsets = (data, hashes) => {
  const result = {};
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const targets = new Map();
  for (const h of hashes) {
    if (h) targets.set((parseInt(h, 16)) >>> 0, h);
  }
  for (let i = 0; i <= data.length - 8; i++) {
    const val = view.getUint32(i, true);
    const h = targets.get(val);
    if (h !== undefined && result[h] === undefined) {
      result[h] = view.getUint32(i + 4, true) + 4;
    }
  }
  return result;
};

// ─── SAF read / write ─────────────────────────────────────────────────────────

const getFilename = (uri) => decodeURIComponent(uri).split('/').pop() || '';

const readDirSaf = async (uri) => {
  if (uri.startsWith('content://')) return StorageAccessFramework.readDirectoryAsync(uri);
  const names = await FileSystem.readDirectoryAsync(uri);
  return names.map(n => `${uri.replace(/\/$/, '')}/${n}`);
};

export const readSavFileBytes = async (savFolderUri, name) => {
  const files = await readDirSaf(savFolderUri);
  const uri = files.find(u => getFilename(u).toLowerCase() === name.toLowerCase());
  if (!uri) throw new Error(`${name} not found in save folder.`);
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { bytes: new Uint8Array(Buffer.from(b64, 'base64')), uri };
};

export const writeSavFileBytes = async (savFolderUri, existingUri, name, data) => {
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

// ─── Mii.sav readers / writers ───────────────────────────────────────────────

/**
 * Returns { level, personality, gameplay } for a slot (1-based).
 * Each field list contains [{key,label,hash,value:uint32|null}].
 */
export const getMiiStats = (miiSavBytes, slot) => {
  const s = slot - 1;
  const allHashes = [
    LEVEL_HASH,
    ...PERSONALITY_FIELDS.map(f => f.hash),
    ...STAT_FIELDS.map(f => f.hash),
  ];
  const off = buildOffsets(miiSavBytes, allHashes);
  const view = new DataView(miiSavBytes.buffer, miiSavBytes.byteOffset, miiSavBytes.length);

  const levelBase = off[LEVEL_HASH];
  const level = levelBase != null ? view.getUint32(levelBase + s * 4, true) : null;

  const personality = PERSONALITY_FIELDS.map(f => {
    const base = off[f.hash];
    const value = base != null ? view.getUint32(base + s * 4, true) : null;
    return { ...f, value };
  });

  const gameplay = STAT_FIELDS.map(f => {
    const base = off[f.hash];
    const value = base != null ? view.getUint32(base + s * 4, true) : null;
    return { ...f, value };
  });

  return { level, personality, gameplay };
};

/**
 * Returns a modified Mii.sav Uint8Array.
 * personality is an array of { hash, value: uint32 }.
 */
export const setMiiStats = (miiSavBytes, slot, { level, personality } = {}) => {
  const s = slot - 1;
  const allHashes = [LEVEL_HASH, ...PERSONALITY_FIELDS.map(f => f.hash)];
  const off = buildOffsets(miiSavBytes, allHashes);
  const out = miiSavBytes.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.length);

  if (level != null) {
    const base = off[LEVEL_HASH];
    if (base != null) view.setUint32(base + s * 4, level >>> 0, true);
  }

  if (personality) {
    for (const { hash, value } of personality) {
      if (value == null) continue;
      const base = off[hash];
      if (base != null) view.setUint32(base + s * 4, value >>> 0, true);
    }
  }

  return out;
};

/**
 * Returns { slot: level } map for all initialized Miis.
 * Reads Mii.sav once and extracts levels for the given slot list.
 */
export const getMiiLevels = (miiSavBytes, slots) => {
  const off = buildOffsets(miiSavBytes, [LEVEL_HASH]);
  const base = off[LEVEL_HASH];
  if (base == null) return {};
  const view = new DataView(miiSavBytes.buffer, miiSavBytes.byteOffset, miiSavBytes.length);
  const result = {};
  for (const slot of slots) {
    result[slot] = view.getUint32(base + (slot - 1) * 4, true);
  }
  return result;
};

// ─── Player.sav readers / writers ─────────────────────────────────────────────

/** Returns { gold: uint32|null, silver: uint32|null } from Player.sav. */
export const getPlayerMoney = (playerSavBytes) => {
  const off = buildOffsets(playerSavBytes, [MONEY_HASH, SILVER_HASH]);
  const view = new DataView(playerSavBytes.buffer, playerSavBytes.byteOffset, playerSavBytes.length);
  return {
    gold:   off[MONEY_HASH]  != null ? view.getUint32(off[MONEY_HASH],  true) : null,
    silver: off[SILVER_HASH] != null ? view.getUint32(off[SILVER_HASH], true) : null,
  };
};

/** Returns modified Player.sav Uint8Array with updated gold / silver values. */
export const setPlayerMoney = (playerSavBytes, { gold, silver } = {}) => {
  const off = buildOffsets(playerSavBytes, [MONEY_HASH, SILVER_HASH]);
  const out = playerSavBytes.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.length);
  if (gold   != null && off[MONEY_HASH]  != null) view.setUint32(off[MONEY_HASH],  gold   >>> 0, true);
  if (silver != null && off[SILVER_HASH] != null) view.setUint32(off[SILVER_HASH], silver >>> 0, true);
  return out;
};

// ─── Export all Miis ─────────────────────────────────────────────────────────

/**
 * Exports every initialized Mii as an .ltd file into destFolderUri (SAF folder).
 * Returns { exported, skipped } counts.
 */
export const exportAllMiis = async (saveFolderUri, destFolderUri, onProgress) => {
  const miis = await listMiis(saveFolderUri);
  const initialized = miis.filter(m => m.initialized);
  let exported = 0, skipped = 0;

  for (let i = 0; i < initialized.length; i++) {
    const mii = initialized[i];
    onProgress?.(`Exporting ${i + 1}/${initialized.length}: ${mii.name || `Slot ${mii.slot}`}…`);
    try {
      const { ltd, name } = await exportMii(mii.slot, saveFolderUri);
      const safeN = (name || `Mii_slot${mii.slot}`).replace(/[^a-zA-Z0-9._\- ]/g, '_');
      const filename = `${safeN}.ltd`;
      const newUri = await StorageAccessFramework.createFileAsync(
        destFolderUri, filename, 'application/octet-stream'
      );
      await StorageAccessFramework.writeAsStringAsync(
        newUri,
        Buffer.from(ltd).toString('base64'),
        { encoding: FileSystem.EncodingType.Base64 }
      );
      exported++;
    } catch {
      skipped++;
    }
  }

  return { exported, skipped };
};
