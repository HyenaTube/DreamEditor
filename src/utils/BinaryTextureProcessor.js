/**
 * BinaryTextureProcessor.js
 * Ported from LivingTheDreamToolkit (C#) to JavaScript.
 * Handles Zstd decompress/compress, block-linear swizzle, BC1/BC3 codec, sRGB conversion.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import * as fzstd from 'fzstd';
import { PNG } from 'pngjs/browser';
import { Skia, AlphaType, ColorType } from '@shopify/react-native-skia';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BLOCK_HEIGHT = 16;
const THUMB_BLOCK_HEIGHT = 8;

const TextureKind = { Canvas: 'Canvas', Ugctex: 'Ugctex', Thumb: 'Thumb' };
const TextureFormat = { Bc1: 'Bc1', Bc3: 'Bc3' };

// ─── sRGB LUTs ───────────────────────────────────────────────────────────────

const SRGB_TO_LINEAR = new Uint8Array(256);
const LINEAR_TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = Math.round(
    (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * 255
  );
  const lin = i / 255;
  LINEAR_TO_SRGB[i] = Math.round(
    Math.min(1, lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055) * 255
  );
}

const convertSrgbToLinear = (rgba) => {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i]   = SRGB_TO_LINEAR[rgba[i]];
    rgba[i+1] = SRGB_TO_LINEAR[rgba[i+1]];
    rgba[i+2] = SRGB_TO_LINEAR[rgba[i+2]];
  }
};
const convertLinearToSrgb = (rgba) => {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i]   = LINEAR_TO_SRGB[rgba[i]];
    rgba[i+1] = LINEAR_TO_SRGB[rgba[i+1]];
    rgba[i+2] = LINEAR_TO_SRGB[rgba[i+2]];
  }
};

// ─── Detection helpers ───────────────────────────────────────────────────────

const getFilename = (uri) => {
  const decoded = decodeURIComponent(uri);
  return decoded.split('/').pop() || '';
};

const detectKind = (uri) => {
  const lower = getFilename(uri).toLowerCase();
  if (lower.includes('thumb'))  return TextureKind.Thumb;
  if (lower.includes('ugctex')) return TextureKind.Ugctex;
  return TextureKind.Canvas;
};

const detectUgctexLayout = (decompressedBytes) => {
  switch (decompressedBytes) {
    case 131072: return { width: 512, height: 512, blockHeight: 16, format: TextureFormat.Bc1, bpe: 8 };
    case 98304:  return { width: 384, height: 384, blockHeight: 16, format: TextureFormat.Bc1, bpe: 8 };
    case 65536:  return { width: 256, height: 256, blockHeight: 8,  format: TextureFormat.Bc3, bpe: 16 };
    default:
      throw new Error(`Unknown ugctex size: ${decompressedBytes} bytes`);
  }
};

// ─── Zstd ────────────────────────────────────────────────────────────────────

const zstdDecompress = (compressedData) => fzstd.decompress(compressedData);

/**
 * Write a valid Zstd frame with raw (uncompressed) blocks.
 * Splits data into ≤128 KB blocks as required by the Zstd spec (libzstd enforces this limit).
 */
const zstdCompressRaw = (data) => {
  const MAX_BLOCK = 131072; // 128 KB — hard limit per Zstd spec (ZSTD_BLOCKSIZE_MAX)
  const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
  const contentSize = arr.length;
  const numBlocks = Math.max(1, Math.ceil(contentSize / MAX_BLOCK));

  // Total output: magic(4) + FHD(1) + FCS(8) + per-block [header(3) + content]
  let totalSize = 13;
  for (let i = 0; i < numBlocks; i++) {
    totalSize += 3 + Math.min(MAX_BLOCK, contentSize - i * MAX_BLOCK);
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xFD2FB528, true); // magic LE
  out[4] = 0xE0;                        // FHD: FCS_flag=11 (8-byte), SSF=1, no checksum, no dict
  view.setBigUint64(5, BigInt(contentSize), true);

  let pos = 13;
  for (let i = 0; i < numBlocks; i++) {
    const blockOff  = i * MAX_BLOCK;
    const blockSize = Math.min(MAX_BLOCK, contentSize - blockOff);
    const isLast    = i === numBlocks - 1 ? 1 : 0;
    // Block header 3-byte LE: bits[23:3]=blockSize, bits[2:1]=Type(00=Raw), bit[0]=Last
    const bh = (blockSize << 3) | isLast;
    out[pos]   = bh & 0xFF;
    out[pos+1] = (bh >> 8)  & 0xFF;
    out[pos+2] = (bh >> 16) & 0xFF;
    pos += 3;
    out.set(arr.subarray(blockOff, blockOff + blockSize), pos);
    pos += blockSize;
  }
  return out;
};

// ─── Block-linear swizzle ────────────────────────────────────────────────────

const divRoundUp = (n, d) => Math.floor((n + d - 1) / d);

const gobAddress = (x, y, widthInGobs, bpe, blockHeight) => {
  const xBytes = x * bpe;
  const base =
    Math.floor(y / (8 * blockHeight)) * 512 * blockHeight * widthInGobs +
    Math.floor(xBytes / 64) * 512 * blockHeight +
    Math.floor((y % (8 * blockHeight)) / 8) * 512;
  const xInGob = xBytes % 64;
  const yInGob = y % 8;
  return base
    + Math.floor(xInGob / 32) * 256
    + Math.floor(yInGob / 2) * 64
    + Math.floor((xInGob % 32) / 16) * 32
    + (yInGob % 2) * 16
    + (xInGob % 16);
};

const deswizzleBlockLinear = (data, width, height, bpe, blockHeight) => {
  const widthInGobs = divRoundUp(width * bpe, 64);
  const paddedHeight = divRoundUp(height, 8 * blockHeight) * (8 * blockHeight);
  const paddedSize = widthInGobs * paddedHeight * 64;
  const source = new Uint8Array(paddedSize);
  source.set(data.length <= paddedSize ? data : data.subarray(0, paddedSize));

  const output = new Uint8Array(width * height * bpe);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const swizzled = gobAddress(x, y, widthInGobs, bpe, blockHeight);
      const linear = (y * width + x) * bpe;
      output.set(source.subarray(swizzled, swizzled + bpe), linear);
    }
  }
  return output;
};

const swizzleBlockLinear = (data, width, height, bpe, blockHeight, baseBuffer = null) => {
  const widthInGobs = divRoundUp(width * bpe, 64);
  const paddedHeight = divRoundUp(height, 8 * blockHeight) * (8 * blockHeight);
  const paddedSize = widthInGobs * paddedHeight * 64;
  const output = new Uint8Array(paddedSize);
  if (baseBuffer && baseBuffer.length === paddedSize) output.set(baseBuffer);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const linear = (y * width + x) * bpe;
      const swizzled = gobAddress(x, y, widthInGobs, bpe, blockHeight);
      output.set(data.subarray(linear, linear + bpe), swizzled);
    }
  }
  return output;
};

// ─── RGB565 ──────────────────────────────────────────────────────────────────

const rgb565Decode = (c) => [
  Math.floor(((c >> 11) & 0x1f) * 255 / 31),
  Math.floor(((c >> 5)  & 0x3f) * 255 / 63),
  Math.floor((c & 0x1f) * 255 / 31),
];

