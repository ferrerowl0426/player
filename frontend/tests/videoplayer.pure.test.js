// 独立 node:test —— 不依赖任何测试框架/React 渲染。
// 通过读取 VideoPlayer.js 中标记区块里的纯函数源码并在 vm 中求值，
// 直接测试"CDN 回源 COS"相关纯逻辑（与组件渲染解耦）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '..', 'components', 'VideoPlayer.js');
const source = fs.readFileSync(FILE, 'utf8');

const match = source.match(
  /\/\/ ===== PURE-FOR-TEST-START =====\n([\s\S]*?)\n\/\/ ===== PURE-FOR-TEST-END =====/
);
assert.ok(match, '未找到 PURE-FOR-TEST 标记区块');

// 去掉 export 关键字后，在隔离上下文中求值纯函数。
const code = match[1].replace(/export\s+/g, '');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const { getReadySources, getDefaultQuality, formatTime, decideFallbackError, pickActiveSource } = ctx;

// 构造一个典型源（CDN=play_url，COS=video_url）
function makeSource(quality, cdn, cos) {
  return { quality, label: quality === 'source' ? '原画' : quality.toUpperCase(), src: cdn, originSrc: cos };
}

// ---------------------------------------------------------------------------
// getReadySources：video_url 保持 COS、play_url 走 CDN、旧接口兼容
// ---------------------------------------------------------------------------
test('getReadySources 优先使用 play_url(CDN) 且保留 video_url(COS) 为 originSrc', () => {
  const renditions = [
    { quality: '1080p', status: 'ready', play_url: 'https://cdn/1080.m3u8', video_url: 'https://cos/1080.mp4' },
    { quality: 'source', status: 'ready', play_url: 'https://cdn/src.m3u8', video_url: 'https://cos/src.mp4' },
  ];
  const out = getReadySources('https://cos/fallback.mp4', renditions, 'https://cdn/fallback.m3u8');
  const q1080 = out.find((i) => i.quality === '1080p');
  assert.equal(q1080.src, 'https://cdn/1080.m3u8');
  assert.equal(q1080.originSrc, 'https://cos/1080.mp4');
  const src = out.find((i) => i.quality === 'source');
  assert.equal(src.src, 'https://cdn/src.m3u8');
  assert.equal(src.originSrc, 'https://cos/src.mp4');
});

test('getReadySources 旧接口兼容：无 renditions 时用 playSrc(CDN)+src(COS)', () => {
  const out = getReadySources('https://cos/video.mp4', [], 'https://cdn/video.m3u8');
  assert.equal(out.length, 1);
  assert.equal(out[0].quality, 'source');
  assert.equal(out[0].src, 'https://cdn/video.m3u8'); // CDN 优先
  assert.equal(out[0].originSrc, 'https://cos/video.mp4'); // COS 作为源站
});

test('getReadySources 旧接口兼容：仅 src 时回源记录等于自身（无 CDN 可回）', () => {
  const out = getReadySources('https://cos/video.mp4', [], undefined);
  assert.equal(out[0].src, 'https://cos/video.mp4');
  assert.equal(out[0].originSrc, 'https://cos/video.mp4');
});

test('getReadySources 过滤未 ready 或缺失 video_url 的 rendition', () => {
  const renditions = [
    { quality: '1080p', status: 'pending', play_url: 'https://cdn/1080.m3u8', video_url: 'https://cos/1080.mp4' },
    { quality: '720p', status: 'ready' }, // 无 video_url
    { quality: '480p', status: 'ready', play_url: 'https://cdn/480.m3u8', video_url: 'https://cos/480.mp4' },
  ];
  const out = getReadySources('https://cos/video.mp4', renditions, 'https://cdn/video.m3u8');
  assert.deepEqual(out.map((i) => i.quality).sort(), ['480p', 'source']);
});

