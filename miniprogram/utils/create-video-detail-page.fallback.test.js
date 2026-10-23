/**
 * 独立验证脚本：CDN(playUrl) 失败自动同档 COS(videoUrl) 回退。
 * 不依赖小程序运行时，仅用最小桩驱动共享页面逻辑。
 * 运行：node miniprogram/utils/create-video-detail-page.fallback.test.js
 */
const path = require('path');
const assert = require('assert');

// ---- 最小桩：避免加载真实 services / wx ----
global.wx = {
  nextTick: (fn) => { if (typeof fn === 'function') fn(); },
  showToast() {},
  navigateBack() {},
  switchTab() {},
  pageScrollTo() {}
};
const authPath = require.resolve(path.join(__dirname, '../services/auth'));
const filesPath = require.resolve(path.join(__dirname, '../services/files'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireLogin: () => true } };
require.cache[filesPath] = { id: filesPath, filename: filesPath, loaded: true, exports: { openLibraryFile: async () => {} } };

const { createVideoDetailPage } = require('./create-video-detail-page');

// 构造页面上下文(this)：继承页面方法，自带 setData/视频组件桩。
function makeCtx(page) {
  const ctx = Object.create(page);
  ctx.data = JSON.parse(JSON.stringify(page.data));
  ctx._isUnloaded = false;
  ctx._isPageVisible = false;
  ctx._detailLoaded = false;
  ctx._detailLoading = false;
  ctx._resumeOnShow = false;
  ctx._videoSourceToken = 0;
  ctx._fallbackKeys = new Set();
  ctx.setData = function (patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb(); };
  ctx.getVideoPlayer = () => null; // 触发 ?. 安全短路
  return ctx;
}

// 当前 part 的 CDN / COS 地址（随默认清晰度变化，动态读取避免硬编码）。
const curCdn = (ctx) => ctx.data.detail.currentPart.playUrl;
const curCos = (ctx) => ctx.data.detail.currentPart.originVideoUrl;

const CDN = 'https://cdn.example.com/v.mp4';
const COS = 'https://cos.example.com/v.mp4';
const CDN_720 = 'https://cdn.example.com/v720.mp4';
const COS_720 = 'https://cos.example.com/v720.mp4';

function rawDetailWithCdn() {
  return {
    title: '课程',
    parts: [{
      id: 'p1',
      partNo: 1,
      videoUrl: COS,        // 原 COS 源
      playUrl: CDN,         // 新增 CDN 源
      durationText: '10:00',
      renditions: [
        { quality: 'source', videoUrl: COS, playUrl: CDN, status: 'ready' },
        { quality: '720p', videoUrl: COS_720, playUrl: CDN_720, status: 'ready' }
      ]
    }]
  };
}