const rgb565Encode = (r, g, b) => {
  const r5 = Math.floor((r * 31 + 127) / 255);
  const g6 = Math.floor((g * 63 + 127) / 255);
  const b5 = Math.floor((b * 31 + 127) / 255);
  return (r5 << 11) | (g6 << 5) | b5;
};

const colorDistSq = (r1, g1, b1, r2, g2, b2) => {
  const dr = r1-r2, dg = g1-g2, db = b1-b2;
  return dr*dr + dg*dg + db*db;
};

// ─── BC1 decode ──────────────────────────────────────────────────────────────

const bc1Decode = (blockData, texWidth, texHeight) => {
  const blocksX = texWidth / 4, blocksY = texHeight / 4;
  const output = new Uint8Array(texWidth * texHeight * 4);
  const palette = new Uint8Array(16);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const off = (by * blocksX + bx) * 8;
      const view = new DataView(blockData.buffer, blockData.byteOffset + off, 8);
      const c0 = view.getUint16(0, true), c1 = view.getUint16(2, true);
      const indices = view.getUint32(4, true);
      const [r0,g0,b0] = rgb565Decode(c0), [r1,g1,b1] = rgb565Decode(c1);

      palette.set([r0,g0,b0,255], 0); palette.set([r1,g1,b1,255], 4);
      if (c0 > c1) {
        palette.set([Math.floor((2*r0+r1)/3), Math.floor((2*g0+g1)/3), Math.floor((2*b0+b1)/3), 255], 8);
        palette.set([Math.floor((r0+2*r1)/3), Math.floor((g0+2*g1)/3), Math.floor((b0+2*b1)/3), 255], 12);
      } else {
        palette.set([Math.floor((r0+r1)/2), Math.floor((g0+g1)/2), Math.floor((b0+b1)/2), 255], 8);
        palette.set([0,0,0,0], 12);
      }
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const idx = (indices >> (2*(row*4+col))) & 3;
        const dst = ((by*4+row)*texWidth + bx*4+col) * 4;
        output.set(palette.subarray(idx*4, idx*4+4), dst);
      }
    }
  }
  return output;
};

// ─── BC1 encode ──────────────────────────────────────────────────────────────

const bc1EncodeBlock = (block, hasAlpha, output, outOff) => {
  let minR=255, minG=255, minB=255, maxR=0, maxG=0, maxB=0, opaqueCount=0;
  for (let i = 0; i < 16; i++) {
    const o = i*4;
    if (block[o+3] < 128) continue;
    opaqueCount++;
    if (block[o]   < minR) minR=block[o];   if (block[o]   > maxR) maxR=block[o];
    if (block[o+1] < minG) minG=block[o+1]; if (block[o+1] > maxG) maxG=block[o+1];
    if (block[o+2] < minB) minB=block[o+2]; if (block[o+2] > maxB) maxB=block[o+2];
  }
  if (opaqueCount === 0) {
    output.fill(0, outOff, outOff+4);
    output.fill(0xFF, outOff+4, outOff+8);
    return;
  }
  let c0 = rgb565Encode(maxR, maxG, maxB), c1 = rgb565Encode(minR, minG, minB);
  if (hasAlpha) { if (c0 > c1) { const t=c0; c0=c1; c1=t; } }
  else {
    if (c0 < c1) { const t=c0; c0=c1; c1=t; }
    if (c0 === c1) { if (c0 < 0xFFFF) c0++; else c1--; }
  }
  const [r0,g0,b0] = rgb565Decode(c0), [r1,g1,b1] = rgb565Decode(c1);
  const opaque = c0 > c1;
  const pr2 = opaque ? (2*r0+r1)/3|0 : (r0+r1)/2|0;
  const pg2 = opaque ? (2*g0+g1)/3|0 : (g0+g1)/2|0;
  const pb2 = opaque ? (2*b0+b1)/3|0 : (b0+b1)/2|0;
  const pr3 = opaque ? (r0+2*r1)/3|0 : 0;
  const pg3 = opaque ? (g0+2*g1)/3|0 : 0;
  const pb3 = opaque ? (b0+2*b1)/3|0 : 0;

  let indices = 0;
  for (let i = 0; i < 16; i++) {
    const o = i*4;
    const r=block[o], g=block[o+1], b=block[o+2], a=block[o+3];
    let best;
    if (a < 128 && !opaque) { best = 3; }
    else {
      const d0=colorDistSq(r,g,b,r0,g0,b0), d1=colorDistSq(r,g,b,r1,g1,b1), d2=colorDistSq(r,g,b,pr2,pg2,pb2);
      best = 0; let bd = d0;
      if (d1 < bd) { bd=d1; best=1; }
      if (d2 < bd) { bd=d2; best=2; }
      if (opaque) { const d3=colorDistSq(r,g,b,pr3,pg3,pb3); if (d3 < bd) best=3; }
    }
    indices |= (best << (2*i));
  }
  const view = new DataView(output.buffer, output.byteOffset + outOff, 8);
  view.setUint16(0, c0, true); view.setUint16(2, c1, true); view.setUint32(4, indices, true);
};

const bc1Encode = (rgba, texWidth, texHeight) => {
  const blocksX = texWidth/4, blocksY = texHeight/4;
  const output = new Uint8Array(blocksX * blocksY * 8);
  const block = new Uint8Array(64);
  for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
    let hasAlpha = false;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const src = ((by*4+row)*texWidth + bx*4+col) * 4;
      const dst = (row*4+col)*4;
      block.set(rgba.subarray(src, src+4), dst);
      if (rgba[src+3] < 128) hasAlpha = true;
    }
    bc1EncodeBlock(block, hasAlpha, output, (by*blocksX+bx)*8);
  }
  return output;
};

// ─── BC3 decode ──────────────────────────────────────────────────────────────

const bc3Decode = (blockData, texWidth, texHeight) => {
  const blocksX = texWidth/4, blocksY = texHeight/4;
  const output = new Uint8Array(texWidth * texHeight * 4);
  const alphas = new Uint8Array(8);

  for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
    const off = (by*blocksX+bx)*16;
    const view = new DataView(blockData.buffer, blockData.byteOffset + off, 16);
    const a0 = blockData[off], a1 = blockData[off+1];

    let alphaIdxBits = BigInt(0);
    for (let i = 0; i < 6; i++) alphaIdxBits |= BigInt(blockData[off+2+i]) << BigInt(8*i);

    alphas[0]=a0; alphas[1]=a1;
    if (a0 > a1) {
      for (let i=1; i<7; i++) alphas[i+1] = ((7-i)*a0 + i*a1)/7|0;
    } else {
      for (let i=1; i<5; i++) alphas[i+1] = ((5-i)*a0 + i*a1)/5|0;
      alphas[6]=0; alphas[7]=255;
    }

    const c0=view.getUint16(8,true), c1=view.getUint16(10,true);
    const colorIdx=view.getUint32(12,true);
    const [r0,g0,b0]=rgb565Decode(c0), [r1,g1,b1]=rgb565Decode(c1);
    const pal = [
      [r0,g0,b0],[r1,g1,b1],
      [(2*r0+r1)/3|0, (2*g0+g1)/3|0, (2*b0+b1)/3|0],
      [(r0+2*r1)/3|0, (g0+2*g1)/3|0, (b0+2*b1)/3|0],
    ];

    for (let row=0; row<4; row++) for (let col=0; col<4; col++) {
      const pi = row*4+col;
      const ci = (colorIdx >> (2*pi)) & 3;
      const ai = Number((alphaIdxBits >> BigInt(3*pi)) & BigInt(7));
      const dst = ((by*4+row)*texWidth + bx*4+col) * 4;
      output[dst]=pal[ci][0]; output[dst+1]=pal[ci][1]; output[dst+2]=pal[ci][2]; output[dst+3]=alphas[ai];
    }
  }
  return output;
};

