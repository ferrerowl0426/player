// 生成测试用静态资源：网络封面 JPG、和弦图 PNG、示例 PDF、示例 MP3。
// 纯 Node 实现，零依赖；样例 MP4 已在 assets/ 下。
// 用法：node generate-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function makePatternPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)]);
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (size * 2);
      const line = (Math.floor(x / 18) + Math.floor(y / 18)) % 2 === 0 ? 1 : 0.86;
      row[1 + x * 3] = Math.round((r + (255 - r) * t * 0.35) * line);
      row[2 + x * 3] = Math.round((g + (255 - g) * t * 0.35) * line);
      row[3 + x * 3] = Math.round((b + (255 - b) * t * 0.35) * line);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function makeWavTone(seconds = 2, sampleRate = 8000, frequency = 440) {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 800, (samples - i) / 800);
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 24000 * envelope);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer;
}
function makePdf(lines) {
  const objects = [];
  const contentParts = [];
  let y = 770;
  for (const [index, line] of lines.entries()) {
    const size = index === 0 ? 22 : 13;
    const escaped = line.replace(/([()\\])/g, '\\$1');
    contentParts.push(`BT /F1 ${size} Tf 72 ${y} Td (${escaped}) Tj ET`);
    y -= index === 0 ? 40 : 26;
  }
  const stream = contentParts.join('\n');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[5] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  let pdf = Buffer.from('%PDF-1.4\n');
  const offsets = [0];
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = pdf.length;
    pdf = Buffer.concat([pdf, Buffer.from(`${i} 0 obj\n${objects[i]}\nendobj\n`)]);
  }
  const xrefOffset = pdf.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  return Buffer.concat([pdf, Buffer.from(xref), Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)]);
}

const coverSeeds = [
  ['cover-canon.jpg', 'classical-guitar-warm'], ['cover-sunny.jpg', 'acoustic-sunlight'],
  ['cover-jay.jpg', 'studio-guitar-blue'], ['cover-classics.jpg', 'wooden-guitar-room'],
  ['cover-kp-1645.jpg', 'chord-progression-paper'], ['cover-kp-hammer.jpg', 'guitar-hands-detail'],
  ['cover-kc-basics.jpg', 'music-theory-desk'], ['cover-library.jpg', 'library-guitar-books']
];
const pdfs = [
  ['canon-score.pdf', ['Canon in D - Fingerstyle Score (test)', 'Pachelbel Canon, arranged for solo guitar.', 'Seeded test document for the video player project.']],
  ['fingerstyle-basics.pdf', ['Fingerstyle Guitar Basics (test)', 'Chapter 1: posture and nails', 'Chapter 2: alternating bass', 'Seeded test document for the library module.']],
  ['chord-cheatsheet.pdf', ['Common Chord Cheatsheet (test)', 'C - G - Am - F progression', '1-6-4-5 progression (I-vi-IV-V)', 'Seeded test document for the library module.']]
];

fs.mkdirSync(path.join(ASSETS_DIR, 'covers'), { recursive: true });
fs.mkdirSync(path.join(ASSETS_DIR, 'docs'), { recursive: true });

let downloaded = 0;
for (const [name, seed] of coverSeeds) {
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/480/480`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(path.join(ASSETS_DIR, 'covers', name), Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
  } catch (error) {
    // 网络不可用时也保证测试包可生成：使用带棋盘纹理的图案封面，不使用纯色。
    fs.writeFileSync(path.join(ASSETS_DIR, 'covers', name), makePatternPng(480, [120, 84, 58]));
  }
}
fs.writeFileSync(path.join(ASSETS_DIR, 'covers', 'chord-chart.png'), makePatternPng(480, [200, 190, 170]));
for (const [name, lines] of pdfs) fs.writeFileSync(path.join(ASSETS_DIR, 'docs', name), makePdf(lines));
fs.writeFileSync(path.join(ASSETS_DIR, 'docs', 'metronome-demo.mp3'), makeWavTone(2, 8000, 660));

console.log('资源生成完成：');
console.log(`  covers/: ${coverSeeds.length} 张网络封面 JPG（480x480，下载成功 ${downloaded} 张）+ 1 张附件图`);
console.log(`  docs/: ${pdfs.length} 份示例 PDF + 1 份示例 MP3`);
