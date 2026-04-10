// Generates public/favicon.ico (32x32) and public/apple-touch-icon.png (180x180)
// from the same gold-C-on-dark design as public/favicon.svg.
// Pure Node — no external dependencies, uses built-in zlib for PNG encoding.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DARK = [10, 10, 10];    // #0a0a0a
const GOLD = [201, 168, 76];  // #c9a84c

// CRC32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Coverage (0..1) of the interior of a rounded-corner square at (px,py).
// size = full square side, cornerR = corner radius.
function bgCoverage(px, py, size, cornerR) {
  // If outside the bounding box, 0.
  if (px < 0 || py < 0 || px > size || py > size) return 0;
  // Check which corner region, if any.
  let cx = null, cy = null;
  if (px < cornerR && py < cornerR) { cx = cornerR; cy = cornerR; }
  else if (px > size - cornerR && py < cornerR) { cx = size - cornerR; cy = cornerR; }
  else if (px < cornerR && py > size - cornerR) { cx = cornerR; cy = size - cornerR; }
  else if (px > size - cornerR && py > size - cornerR) { cx = size - cornerR; cy = size - cornerR; }
  if (cx === null) return 1;
  const dx = px - cx, dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  // 1 inside (d <= cornerR), 0 outside. Smooth step over ~1px for AA.
  if (d <= cornerR - 0.5) return 1;
  if (d >= cornerR + 0.5) return 0;
  return (cornerR + 0.5 - d);
}

// Sample one point: returns [r,g,b,a] (0..255) for that position.
function sample(px, py, size, geom) {
  const cov = bgCoverage(px, py, size, geom.cornerR);
  if (cov <= 0) return [0, 0, 0, 0];

  // Determine if this point is in the C stroke.
  const dx = px - geom.cx;
  const dy = py - geom.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const mid = (geom.outerR + geom.innerR) / 2;
  const halfThickness = (geom.outerR - geom.innerR) / 2;

  let inC = false;
  if (Math.abs(dist - mid) <= halfThickness) {
    const angle = Math.atan2(dy, dx); // 0 = right, ±PI
    if (Math.abs(angle) > geom.openingHalf) {
      inC = true;
    } else {
      // End caps: rounded. Check distance to either end point of the arc.
      // Arc endpoints are at angle ±openingHalf on the mid-radius circle.
      const e1x = geom.cx + mid * Math.cos(geom.openingHalf);
      const e1y = geom.cy + mid * Math.sin(geom.openingHalf);
      const e2x = geom.cx + mid * Math.cos(-geom.openingHalf);
      const e2y = geom.cy + mid * Math.sin(-geom.openingHalf);
      const d1 = Math.hypot(px - e1x, py - e1y);
      const d2 = Math.hypot(px - e2x, py - e2y);
      if (d1 <= halfThickness || d2 <= halfThickness) inC = true;
    }
  }

  const rgb = inC ? GOLD : DARK;
  return [rgb[0], rgb[1], rgb[2], Math.round(cov * 255)];
}

function generatePng(size) {
  const geom = {
    cx: size / 2,
    cy: size / 2,
    outerR: size * 0.36,
    innerR: size * 0.22,
    cornerR: size * 0.17,
    openingHalf: Math.PI * 0.22, // ~40° each side → 80° opening
  };

  const N = 4; // 4x4 supersampling
  const bytesPerPixel = 4;
  const rowBytes = size * bytesPerPixel + 1;
  const raw = Buffer.alloc(rowBytes * size);

  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = x + (sx + 0.5) / N;
          const py = y + (sy + 0.5) / N;
          const [r, g, b, a] = sample(px, py, size, geom);
          // Premultiplied accumulation
          rSum += r * a;
          gSum += g * a;
          bSum += b * a;
          aSum += a;
        }
      }
      const total = N * N;
      const avgA = aSum / total;
      let finalR = 0, finalG = 0, finalB = 0;
      if (aSum > 0) {
        finalR = Math.round(rSum / aSum);
        finalG = Math.round(gSum / aSum);
        finalB = Math.round(bSum / aSum);
      }
      const off = y * rowBytes + 1 + x * 4;
      raw[off] = finalR;
      raw[off + 1] = finalG;
      raw[off + 2] = finalB;
      raw[off + 3] = Math.round(avgA);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Wraps a PNG inside an ICO container (PNG-in-ICO is valid for sizes ≥ 32).
function pngToIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // image size
  entry.writeUInt32LE(6 + 16, 12);          // data offset

  return Buffer.concat([header, entry, pngBuffer]);
}

const publicDir = path.join(__dirname, '..', 'public');

const png32 = generatePng(32);
const png180 = generatePng(180);

fs.writeFileSync(path.join(publicDir, 'favicon.ico'), pngToIco(png32, 32));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180);

console.log('Wrote public/favicon.ico (32x32)');
console.log('Wrote public/apple-touch-icon.png (180x180)');