// ─── BC3 encode ──────────────────────────────────────────────────────────────

const bc3EncodeBlock = (block, output, outOff) => {
  let minA=255, maxA=0;
  for (let i=0; i<16; i++) { const a=block[i*4+3]; if(a<minA) minA=a; if(a>maxA) maxA=a; }

  const a0 = maxA, a1 = minA;
  output[outOff]=a0; output[outOff+1]=a1;

  const ap = [a0,a1,0,0,0,0,0,0];
  if (a0 > a1) {
    ap[2]=(6*a0+1*a1)/7|0; ap[3]=(5*a0+2*a1)/7|0; ap[4]=(4*a0+3*a1)/7|0;
    ap[5]=(3*a0+4*a1)/7|0; ap[6]=(2*a0+5*a1)/7|0; ap[7]=(1*a0+6*a1)/7|0;
  } else {
    ap[2]=(4*a0+1*a1)/5|0; ap[3]=(3*a0+2*a1)/5|0;
    ap[4]=(2*a0+3*a1)/5|0; ap[5]=(1*a0+4*a1)/5|0; ap[6]=0; ap[7]=255;
  }

  let alphaIdxBits = BigInt(0);
  for (let i=0; i<16; i++) {
    const a=block[i*4+3];
    let best=0, bd=Math.abs(a-ap[0]);
    for (let p=1; p<8; p++) { const d=Math.abs(a-ap[p]); if(d<bd){bd=d;best=p;} }
    alphaIdxBits |= BigInt(best) << BigInt(3*i);
  }
  for (let i=0; i<6; i++) output[outOff+2+i] = Number((alphaIdxBits >> BigInt(8*i)) & BigInt(0xFF));

  let minR=255,minG=255,minB=255,maxR=0,maxG=0,maxB=0;
  for (let i=0; i<16; i++) {
    const o=i*4;
    if(block[o]<minR) minR=block[o]; if(block[o]>maxR) maxR=block[o];
    if(block[o+1]<minG) minG=block[o+1]; if(block[o+1]>maxG) maxG=block[o+1];
    if(block[o+2]<minB) minB=block[o+2]; if(block[o+2]>maxB) maxB=block[o+2];
  }
  let c0=rgb565Encode(maxR,maxG,maxB), c1=rgb565Encode(minR,minG,minB);
  if (c0 < c1) { const t=c0; c0=c1; c1=t; }
  if (c0 === c1) { if(c0<0xFFFF) c0++; else c1--; }

  const [r0,g0,b0]=rgb565Decode(c0),[r1,g1,b1]=rgb565Decode(c1);
  const pr2=(2*r0+r1)/3|0, pg2=(2*g0+g1)/3|0, pb2=(2*b0+b1)/3|0;
  const pr3=(r0+2*r1)/3|0, pg3=(g0+2*g1)/3|0, pb3=(b0+2*b1)/3|0;

  let colorIdx=0;
  for (let i=0; i<16; i++) {
    const o=i*4; const r=block[o],g=block[o+1],b=block[o+2];
    const d0=colorDistSq(r,g,b,r0,g0,b0),d1=colorDistSq(r,g,b,r1,g1,b1);
    const d2=colorDistSq(r,g,b,pr2,pg2,pb2),d3=colorDistSq(r,g,b,pr3,pg3,pb3);
    let best=0,bd=d0;
    if(d1<bd){bd=d1;best=1;} if(d2<bd){bd=d2;best=2;} if(d3<bd){best=3;}
    colorIdx |= (best << (2*i));
  }
  const view = new DataView(output.buffer, output.byteOffset+outOff+8, 8);
  view.setUint16(0,c0,true); view.setUint16(2,c1,true); view.setUint32(4,colorIdx,true);
};

const bc3Encode = (rgba, texWidth, texHeight) => {
  const blocksX=texWidth/4, blocksY=texHeight/4;
  const output = new Uint8Array(blocksX*blocksY*16);
  const block = new Uint8Array(64);
  for (let by=0; by<blocksY; by++) for (let bx=0; bx<blocksX; bx++) {
    for (let row=0; row<4; row++) for (let col=0; col<4; col++) {
      const src=((by*4+row)*texWidth+bx*4+col)*4, dst=(row*4+col)*4;
      block.set(rgba.subarray(src, src+4), dst);
    }
    bc3EncodeBlock(block, output, (by*blocksX+bx)*16);
  }
  return output;
};

// ─── PNG helpers ─────────────────────────────────────────────────────────────

const rgbaToPngBase64 = (rgba, width, height) => {
  try {
    const png = new PNG({ width, height });
    png.data = Buffer.from(rgba);
    const buf = PNG.sync.write(png);
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
  } catch { return null; }
};

/** Load an image URI into a Skia image object (does not resize). */
const loadSkiaImage = async (uri) => {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const skData = Skia.Data.fromBase64(b64);
  const skImage = Skia.Image.MakeImageFromEncoded(skData);
  if (!skImage) throw new Error('Failed to decode image: ' + uri);
  return skImage;
};

/** Resize a Skia image to dstW×dstH and return raw RGBA Uint8Array. */
const resizeSkiaToPixels = (skImage, dstW, dstH) => {
  const info = { colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul, width: dstW, height: dstH };
  let srcImage = skImage;
  if (skImage.width() !== dstW || skImage.height() !== dstH) {
    const surface = Skia.Surface.Make(dstW, dstH);
    if (!surface) throw new Error('Failed to create Skia surface');
    const canvas = surface.getCanvas();
    canvas.drawImageRect(
      skImage,
      { x: 0, y: 0, width: skImage.width(), height: skImage.height() },
      { x: 0, y: 0, width: dstW, height: dstH },
      Skia.Paint()
    );
    srcImage = surface.makeImageSnapshot();
  }
  const pixels = srcImage.readPixels(0, 0, info);
  if (!pixels) throw new Error('readPixels returned null');
  return pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer);
};

/** Load any image URI (gallery or file), resize to dstW×dstH, return RGBA Uint8Array. */
const loadAndResize = async (uri, dstW, dstH) => {
  const skImage = await loadSkiaImage(uri);
  return resizeSkiaToPixels(skImage, dstW, dstH);
};

// ─── SAF write helper ─────────────────────────────────────────────────────────

