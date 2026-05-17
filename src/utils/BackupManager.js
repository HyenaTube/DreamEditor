/**
 * BackupManager.js
 * Creates/restores ZIP backups of a Tomodachi Life save folder.
 * Backups stored in FileSystem.documentDirectory/backups/ (app-private, always writable).
 * Max 10 backups per save folder (oldest pruned automatically).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const MAX_BACKUPS = 10;
const BACKUP_DIR = FileSystem.documentDirectory + 'backups/';

// ─── CRC-32 ───────────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

const crc32 = (data) => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

// ─── Minimal ZIP writer (store/no-compression) ────────────────────────────────

const u16le = (n, buf, off) => { buf[off] = n & 0xFF; buf[off+1] = (n >> 8) & 0xFF; };
const u32le = (n, buf, off) => {
  buf[off]   =  n        & 0xFF; buf[off+1] = (n >>  8) & 0xFF;
  buf[off+2] = (n >> 16) & 0xFF; buf[off+3] = (n >> 24) & 0xFF;
};

/**
 * Build a ZIP archive (store mode) from entries: [{ path: string, data: Uint8Array }].
 * Returns a Uint8Array of the complete ZIP.
 */
const buildZip = (entries) => {
  const encoder = new TextEncoder();
  const nameBuffers = entries.map(e => encoder.encode(e.path));
  const crcs        = entries.map(e => crc32(e.data));

  // First pass: compute total local-headers+data size
  let localSize = 0;
  for (let i = 0; i < entries.length; i++) {
    localSize += 30 + nameBuffers[i].length + entries[i].data.length;
  }
  const centralDirSize = entries.reduce((s, _, i) => s + 46 + nameBuffers[i].length, 0);
  const totalSize = localSize + centralDirSize + 22;

  const out = new Uint8Array(totalSize);
  const offsets = [];
  let pos = 0;

  // Local file headers + data
  for (let i = 0; i < entries.length; i++) {
    offsets.push(pos);
    const nb = nameBuffers[i];
    const data = entries[i].data;
    const sz = data.length;
    out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x03; out[pos+3]=0x04; // signature
    u16le(20, out, pos+4);   // version needed
    u16le(0,  out, pos+6);   // flags
    u16le(0,  out, pos+8);   // compression: store
    u16le(0,  out, pos+10);  // mod time
    u16le(0,  out, pos+12);  // mod date
    u32le(crcs[i], out, pos+14); // CRC-32
    u32le(sz, out, pos+18);  // compressed size
    u32le(sz, out, pos+22);  // uncompressed size
    u16le(nb.length, out, pos+26); // filename length
    u16le(0, out, pos+28);   // extra field length
    out.set(nb, pos+30);
    pos += 30 + nb.length;
    out.set(data, pos);
    pos += sz;
  }

  // Central directory
  const centralStart = pos;
  for (let i = 0; i < entries.length; i++) {
    const nb = nameBuffers[i];
    const data = entries[i].data;
    const sz = data.length;
    out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x01; out[pos+3]=0x02; // signature
    u16le(20, out, pos+4);  // version made by
    u16le(20, out, pos+6);  // version needed
    u16le(0,  out, pos+8);  // flags
    u16le(0,  out, pos+10); // compression: store
    u16le(0,  out, pos+12); // mod time
    u16le(0,  out, pos+14); // mod date
    u32le(crcs[i], out, pos+16); // CRC-32
    u32le(sz, out, pos+20); // compressed size
    u32le(sz, out, pos+24); // uncompressed size
    u16le(nb.length, out, pos+28); // filename length
    u16le(0, out, pos+30);  // extra field length
    u16le(0, out, pos+32);  // comment length
    u16le(0, out, pos+34);  // disk number start
    u16le(0, out, pos+36);  // internal file attributes
    u32le(0, out, pos+38);  // external file attributes
    u32le(offsets[i], out, pos+42); // local header offset
    out.set(nb, pos+46);
    pos += 46 + nb.length;
  }

  // End of central directory record
  out[pos]=0x50; out[pos+1]=0x4B; out[pos+2]=0x05; out[pos+3]=0x06;
  u16le(0, out, pos+4);  // disk number
  u16le(0, out, pos+6);  // disk with central dir
  u16le(entries.length, out, pos+8);  // entries on disk
  u16le(entries.length, out, pos+10); // total entries
  u32le(centralDirSize, out, pos+12); // central dir size
  u32le(centralStart,   out, pos+16); // central dir offset
  u16le(0, out, pos+20); // comment length

  return out;
};