// ---------------------------------------------------------------------------
// getDefaultQuality / formatTime
// ---------------------------------------------------------------------------
test('getDefaultQuality 优先 1080p，否则 source，否则首个', () => {
  assert.equal(getDefaultQuality([makeSource('source', 'c', 'o'), makeSource('720p', 'c', 'o')]), 'source');
  assert.equal(getDefaultQuality([makeSource('1080p', 'c', 'o'), makeSource('source', 'c', 'o')]), '1080p');
  assert.equal(getDefaultQuality([]), '');
});

test('formatTime 格式化', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(65), '1:05');
});

// ---------------------------------------------------------------------------
// decideFallbackError：同档回 COS 一次 + 竞态丢弃
// ---------------------------------------------------------------------------
function selSrc(cdn, cos) {
  return { quality: '1080p', label: '1080P', src: cdn, originSrc: cos };
}

test('decideFallbackError: 无 video.error -> ignore', () => {
  const r = decideFallbackError({ selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: new Set(), videoError: null, currentSrc: 'cdn', assignedSrc: 'cdn' });
  assert.equal(r.type, 'ignore');
});

test('decideFallbackError: 同档回 COS 一次（CDN 失败且 COS 可用 -> fallback）', () => {
  const r = decideFallbackError({ selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: new Set(), videoError: {}, currentSrc: 'cdn', assignedSrc: 'cdn' });
  assert.equal(r.type, 'fallback');
});

test('decideFallbackError: 已回源(已在 COS)再失败 -> final（不会二次回源）', () => {
  const set = new Set(['k']);
  const r = decideFallbackError({ selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: set, videoError: {}, currentSrc: 'cos', assignedSrc: 'cos' });
  assert.equal(r.type, 'final');
});

test('decideFallbackError: 单源(cdn===cos)失败 -> final（无第二源可回）', () => {
  const r = decideFallbackError({ selectedSource: selSrc('only', 'only'), sourceKey: 'k', fallbackSet: new Set(), videoError: {}, currentSrc: 'only', assignedSrc: 'only' });
  assert.equal(r.type, 'final');
});

test('decideFallbackError: 竞态——currentSrc 与已分配 src 不一致 -> ignore（丢弃旧源延迟错误）', () => {
  // 已切到 COS(assignedSrc=cos)，但收到一个 currentSrc 仍为旧 CDN 的延迟错误
  const r = decideFallbackError({ selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: new Set(), videoError: {}, currentSrc: 'cdn', assignedSrc: 'cos' });
  assert.equal(r.type, 'ignore');
});

test('decideFallbackError: 竞态——assignedSrc 未设置时不应误丢真实错误', () => {
  const r = decideFallbackError({ selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: new Set(), videoError: {}, currentSrc: 'cdn', assignedSrc: null });
  assert.equal(r.type, 'fallback');
});

// ---------------------------------------------------------------------------
// pickActiveSource：切清晰度保留回源记录
// ---------------------------------------------------------------------------
test('pickActiveSource: 未回源用 CDN(src)，已回源用 COS(originSrc)', () => {
  const s = selSrc('cdn', 'cos');
  assert.equal(pickActiveSource(s, 'k', new Set(), 'fallback'), 'cdn');
  assert.equal(pickActiveSource(s, 'k', new Set(['k']), 'fallback'), 'cos');
});

test('pickActiveSource: 无 selectedSource 时回退到 fallbackSrc', () => {
  assert.equal(pickActiveSource(null, 'k', new Set(), 'https://cos/x.mp4'), 'https://cos/x.mp4');
});

// ---------------------------------------------------------------------------
// 组合：同档回 COS 一次（状态机串联）
// ---------------------------------------------------------------------------
test('串联：同一 sourceKey 只回源一次', () => {
  const set = new Set();
  const args = { selectedSource: selSrc('cdn', 'cos'), sourceKey: 'k', fallbackSet: set, videoError: {}, currentSrc: 'cdn', assignedSrc: 'cdn' };
  assert.equal(decideFallbackError(args).type, 'fallback'); // 第一次 -> 回源
  set.add('k'); // 模拟组件把 key 加入 fallbackRef
  assert.equal(decideFallbackError({ ...args, assignedSrc: 'cos', currentSrc: 'cos' }).type, 'final'); // 第二次 -> 终态
});