// Delete-then-recreate avoids Expo SAF issue #17423 where writeAsStringAsync
// on an existing URI does NOT truncate the file first, corrupting shorter writes.
const safWrite = async (existingUri, folderUri, filename, data) => {
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

// Build a SAF tree URI for a child folder by appending to the parent tree URI.
// Works for the standard external storage provider URI format.
const buildSafChildTreeUri = (parentTreeUri, childFolderName) => {
  const m = parentTreeUri.match(/^(content:\/\/[^/]+\/tree\/)(.+)$/);
  if (!m) return null;
  const decodedDoc = decodeURIComponent(m[2]);
  return m[1] + encodeURIComponent(decodedDoc + '/' + childFolderName);
};

// ─── Public: scan entries ─────────────────────────────────────────────────────

const readDirSaf = async (uri) => {
  if (uri.startsWith('content://')) {
    return StorageAccessFramework.readDirectoryAsync(uri);
  }
  const names = await FileSystem.readDirectoryAsync(uri);
  return names.map(n => `${uri}/${n}`);
};

/**
 * Scan a folder URI and group files into texture entries by stem.
 * Accepts either the Ugc folder directly OR its parent save folder.
 * When given the parent, auto-navigates into the Ugc subfolder and
 * records saveFolderUri so Player.sav can be located automatically.
 *
 * Returns [{stem, name, ugctexUri, canvasUri, thumbUri, folderUri, saveFolderUri}]
 */
export const scanTextureEntries = async (folderUri) => {
  let ugcFolderUri = folderUri;
  let saveFolderUri = null;

  const topFiles = await readDirSaf(folderUri);
  const hasTextures = topFiles.some(u => {
    const lower = getFilename(u).toLowerCase();
    return lower.endsWith('.ugctex.zs') && !lower.includes('thumb');
  });

  if (!hasTextures) {
    // Assume this is the parent save folder — find the Ugc subfolder
    saveFolderUri = folderUri;
    const ugcEntry = topFiles.find(u => getFilename(u).toLowerCase() === 'ugc');
    if (ugcEntry) {
      const childUri = buildSafChildTreeUri(folderUri, getFilename(ugcEntry));
      if (childUri) ugcFolderUri = childUri;
    }
  }

  const allFiles = await readDirSaf(ugcFolderUri);
  const byLowerStem = {};

  for (const uri of allFiles) {
    const filename = getFilename(uri);
    const lower = filename.toLowerCase();

    if (!lower.endsWith('.zs')) continue;
    if (lower.includes('.bak')) continue;

    // Detect secondary (-2) variants first so they don't fall through to primary checks
    const isThumb2  = lower.endsWith('_thumb.ugctex-2.zs');
    const isCanvas2 = lower.endsWith('.canvas-2.zs');
    const isUgctex2 = lower.endsWith('.ugctex-2.zs') && !isThumb2;

    const isThumb  = !isThumb2  && lower.includes('thumb') && lower.endsWith('.ugctex.zs');
    const isCanvas = !isCanvas2 && lower.endsWith('.canvas.zs');
    const isUgctex = !isUgctex2 && lower.endsWith('.ugctex.zs') && !isThumb;

    if (!isThumb && !isCanvas && !isUgctex && !isThumb2 && !isCanvas2 && !isUgctex2) continue;

    let stem;
    if (isThumb || isThumb2) {
      const idx = filename.toLowerCase().lastIndexOf('_thumb');
      stem = idx >= 0 ? filename.substring(0, idx) : filename;
    } else if (isCanvas)  { stem = filename.slice(0, -'.canvas.zs'.length); }
    else if (isCanvas2)   { stem = filename.slice(0, -'.canvas-2.zs'.length); }
    else if (isUgctex)    { stem = filename.slice(0, -'.ugctex.zs'.length); }
    else if (isUgctex2)   { stem = filename.slice(0, -'.ugctex-2.zs'.length); }

    const key = stem.toLowerCase();
    if (!byLowerStem[key]) byLowerStem[key] = { stem, folderUri: ugcFolderUri, saveFolderUri };

    if      (isUgctex)  byLowerStem[key].ugctexUri  = uri;
    else if (isThumb)   byLowerStem[key].thumbUri   = uri;
    else if (isCanvas)  byLowerStem[key].canvasUri  = uri;
    else if (isUgctex2) byLowerStem[key].ugctex2Uri = uri;
    else if (isThumb2)  byLowerStem[key].thumb2Uri  = uri;
    else if (isCanvas2) byLowerStem[key].canvas2Uri = uri;
  }

  return Object.values(byLowerStem)
    .filter(e => e.ugctexUri)
    .map(e => ({ ...e, name: e.stem }))
    .sort((a, b) => a.stem.localeCompare(b.stem));
};

// ─── Public: read texture (for display) ──────────────────────────────────────

export const readTextureFile = async (uri) => {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const compressed = new Uint8Array(Buffer.from(b64, 'base64'));
  const rawData = zstdDecompress(compressed);

  const kind = detectKind(uri);
  let rgba, width, height;

  if (kind === TextureKind.Canvas) {
    width = 256; height = 256;
    rgba = deswizzleBlockLinear(rawData, width, height, 4, DEFAULT_BLOCK_HEIGHT);
    convertLinearToSrgb(rgba);
  } else if (kind === TextureKind.Ugctex) {
    const layout = detectUgctexLayout(rawData.length);
    width = layout.width; height = layout.height;
    const blocks = deswizzleBlockLinear(rawData, width/4, height/4, layout.bpe, layout.blockHeight);
    rgba = layout.format === TextureFormat.Bc3
      ? bc3Decode(blocks, width, height)
      : bc1Decode(blocks, width, height);
    convertLinearToSrgb(rgba);
  } else { // Thumb
    const gridSide = Math.sqrt(rawData.length / 16)|0;
    width = gridSide * 4; height = gridSide * 4;
    const blocks = deswizzleBlockLinear(rawData, gridSide, gridSide, 16, THUMB_BLOCK_HEIGHT);
    rgba = bc3Decode(blocks, width, height);
    convertLinearToSrgb(rgba);
  }

  return {
    uri,
    name: getFilename(uri),
    pngBase64: rgbaToPngBase64(rgba, width, height),
    width,
    height,
  };
};

// ─── Public: replace texture ──────────────────────────────────────────────────

/**
 * Replace all files for a texture entry with new image content.
 * secondary=true writes the -2 variant files instead of the primary ones.
 */
export const replaceTextureImage = async (entry, newImageUri, onProgress, secondary = false) => {
  const progress = (msg) => onProgress?.(msg);
  const sfx = secondary ? '-2' : '';
  const existUgctex = secondary ? entry.ugctex2Uri : entry.ugctexUri;
  const existCanvas = secondary ? entry.canvas2Uri : entry.canvasUri;
  const existThumb  = secondary ? entry.thumb2Uri  : entry.thumbUri;

  progress('Reading original layout…');
  const origB64 = await FileSystem.readAsStringAsync(entry.ugctexUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const origCompressed = new Uint8Array(Buffer.from(origB64, 'base64'));
  const origRaw = zstdDecompress(origCompressed);
  const layout = detectUgctexLayout(origRaw.length);

  progress('Decoding replacement image…');
  const skImage = await loadSkiaImage(newImageUri);

  // ── Write .ugctex[-2].zs ─────────────────────────────────────────────────
  progress(`Encoding main texture (${layout.width}×${layout.height})…`);
  {
    const rgba = new Uint8Array(resizeSkiaToPixels(skImage, layout.width, layout.height));
    convertSrgbToLinear(rgba);
    const blocks = layout.format === TextureFormat.Bc3
      ? bc3Encode(rgba, layout.width, layout.height)
      : bc1Encode(rgba, layout.width, layout.height);
    // Use origRaw as base swizzle template only for primary (keeps padding bits intact)
    const swizzled = swizzleBlockLinear(
      blocks, layout.width/4, layout.height/4, layout.bpe, layout.blockHeight,
      secondary ? null : origRaw
    );
    const compressed = zstdCompressRaw(swizzled);
    progress('Writing main texture…');
    await safWrite(existUgctex, entry.folderUri, `${entry.stem}.ugctex${sfx}.zs`, compressed);
  }

  // ── Resize to 256×256 once ───────────────────────────────────────────────
  progress('Encoding canvas & thumbnail (256×256)…');
  const rgba256 = new Uint8Array(resizeSkiaToPixels(skImage, 256, 256));
  convertSrgbToLinear(rgba256);

  // ── Write .canvas[-2].zs ─────────────────────────────────────────────────
  {
    const swizzled = swizzleBlockLinear(rgba256, 256, 256, 4, DEFAULT_BLOCK_HEIGHT);
    const compressed = zstdCompressRaw(swizzled);
    progress('Writing canvas…');
    await safWrite(existCanvas, entry.folderUri, `${entry.stem}.canvas${sfx}.zs`, compressed);
  }

  // ── Write _Thumb.ugctex[-2].zs ────────────────────────────────────────────
  {
    const blocks = bc3Encode(rgba256, 256, 256);
    const swizzled = swizzleBlockLinear(blocks, 64, 64, 16, THUMB_BLOCK_HEIGHT);
    const compressed = zstdCompressRaw(swizzled);
    progress('Writing thumbnail…');
    await safWrite(existThumb, entry.folderUri, `${entry.stem}_Thumb.ugctex${sfx}.zs`, compressed);
  }

  progress('Done');
};

/**
 * Replace only the thumbnail (_Thumb.ugctex.zs) for an entry, leaving ugctex/canvas untouched.
 * Matches how LivingTheDreamToolkit exposes the thumb as a separately-editable file.
 */
export const replaceThumbOnly = async (entry, newImageUri, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  progress('Encoding thumbnail (256×256)…');
  const skImage = await loadSkiaImage(newImageUri);
  const rgba256 = new Uint8Array(resizeSkiaToPixels(skImage, 256, 256));
  convertSrgbToLinear(rgba256);
  const blocks = bc3Encode(rgba256, 256, 256);
  const swizzled = swizzleBlockLinear(blocks, 64, 64, 16, THUMB_BLOCK_HEIGHT);
  const compressed = zstdCompressRaw(swizzled);
  progress('Writing thumbnail…');
  await safWrite(entry.thumbUri, entry.folderUri, `${entry.stem}_Thumb.ugctex.zs`, compressed);
  progress('Done');
};

/**
 * Export the main ugctex of an entry as a PNG file in the same folder.
 * Returns the URI of the created PNG.
 */
export const exportTextureToPng = async (entry, onProgress) => {
  onProgress?.('Decoding texture…');
  const uri = entry.ugctexUri;
  const result = await readTextureFile(uri);
  if (!result.pngBase64) throw new Error('Failed to decode texture for export');

  const b64 = result.pngBase64.replace(/^data:image\/png;base64,/, '');
  const filename = `${entry.stem}_export.png`;
  onProgress?.('Writing PNG…');
  const destUri = await safWrite(null, entry.folderUri, filename, Buffer.from(b64, 'base64'));
  return destUri;
};

// ─── LTD / LTDF import ───────────────────────────────────────────────────────

const LTD_UGC_TYPES = ['Food', 'Clothing', 'Goods', 'Interior', 'Exterior', 'Objects', 'Landscaping'];
const LTD_EXTENSIONS = ['.ltdf', '.ltdc', '.ltdg', '.ltdi', '.ltde', '.ltdo', '.ltdl'];

const LTD_CANVAS = new Uint8Array([0xA3, 0xA3, 0xA3, 0xA3]);
const LTD_UGCTEX = new Uint8Array([0xA4, 0xA4, 0xA4, 0xA4]);
const LTD_THUMB  = new Uint8Array([0xA5, 0xA5, 0xA5, 0xA5]);
const LTD_NAME   = new Uint8Array([0xA2, 0xA2, 0xA2, 0xA2]);

const findMarker = (data, marker) => {
  outer: for (let i = 0; i <= data.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (data[i + j] !== marker[j]) continue outer;
    }
    return i;
  }
  return -1;
};

/**
 * Parse an LTD/LTDF/LTDC/… file (as Uint8Array).
 * Returns { typeName, itemName, canvasBytes, ugctexBytes, thumbBytes, previewPng }.
 * Throws if the file is missing required markers.
 */
export const parseLtdFile = (bytes) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const kind     = data[0];
  const typeName = LTD_UGC_TYPES[kind] ?? 'Unknown';

  const namePos   = findMarker(data, LTD_NAME);
  const canvasPos = findMarker(data, LTD_CANVAS);
  const ugctexPos = findMarker(data, LTD_UGCTEX);
  const thumbPos  = findMarker(data, LTD_THUMB);

  if (canvasPos === -1 || ugctexPos === -1 || thumbPos === -1) {
    throw new Error('Invalid LTD file: missing texture sections (A3/A4/A5 markers not found)');
  }

  // Decode item name (UTF-16 LE, up to first double-null)
  let itemName = '';
  if (namePos !== -1) {
    const raw = data.subarray(namePos + 4, namePos + 4 + 128);
    let end = raw.length;
    for (let i = 0; i < raw.length - 1; i += 2) {
      if (raw[i] === 0 && raw[i + 1] === 0) { end = i; break; }
    }
    try { itemName = new TextDecoder('utf-16le').decode(raw.subarray(0, end)); } catch { }
  }

  // Slice texture blobs — use .slice() (copy) not .subarray() (view) so Buffer.from works
  // correctly in Hermes regardless of byteOffset into the original ArrayBuffer.
  const canvasBytes = data.slice(canvasPos + 4, ugctexPos);
  const ugctexBytes = data.slice(ugctexPos + 4, thumbPos);
  const thumbBytes  = data.slice(thumbPos  + 4);

  // Verify each blob is valid Zstd (magic 0x28 0xB5 0x2F 0xFD)
  const checkZstd = (buf, label) => {
    if (buf.length < 4 || buf[0] !== 0x28 || buf[1] !== 0xB5 || buf[2] !== 0x2F || buf[3] !== 0xFD) {
      throw new Error(`LTD parse error: ${label} section does not start with Zstd magic (got ${Array.from(buf.slice(0,4)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}). File may be corrupted or marker positions are wrong.`);
    }
  };
  checkZstd(canvasBytes, 'canvas');
  checkZstd(ugctexBytes, 'ugctex');
  checkZstd(thumbBytes,  'thumb');

  // Decode thumbnail for preview
  let previewPng = null;
  try {
    const rawThumb = zstdDecompress(thumbBytes);
    const gridSide = Math.sqrt(rawThumb.length / 16) | 0;
    const w = gridSide * 4, h = gridSide * 4;
    const blocks = deswizzleBlockLinear(rawThumb, gridSide, gridSide, 16, THUMB_BLOCK_HEIGHT);
    const rgba   = bc3Decode(blocks, w, h);
    convertLinearToSrgb(rgba);
    previewPng = rgbaToPngBase64(rgba, w, h);
  } catch { }

  // nameSectionStart: byte index where name data begins (= namePos + 4, mirrors Python's nameStart)
  const nameSectionStart = namePos === -1 ? -1 : namePos + 4;

  return { typeName, itemName, canvasBytes, ugctexBytes, thumbBytes, previewPng, rawData: data, nameSectionStart };
};