function rawDetailLegacy() {
  return { title: '旧课程', parts: [{ id: 'p1', partNo: 1, videoUrl: COS, durationText: '10:00' }] };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const load = async (ctx, page) => {
  page.onLoad.call(ctx, { id: 'x', part: '' });
  await page.loadDetail.call(ctx);
};
// 构造与当前 videoMedia 匹配的错误事件（携带底层透出的 position/play）。
const errEv = (ctx, position = 0, play = true) => ({
  detail: { sourceId: ctx.data.videoMedia.id, sourceToken: ctx._videoSourceToken, position, play }
});

// ===== 1. 双源解析：优先 CDN，保留 COS 与 playUrl =====
(async () => {
  const page = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx = makeCtx(page);
  await check('loadDetail 解析双源', async () => {
    await load(ctx, page);
    const cp = ctx.data.detail.currentPart;
    // 默认清晰度取 720p（pickDefaultQuality 优先 720p），当前源即 720p 的 CDN。
    assert.strictEqual(cp.videoUrl, cp.playUrl, 'videoUrl 应优先等于 CDN(playUrl)');
    assert.notStrictEqual(cp.playUrl, '', 'playUrl 不应为空');
    assert.strictEqual(cp.originVideoUrl, COS_720, 'originVideoUrl 应为 720p 的 COS');
    assert.strictEqual(ctx.data.videoMedia.src, cp.playUrl, '初始媒体应走 CDN');
  });

  // ===== 2. 向后兼容：无 playUrl 的旧响应 =====
  const page2 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailLegacy() });
  const ctx2 = makeCtx(page2);
  await check('旧响应无 playUrl 兼容', async () => {
    await load(ctx2, page2);
    const cp = ctx2.data.detail.currentPart;
    assert.strictEqual(cp.videoUrl, COS, 'videoUrl 退回 COS');
    assert.strictEqual(cp.originVideoUrl, COS, 'originVideoUrl 为 COS');
    assert.strictEqual(cp.playUrl, '', 'playUrl 为空');
    assert.strictEqual(ctx2.data.videoMedia.src, COS, '初始媒体走 COS');
  });

  // ===== 3. CDN 失败 -> 同档回 COS（仅一次） =====
  const page3 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx3 = makeCtx(page3);
  await load(ctx3, page3);
  await check('CDN 错误回退到 COS', async () => {
    page3.handleVideoError.call(ctx3, errEv(ctx3, 12, true));
    assert.strictEqual(ctx3.data.videoMedia.src, curCos(ctx3), '应回退到同档 COS 源');
    assert.strictEqual(ctx3._fallbackKeys.size, 1, '应记录一次回退');
    assert.strictEqual(ctx3.data.videoErrorText, '', '错误文案应清空');
    assert.strictEqual(ctx3.data.videoWaiting, true, '应进入加载态');
  });
  await check('COS 再次错误不再回 CDN（仅回退一次）', async () => {
    // 强制把媒体指回 CDN 验证 key 已消费，不应再切 COS；无 quality 回滚 -> 显示错误文案。
    const cdn = curCdn(ctx3);
    ctx3.data.videoMedia = { ...ctx3.data.videoMedia, src: cdn, id: `p1:${ctx3.data.quality}:${cdn}` };
    page3.handleVideoError.call(ctx3, errEv(ctx3, 12, true));
    assert.strictEqual(ctx3.data.videoMedia.src, cdn, '已回源不应再切 COS');
    assert.ok(ctx3.data.videoErrorText, '应显示错误文案');
  });

  // ===== 4. 手动重试保留已回源状态（直连 COS） =====
  const page4 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx4 = makeCtx(page4);
  await load(ctx4, page4);
  page4.handleVideoError.call(ctx4, errEv(ctx4, 5, true));
  assert.strictEqual(ctx4.data.videoMedia.src, curCos(ctx4));
  await check('手动重试沿用 COS（不重新试 CDN）', async () => {
    page4.handleVideoRetry.call(ctx4, errEv(ctx4, 5, true));
    assert.strictEqual(ctx4.data.videoMedia.src, curCos(ctx4), '重试应直接用 COS');
  });

  // ===== 5. 切档保留已回源状态，且新档独立尝试 CDN =====
  const page5 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx5 = makeCtx(page5);
  await load(ctx5, page5);
  page5.handleVideoError.call(ctx5, errEv(ctx5, 3, true)); // 默认 720p 回 COS
  assert.strictEqual(ctx5.data.videoMedia.src, COS_720);
  await check('切到 source 档时该档仍走 CDN（独立）', async () => {
    page5.selectQualityByValue.call(ctx5, 'source', 3, true);
    assert.strictEqual(ctx5.data.videoMedia.src, CDN, '新档应使用各自 CDN');
    assert.strictEqual(ctx5._fallbackKeys.size, 1, '回退状态仅含 720p 档');
  });
  await check('切回 720p 直接沿用 COS（保留回源）', async () => {
    page5.selectQualityByValue.call(ctx5, '720p', 3, true);
    assert.strictEqual(ctx5.data.videoMedia.src, COS_720, '已回源的档不再试 CDN');
  });

  // ===== 6. 过期 sourceToken 事件被忽略 =====
  const page6 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx6 = makeCtx(page6);
  await load(ctx6, page6);
  await check('过期 token 错误事件被忽略', async () => {
    const before = ctx6.data.videoMedia.src;
    page6.handleVideoError.call(ctx6, { detail: { sourceId: ctx6.data.videoMedia.id, sourceToken: ctx6._videoSourceToken + 99, position: 0, play: false } });
    assert.strictEqual(ctx6.data.videoMedia.src, before, '过期事件不应改变媒体');
    assert.strictEqual(ctx6._fallbackKeys.size, 0, '过期事件不应记录回退');
  });

  // ===== 7. 切档失败：CDN->COS->qualityRollback 链路 =====
  const page7 = createVideoDetailPage({ loadDetailRequest: async () => rawDetailWithCdn() });
  const ctx7 = makeCtx(page7);
  await load(ctx7, page7); // 默认 720p
  page7.selectQualityByValue.call(ctx7, 'source', 2, true); // 先切到 source（CDN），记录回滚到 720p
  assert.strictEqual(ctx7.data.videoMedia.src, CDN);
  page7.selectQualityByValue.call(ctx7, '720p', 2, true);   // 再切回 720p（CDN），记录回滚到 source
  assert.strictEqual(ctx7.data.videoMedia.src, CDN_720);
  await check('切档 CDN 失败先回 COS 同档', async () => {
    page7.handleVideoError.call(ctx7, errEv(ctx7, 2, true));
    assert.strictEqual(ctx7.data.videoMedia.src, COS_720, '应回退到 720p 的 COS');
  });
  await check('同档 COS 也失败则回滚到原 quality', async () => {
    page7.handleVideoError.call(ctx7, errEv(ctx7, 2, true)); // 此时已是 COS，无 CDN 可回 -> quality 回滚
    assert.strictEqual(ctx7.data.quality, 'source', '应回滚到原清晰度');
    assert.strictEqual(ctx7.data.videoMedia.src, CDN, '回滚后源为 source 的 CDN');
  });

  console.log(`\n全部通过：${passed} 项`);
})().catch((err) => {
  console.error('\n测试失败：', err && err.message);
  process.exit(1);
});