// ─── Minimal ZIP reader (store mode) ─────────────────────────────────────────

/**
 * Extract entries from a store-mode ZIP. Returns [{ path, data: Uint8Array }].
 */
const readZip = (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const decoder = new TextDecoder();
  const entries = [];
  let i = 0;

  while (i <= data.length - 30) {
    if (view.getUint32(i, true) !== 0x04034b50) { i++; continue; }
    const compMethod = view.getUint16(i + 8,  true);
    const compSize   = view.getUint32(i + 18, true);
    const nameLen    = view.getUint16(i + 26, true);
    const extraLen   = view.getUint16(i + 28, true);
    const nameStart  = i + 30;
    const dataStart  = nameStart + nameLen + extraLen;

    const path = decoder.decode(data.subarray(nameStart, nameStart + nameLen));
    // Only extract store-mode entries; skip compressed ones
    const fileData = compMethod === 0
      ? data.slice(dataStart, dataStart + compSize)
      : new Uint8Array(0);

    if (path && !path.endsWith('/')) entries.push({ path, data: fileData });
    i = dataStart + compSize;
  }

  return entries;
};

// ─── SAF / filesystem helpers ─────────────────────────────────────────────────

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

// ─── Backup directory (app-private) ──────────────────────────────────────────

const ensureBackupDir = async () => {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
};

// ─── Slug from save folder URI (for partitioning backups per save folder) ─────

const slugUri = (uri) => {
  // Use last two path segments of the decoded URI as a short identifier
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split(/[/:\\]+/).filter(Boolean);
  return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30) || 'save';
};

// ─── Public: Create backup ────────────────────────────────────────────────────

/**
 * Create a ZIP backup of the save folder (Player.sav, Mii.sav, Map.sav + Ugc/*.zs).
 * label: short description e.g. "imported Sonic.ltdf"
 * saveFolderUri: SAF tree URI of the save folder (contains Player.sav, Mii.sav, Ugc/)
 * Returns the backup filename (without path).
 */
export const createBackup = async (saveFolderUri, label, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  await ensureBackupDir();

  // Prune old backups before creating a new one
  await pruneBackups(saveFolderUri, MAX_BACKUPS - 1);

  progress('Scanning save folder…');
  const topFiles = await readDirSaf(saveFolderUri);
  const zipEntries = [];

  // Collect root .sav files
  for (const uri of topFiles) {
    const filename = getFilename(uri);
    if (!filename.toLowerCase().endsWith('.sav')) continue;
    progress(`Reading ${filename}…`);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      zipEntries.push({ path: filename, data: new Uint8Array(Buffer.from(b64, 'base64')) });
    } catch { /* skip unreadable */ }
  }

  // Collect Ugc/*.zs files
  const ugcEntry = topFiles.find(u => getFilename(u).toLowerCase() === 'ugc');
  if (ugcEntry) {
    const ugcUri = buildSafChildUri(saveFolderUri, getFilename(ugcEntry));
    if (ugcUri) {
      progress('Scanning Ugc folder…');
      try {
        const ugcFiles = await readDirSaf(ugcUri);
        for (const uri of ugcFiles) {
          const filename = getFilename(uri);
          if (!filename.toLowerCase().endsWith('.zs')) continue;
          progress(`Reading Ugc/${filename}…`);
          try {
            const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            zipEntries.push({ path: `Ugc/${filename}`, data: new Uint8Array(Buffer.from(b64, 'base64')) });
          } catch { /* skip */ }
        }
      } catch { /* no Ugc folder */ }
    }
  }

  if (zipEntries.length === 0) throw new Error('Nothing to backup — no save files found.');

  progress('Building ZIP…');
  const zipData = buildZip(zipEntries);

  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 60).trim();
  const slug = slugUri(saveFolderUri);
  const filename = `${ts}_${slug}_${safeLabel}.zip`;

  progress('Writing backup…');
  await FileSystem.writeAsStringAsync(
    BACKUP_DIR + filename,
    Buffer.from(zipData).toString('base64'),
    { encoding: FileSystem.EncodingType.Base64 }
  );

  progress('Done');
  return filename;
};

// ─── Public: List backups ─────────────────────────────────────────────────────