/**
 * Write the three texture files from a parsed LTD result into an existing entry's slot.
 * Does not touch Player.sav — only replaces the visual textures.
 */
export const importLtdTextures = async (parsed, entry, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  progress('Writing canvas…');
  await safWrite(entry.canvasUri, entry.folderUri, `${entry.stem}.canvas.zs`, parsed.canvasBytes);
  progress('Writing main texture…');
  await safWrite(entry.ugctexUri, entry.folderUri, `${entry.stem}.ugctex.zs`, parsed.ugctexBytes);
  progress('Writing thumbnail…');
  await safWrite(entry.thumbUri, entry.folderUri, `${entry.stem}_Thumb.ugctex.zs`, parsed.thumbBytes);
  progress('Done');
};

// ─── Player.sav update tables (mirrors ShareUGC.py exactly) ──────────────────

// Attribute hashes per kind (order must match the Python ugcOffsets list)
const SAV_ATTR = [
  ['307FEEFA','6F93FFBD','5CA9336E','F768620A','5AF04BEB','2DB168C5','634800AE','DD8D6C5A','AF1186CF','58E6AAD3'], // Food (10)
  ['C81545FE','2FB9146D','7A31EF97','7EEC35E9','5E32FD3F','0DBABE27','71621C98','2D271339','CDF31EB5','2823DBD3'], // Clothing (10)
  ['3FAA2222','823F8297','7ECC8A60','88DC1D43','8896DDD6','BFF29472','5D965762','78D39208','53C762B0','40D2C6FE','C0A6C046','AE373B0D','7D5FFBB7','9E978F5E','F6349929','9038CDD0','9A59F58A'], // Goods (17)
  ['A9116402','835114C1','EC65E2E4','0A7CF2C5','662CD807','01B3661E','5AF4A09F','41FF2201'], // Interior (8)
  ['ED95CF0F','43F509BA','A7A0773C','A7A0773C','34BA6119','5E6E9F8C','2907C040','97865D6B','609F197D','47A50525','71EA7734'], // Exterior (11)
  ['274659D1','DCE826FC','E04E1E6B','056F2F20','BC7D7E30','3C2BC52F','CFFECCC2','5C15E339','5EFF5E0E','9838264B','48778DE6','62AD5137','D1B3B197'], // MapObject (13)
  ['21D582D9','DE7CB924','E8BD8C89','C35B8B0F','60E280FB','7EC3836A','F209E2F9','6D842ACC'], // MapFloor (8)
];

