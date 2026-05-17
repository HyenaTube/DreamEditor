/**
 * SmartImport.js
 * Detect whether a picked .ltd file is a Mii or a UGC item,
 * then route to the appropriate import logic.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { parseLtdFile } from './BinaryTextureProcessor';

// UGC files have an A2 A2 A2 A2 name-section marker; Mii files don't.
const hasA2Marker = (bytes) => {
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0xA2 && bytes[i+1] === 0xA2 && bytes[i+2] === 0xA2 && bytes[i+3] === 0xA2) return true;
  }
  return false;
};

export const UGC_EXTENSIONS  = ['.ltd','.ltdf','.ltdc','.ltdg','.ltdi','.ltde','.ltdo','.ltdl'];
export const MII_EXTENSIONS  = ['.ltd'];
export const ALL_EXTENSIONS  = [...new Set([...UGC_EXTENSIONS])];

/**
 * Read raw bytes from a URI (content:// or file://).
 */
export const readBytes = async (uri) => {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    const resp = await fetch(uri);
    return new Uint8Array(Buffer.from(await resp.arrayBuffer()));
  }
};

/**
 * Inspect a picked file and return its type and parsed data.
 * Returns: { kind: 'ugc'|'mii'|'unknown', parsed?, bytes, filename }
 */
export const detectImport = async (asset) => {
  const name = (asset.name ?? '').toLowerCase();
  const bytes = await readBytes(asset.uri);

  // Non-.ltd UGC extensions are unambiguously UGC
  const nonLtdUgc = ['.ltdf','.ltdc','.ltdg','.ltdi','.ltde','.ltdo','.ltdl'];
  if (nonLtdUgc.some(e => name.endsWith(e))) {
    try {
      const parsed = parseLtdFile(bytes);
      return { kind: 'ugc', parsed, bytes, filename: asset.name };
    } catch (e) {
      return { kind: 'unknown', bytes, filename: asset.name, error: e.message };
    }
  }

  if (name.endsWith('.ltd')) {
    if (hasA2Marker(bytes)) {
      // Has A2 name section → UGC item
      try {
        const parsed = parseLtdFile(bytes);
        return { kind: 'ugc', parsed, bytes, filename: asset.name };
      } catch (e) {
        return { kind: 'unknown', bytes, filename: asset.name, error: e.message };
      }
    } else {
      // No A2 → Mii file
      return { kind: 'mii', bytes, filename: asset.name };
    }
  }

  return { kind: 'unknown', bytes, filename: asset.name, error: 'Unrecognised file type' };
};