/**
 * List all backups for a given save folder URI, newest first.
 * Returns [{ filename, label, timestamp, path }]
 */
export const listBackups = async (saveFolderUri) => {
  await ensureBackupDir();
  const slug = slugUri(saveFolderUri);
  let files;
  try {
    files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  } catch { return []; }

  return files
    .filter(f => f.endsWith('.zip') && f.includes(slug))
    .map(f => {
      // Parse: 2024-01-15T12-30-45_slug_label.zip
      const withoutExt = f.slice(0, -4);
      const firstUnderscore = withoutExt.indexOf('_');
      const secondUnderscore = withoutExt.indexOf('_', firstUnderscore + 1);
      const tsRaw  = withoutExt.slice(0, firstUnderscore);
      const rest   = withoutExt.slice(secondUnderscore + 1);
      const tsHuman = tsRaw.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
      return {
        filename: f,
        label: rest.replace(/_/g, ' '),
        timestamp: tsHuman,
        path: BACKUP_DIR + f,
      };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));
};

// ─── Public: Restore backup ───────────────────────────────────────────────────

/**
 * Restore a backup ZIP to the save folder, overwriting existing files.
 * backupPath: local file path to the .zip
 * saveFolderUri: SAF tree URI of the save folder
 */
export const restoreBackup = async (backupPath, saveFolderUri, onProgress) => {
  const progress = (msg) => onProgress?.(msg);

  progress('Reading backup ZIP…');
  const b64 = await FileSystem.readAsStringAsync(backupPath, { encoding: FileSystem.EncodingType.Base64 });
  const zipData = new Uint8Array(Buffer.from(b64, 'base64'));

  progress('Parsing ZIP…');
  const entries = readZip(zipData);
  if (entries.length === 0) throw new Error('Backup is empty or corrupt.');

  const rootEntries = entries.filter(e => !e.path.includes('/'));
  const ugcEntries  = entries.filter(e => e.path.startsWith('Ugc/'));

  // Find/prepare Ugc folder URI
  let ugcFolderUri = null;
  if (ugcEntries.length > 0) {
    const topFiles = await readDirSaf(saveFolderUri);
    const ugcEntry = topFiles.find(u => getFilename(u).toLowerCase() === 'ugc');
    if (ugcEntry) ugcFolderUri = buildSafChildUri(saveFolderUri, getFilename(ugcEntry));
  }

  // Helper: write file via SAF (delete existing + recreate)
  const writeFileSaf = async (folderUri, filename, data) => {
    const existingFiles = await readDirSaf(folderUri);
    const existing = existingFiles.find(u => getFilename(u).toLowerCase() === filename.toLowerCase());
    if (existing) {
      try { await FileSystem.deleteAsync(existing, { idempotent: true }); } catch { }
    }
    const newUri = await StorageAccessFramework.createFileAsync(
      folderUri, filename, 'application/octet-stream'
    );
    await StorageAccessFramework.writeAsStringAsync(
      newUri,
      Buffer.from(data).toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );
  };

  // Restore root files
  for (const { path, data } of rootEntries) {
    progress(`Restoring ${path}…`);
    await writeFileSaf(saveFolderUri, path, data);
  }

  // Restore Ugc files
  if (ugcFolderUri) {
    for (const { path, data } of ugcEntries) {
      const filename = path.slice('Ugc/'.length);
      progress(`Restoring Ugc/${filename}…`);
      await writeFileSaf(ugcFolderUri, filename, data);
    }
  }

  progress('Done');
};

// ─── Public: Prune old backups ────────────────────────────────────────────────

/**
 * Delete oldest backups for a save folder until at most maxCount remain.
 */
export const pruneBackups = async (saveFolderUri, maxCount = MAX_BACKUPS) => {
  await ensureBackupDir();
  const slug = slugUri(saveFolderUri);
  let files;
  try {
    files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  } catch { return; }

  const zips = files
    .filter(f => f.endsWith('.zip') && f.includes(slug))
    .sort(); // lexicographic = chronological for ISO timestamps

  while (zips.length > maxCount) {
    const oldest = zips.shift();
    try { await FileSystem.deleteAsync(BACKUP_DIR + oldest, { idempotent: true }); } catch { }
  }
};

/**
 * Delete a single backup by its filename.
 */
export const deleteBackup = async (filename) => {
  try { await FileSystem.deleteAsync(BACKUP_DIR + filename, { idempotent: true }); } catch { }
};