// Name hashes and per-section byte sizes per kind
const SAV_NAME = [
  { hashes: ['408494F5','BA0F4BAF'],                         sizes: [128,128]     }, // Food
  { hashes: ['40710642','CF9A13EA'],                         sizes: [128,128]     }, // Clothing
  { hashes: ['2F793EB1','F655B33A','F36A5A0B','A66367EB'],   sizes: [128,128,64,128] }, // Goods
  { hashes: ['3DE2C5DD','85A37B90'],                         sizes: [128,128]     }, // Interior
  { hashes: ['27C875D6','0E15E3F8'],                         sizes: [128,128]     }, // Exterior
  { hashes: ['56F99338','EE921AE2'],                         sizes: [128,128]     }, // MapObject
  { hashes: ['918875A9','503490E0'],                         sizes: [128,128]     }, // MapFloor
];

// Enable / texture-ref / hash-index offsets (one per kind)
const SAV_ENABLE = ['F4A39965','AF129C33','1A9C00FE','A39744E9','F4BEADC2','5951050B','A1126D32'];
const SAV_TEX    = ['3558B77F','59BFA9D3','70D10A48','E7F9D439','16227C50','A9C5CFB8','06A7A14C'];
const SAV_HASH   = ['6D48F8E2','89F25CAC','56202100','7FEF7F7D','38D72795','1B28B170','816D50A3'];
const SAV_HASH_IDX = [1, 3, 2, 6, 7, 4, 5];

// 28-byte table: 4 bytes per kind used to mark texture-ref as valid
const SAV_TEX_DATA = new Uint8Array([
  0x41,0x49,0x93,0x56, 0xE3,0xC2,0x2F,0xB4,
  0x41,0x49,0x93,0x56, 0xE3,0xC2,0x2F,0xB4,
  0xE3,0xC2,0x2F,0xB4, 0xE3,0xC2,0x2F,0xB4,
  0xE3,0xC2,0x2F,0xB4,
]);

// Optional vector data hashes (null = not used for that kind)
// vOffset: 12 bytes/slot written before name section in LTD
// v2Offset: 8 bytes/slot (also stored at vOffset base — mirrors Python behavior)
const SAV_VOFF  = [null, null, 'F36C4E28', null, '3C14025E', '27F2ECDE', null];
const SAV_V2OFF = [null, null, null,       null, 'B9D21B4F', '2F96203B', null];

// Stem prefix → kind (lowercased for matching)
const STEM_KIND = [
  ['ugcfood',      0],
  ['ugccloth',     1],
  ['ugcgoods',     2],
  ['ugcinterior',  3],
  ['ugcexterior',  4],
  ['ugcmapobject', 5],
  ['ugcmapfloor',  6],
];

/**
 * Determine UGC kind (0-6) and slot index from an entry stem like "UgcFood003".
 * Returns { kind, slot } or null if unrecognised.
 */
export const parseEntrySlot = (stem) => {
  const lower = stem.toLowerCase();
  for (const [prefix, kind] of STEM_KIND) {
    if (lower.startsWith(prefix)) {
      const slot = parseInt(lower.slice(prefix.length), 10);
      if (!isNaN(slot)) return { kind, slot };
    }
  }
  return null;
};

/**
 * Single-pass scan of Player.sav to find all needed field offsets.
 * hashHexList: flat array of hex strings (nulls ignored).
 * Returns { hashHex: resolvedOffset } — offset already includes the +4 skip.
 *
 * The game stores each field as: [4-byte LE magic] [4-byte LE array-base-offset] …
 * The magic matches the reversed bytes of hashHex interpreted as LE uint32 ==
 * parseInt(hashHex, 16). So a single LE uint32 scan finds them all in one pass.
 */
const buildSavOffsets = (data, hashHexList) => {
  const results = {};
  const targets = new Map();
  for (const h of hashHexList) {
    if (h) targets.set(parseInt(h, 16) >>> 0, h);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const stop = data.length - 7;
  for (let i = 0; i < stop; i++) {
    const val = view.getUint32(i, true);
    const h = targets.get(val);
    if (h !== undefined && results[h] === undefined) {
      results[h] = view.getUint32(i + 4, true) + 4; // +4 skips the array count header
    }
  }
  return results;
};

/**
 * Full LTD import: writes textures AND updates Player.sav (attributes, name, enable flags).
 * playerSavBytes: Uint8Array of the current Player.sav contents.
 * Returns the modified Player.sav as a new Uint8Array.
 */
export const importLtdWithSave = async (parsed, entry, playerSavBytes, onProgress) => {
  const progress = (msg) => onProgress?.(msg);

  const slotInfo = parseEntrySlot(entry.stem);
  if (!slotInfo) throw new Error(`Cannot determine item type from stem: "${entry.stem}"`);
  const { kind, slot } = slotInfo;

  if (parsed.rawData[0] !== kind) {
    throw new Error(
      `Type mismatch: slot "${entry.stem}" expects ${LTD_UGC_TYPES[kind]} but file contains ${LTD_UGC_TYPES[parsed.rawData[0]] ?? 'Unknown'}`
    );
  }

  // Write texture files first
  progress('Writing textures…');
  await importLtdTextures(parsed, entry, null);

  // Collect all hashes we need to find in Player.sav
  progress('Scanning save data…');
  const allHashes = [
    ...SAV_ATTR[kind],
    ...SAV_NAME[kind].hashes,
    SAV_ENABLE[kind], SAV_TEX[kind], SAV_HASH[kind],
    SAV_VOFF[kind], SAV_V2OFF[kind],
  ].filter(Boolean);

  const sav = new Uint8Array(playerSavBytes);
  const off = buildSavOffsets(sav, allHashes);
  const view = new DataView(sav.buffer, sav.byteOffset, sav.length);
  const raw = parsed.rawData;
  const nss = parsed.nameSectionStart; // name section start in LTD file

  progress('Writing attributes…');
  // Attributes: LTD bytes [4 + x*4 : +4] → sav[attrBase + slot*4 : +4]
  // Exception: the night-light field is a bit-per-slot array packed into bytes,
  // NOT a 4-byte-per-slot field. Writing slot*4 past the base would corrupt unrelated data.
  const attrHashes  = SAV_ATTR[kind];
  const nightIdx    = NIGHT_LIGHT_INDEX[kind];
  const nightBytesSz = NIGHT_LIGHT_BYTES[kind];
  for (let x = 0; x < attrHashes.length; x++) {
    const base = off[attrHashes[x]];
    if (base == null) continue;
    if (x === nightIdx) {
      // Mirrors Python: DecodeBits → set bit[slot] → EncodeBits
      const ltdBit = raw[4 + x * 4] & 1;
      const bits = decodeBits(sav.subarray(base, base + nightBytesSz));
      bits[slot] = ltdBit;
      sav.set(encodeBits(bits), base);
    } else {
      sav.set(raw.subarray(4 + x * 4, 8 + x * 4), base + slot * 4);
    }
  }

  progress('Writing name…');
  // Names: consecutive sections starting at nss in LTD file
  const { hashes: nHashes, sizes: nSizes } = SAV_NAME[kind];
  let ltdOff = nss;
  for (let n = 0; n < nHashes.length; n++) {
    const base = off[nHashes[n]];
    const sz   = nSizes[n];
    if (base != null) sav.set(raw.subarray(ltdOff, ltdOff + sz), base + slot * sz);
    ltdOff += sz;
  }

  // Vector data (only kinds with vOffset/v2Offset — Goods, Exterior, MapObject)
  const vHash  = SAV_VOFF[kind];
  const v2Hash = SAV_V2OFF[kind];
  if (vHash && off[vHash] != null && nss >= 24) {
    sav.set(raw.subarray(nss - 24, nss - 12), off[vHash] + slot * 12);
  }
  // Note: v2 is also written at vOffset base — mirrors Python behavior
  if (v2Hash && vHash && off[vHash] != null && nss >= 12) {
    sav.set(raw.subarray(nss - 12, nss - 4), off[vHash] + slot * 8);
  }

  progress('Enabling slot…');
  // Enable the slot and set texture / hash markers (safe to write even for existing slots)
  const eBase = off[SAV_ENABLE[kind]];
  if (eBase != null) sav.set(new Uint8Array([0xF4, 0xAD, 0x7F, 0x1D]), eBase + slot * 4);

  const tBase = off[SAV_TEX[kind]];
  if (tBase != null) sav.set(SAV_TEX_DATA.subarray(kind * 4, kind * 4 + 4), tBase + slot * 4);

  const hBase = off[SAV_HASH[kind]];
  if (hBase != null) sav.set(new Uint8Array([slot, 0, SAV_HASH_IDX[kind], 0]), hBase + slot * 4);

  progress('Done');
  return sav;
};

// ─── New-item creation ────────────────────────────────────────────────────────

const MAX_SLOTS   = [99, 299, 99, 99, 99, 99, 99]; // Food/Cloth/Goods/Interior/Exterior/MapObject/MapFloor
const UGC_PREFIXES = ['Food', 'Cloth', 'Goods', 'Interior', 'Exterior', 'MapObject', 'MapFloor'];

/**
 * Find the next free slot for a given UGC kind in the Ugc folder.
 * Returns { stem, slot } or null if all slots are full.
 */
export const findNextFreeSlot = async (ugcFolderUri, kind) => {
  const prefix = 'Ugc' + UGC_PREFIXES[kind];
  const max = MAX_SLOTS[kind];

  const files = await readDirSaf(ugcFolderUri);
  const occupied = new Set(
    files
      .map(u => getFilename(u))
      .filter(n => n.toLowerCase().endsWith('.canvas.zs') && !n.toLowerCase().endsWith('.canvas-2.zs'))
      .map(n => n.slice(0, -'.canvas.zs'.length).toLowerCase())
  );

  for (let slot = 0; slot < max; slot++) {
    const stem = prefix + String(slot).padStart(3, '0');
    if (!occupied.has(stem.toLowerCase())) return { stem, slot };
  }
  return null;
};

/**
 * Import an LTD file as a brand-new item in the next available slot.
 * ugcFolderUri: the Ugc subfolder where texture files live
 * saveFolderUri: parent folder for Player.sav (or null)
 * playerSavBytes: current Player.sav Uint8Array, or null for texture-only
 * Returns { stem, slot, modifiedSav } — modifiedSav is null when no Player.sav was given
 */
export const importNewItem = async (parsed, ugcFolderUri, saveFolderUri, playerSavBytes, onProgress) => {
  const progress = (msg) => onProgress?.(msg);
  const kind = parsed.rawData[0];

  progress('Finding next free slot…');
  const slotInfo = await findNextFreeSlot(ugcFolderUri, kind);
  if (!slotInfo) throw new Error(`All ${LTD_UGC_TYPES[kind]} slots are full (${MAX_SLOTS[kind]} max).`);

  const syntheticEntry = {
    stem: slotInfo.stem,
    folderUri: ugcFolderUri,
    saveFolderUri,
    ugctexUri: null,
    canvasUri: null,
    thumbUri: null,
  };

  if (playerSavBytes) {
    const modifiedSav = await importLtdWithSave(parsed, syntheticEntry, playerSavBytes, progress);
    return { stem: slotInfo.stem, slot: slotInfo.slot, modifiedSav };
  } else {
    await importLtdTextures(parsed, syntheticEntry, progress);
    return { stem: slotInfo.stem, slot: slotInfo.slot, modifiedSav: null };
  }
};

/**
 * Find the Player.sav document URI inside a save folder URI.
 * Returns the URI string or null if not found.
 */
export const findPlayerSavUri = async (saveFolderUri) => {
  if (!saveFolderUri) return null;
  try {
    const files = await readDirSaf(saveFolderUri);
    return files.find(u => getFilename(u).toLowerCase() === 'player.sav') ?? null;
  } catch {
    return null;
  }
};

/**
 * Write Player.sav back to its folder using delete+recreate to avoid SAF truncation bug.
 * existingUri: the current document URI (will be deleted), or null
 * saveFolderUri: parent folder URI where the new file is created
 * data: Uint8Array of the new file content
 */
export const savePlayerSav = async (existingUri, saveFolderUri, data) => {
  return safWrite(existingUri, saveFolderUri, 'Player.sav', data);
};

// ─── UGC export (mirrors ShareUGC.py Export mode) ────────────────────────────

// Index into SAV_ATTR[kind] where IsEmissionNightOnly is stored as a bit-per-slot array
const NIGHT_LIGHT_INDEX = [5, 6, 13, 4, 7, 9, 4];
// Number of bytes in the bit-array (ceil(maxSlots/8), rounded up)
const NIGHT_LIGHT_BYTES = [13, 38, 13, 13, 13, 13, 13];

// Bit codec (same as ShareUGC.py DecodeBits/EncodeBits)
const decodeBits = (data) => {
  const bits = [];
  for (let b = 0; b < data.length; b++) {
    const byte = data[b];
    for (let j = 0; j < 8; j++) bits.push((byte >> j) & 1);
  }
  return bits;
};

const encodeBits = (bits) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[Math.floor(i / 8)] |= (1 << (i % 8));
  }
  return out;
};

/**
 * Export a UGC item slot as an LTD binary (Uint8Array).
 * entry: the texture entry (provides stem, folderUri, ugctexUri, canvasUri, thumbUri)
 * playerSavBytes: Uint8Array of Player.sav contents
 * Returns Uint8Array of the LTD file.
 */
export const exportLtd = async (entry, playerSavBytes, onProgress) => {
  const progress = (msg) => onProgress?.(msg);

  const slotInfo = parseEntrySlot(entry.stem);
  if (!slotInfo) throw new Error(`Cannot determine item type from stem: "${entry.stem}"`);
  const { kind, slot } = slotInfo;

  progress('Scanning save data…');
  const sav = new Uint8Array(playerSavBytes);
  const allHashes = [
    ...SAV_ATTR[kind],
    ...SAV_NAME[kind].hashes,
    SAV_VOFF[kind], SAV_V2OFF[kind],
  ].filter(Boolean);

  const off = buildSavOffsets(sav, allHashes);
  const view = new DataView(sav.buffer, sav.byteOffset, sav.length);

  // ── Gather attribute bytes ──
  progress('Reading attributes…');
  const attrHashes = SAV_ATTR[kind];
  const nightIdx   = NIGHT_LIGHT_INDEX[kind];
  const nightBytes = NIGHT_LIGHT_BYTES[kind];
  const ugcData = new Uint8Array(attrHashes.length * 4);

  for (let x = 0; x < attrHashes.length; x++) {
    const base = off[attrHashes[x]];
    if (base == null) continue;

    if (x === nightIdx) {
      // Bit-per-slot field: read from array base, decode, pick slot's bit
      const bits = decodeBits(sav.subarray(base, base + nightBytes));
      ugcData[x * 4] = bits[slot] ?? 0;
      // bytes 1-3 remain 0
    } else {
      ugcData.set(sav.subarray(base + slot * 4, base + slot * 4 + 4), x * 4);
    }
  }

  // ── Gather name/pronounce bytes ──
  progress('Reading name data…');
  const { hashes: nHashes, sizes: nSizes } = SAV_NAME[kind];
  const nameParts = [];
  for (let n = 0; n < nHashes.length; n++) {
    const base = off[nHashes[n]];
    const sz   = nSizes[n];
    if (base != null) {
      nameParts.push(sav.slice(base + slot * sz, base + slot * sz + sz));
    } else {
      nameParts.push(new Uint8Array(sz));
    }
  }
  const nameBytes = nameParts[0];
  const pronounceBytes = new Uint8Array(nameParts.slice(1).reduce((s, a) => s + a.length, 0));
  { let p = 0; for (let i = 1; i < nameParts.length; i++) { pronounceBytes.set(nameParts[i], p); p += nameParts[i].length; } }

  // ── Gather vector data ──
  const vHash  = SAV_VOFF[kind];
  const v2Hash = SAV_V2OFF[kind];
  const vector  = vHash  && off[vHash]  != null ? sav.slice(off[vHash]  + slot * 12, off[vHash]  + slot * 12 + 12) : new Uint8Array(12);
  const vector2 = v2Hash && off[vHash]  != null ? sav.slice(off[vHash]  + slot * 8,  off[vHash]  + slot * 8  + 8)  : new Uint8Array(8);

  // ── Read texture files ──
  progress('Reading canvas texture…');
  const canvasB64 = await FileSystem.readAsStringAsync(entry.canvasUri, { encoding: FileSystem.EncodingType.Base64 });
  const canvasBytes = new Uint8Array(Buffer.from(canvasB64, 'base64'));

  progress('Reading main texture…');
  const ugctexB64 = await FileSystem.readAsStringAsync(entry.ugctexUri, { encoding: FileSystem.EncodingType.Base64 });
  const ugctexBytes = new Uint8Array(Buffer.from(ugctexB64, 'base64'));

  progress('Reading thumbnail…');
  const thumbB64 = await FileSystem.readAsStringAsync(entry.thumbUri, { encoding: FileSystem.EncodingType.Base64 });
  const thumbBytes = new Uint8Array(Buffer.from(thumbB64, 'base64'));

  // ── Decode item name (for return / filename suggestion) ──
  const decoder = new TextDecoder('utf-16le');
  let itemName = '';
  {
    let end = nameBytes.length;
    for (let i = 0; i < nameBytes.length - 1; i += 2) {
      if (nameBytes[i] === 0 && nameBytes[i+1] === 0) { end = i; break; }
    }
    try { itemName = decoder.decode(nameBytes.subarray(0, end)); } catch { }
  }

  // ── Assemble LTD binary (mirrors Python export) ──
  progress('Assembling LTD…');
  const LTD_HEADER   = new Uint8Array([kind, 0, 0, 0]);
  const NAME_MARKER  = new Uint8Array([0xA2, 0xA2, 0xA2, 0xA2]);
  const CANVAS_MARKER = new Uint8Array([0xA3, 0xA3, 0xA3, 0xA3]);
  const UGCTEX_MARKER = new Uint8Array([0xA4, 0xA4, 0xA4, 0xA4]);
  const THUMB_MARKER  = new Uint8Array([0xA5, 0xA5, 0xA5, 0xA5]);

  const parts = [
    LTD_HEADER, ugcData, vector, vector2,
    NAME_MARKER, nameBytes, pronounceBytes,
    CANVAS_MARKER, canvasBytes,
    UGCTEX_MARKER, ugctexBytes,
    THUMB_MARKER, thumbBytes,
  ];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const ltd = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { ltd.set(p, pos); pos += p.length; }

  const EXT_MAP = ['.ltdf', '.ltdc', '.ltdg', '.ltdi', '.ltde', '.ltdo', '.ltdl'];
  const ext = EXT_MAP[kind] ?? '.ltd';

  progress('Done');
  return { ltd, itemName, ext };
};
