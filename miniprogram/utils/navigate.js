// 失效（private / missing）在首页统一展示的精确标题，复用后端 UNAVAILABLE_TITLE 口径。
const UNAVAILABLE_TITLE = '此资料已经被老师更改';

function buildUrl(path, params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

// 列表项当前是否不可打开：优先看后端 target_status，兼容旧 target_private。
function isAssignmentUnavailable(item = {}) {
  const target = item.target || {};
  const status = String(item.targetStatus || item.target_status || target.status || '').toLowerCase();
  if (status) return status !== 'available';
  return Boolean(item.targetPrivate || item.target_private);
}

// 可用项一律按作业 id 走后端复核；private/missing 静默返回并回调页面更新灰框，
// 不弹 Toast、不跳旧 target。普通网络错误与鉴权错误仍按原样提示。
// options.onUnavailable(assignment, state) 在状态失效时回调，供页面原位更新。
// options.isCurrent() 在 await 复核完成后、错误提示/导航前判断页面是否仍活跃且为当前请求，
// 返回 false 一律静默丢弃，防止隐藏/刷新后旧导航跳转。
async function navigateByAssignment(assignment = {}, options = {}) {
  const { onUnavailable, isCurrent } = options;
  const isStale = () => typeof isCurrent === 'function' && !isCurrent();
  const reportUnavailable = (state) => {
    if (typeof onUnavailable === 'function') onUnavailable(assignment, state || { status: 'private' });
  };

  // 没有 id 无法按作业复核：一律静默按 missing 失效返回，绝不回退旧 target 旁路导航。
  if (!assignment.id) {
    reportUnavailable({ status: 'missing' });
    return;
  }

  let state;
  try {
    const { request } = require('../services/request');
    state = await request({ url: `/homework/${encodeURIComponent(assignment.id)}/navigation` });
  } catch (error) {
    // 隐藏/刷新后的过期错误也不再提示。
    if (isStale()) return;
    wx.showToast({ title: error.userMessage || error.message || '网络连接失败，请稍后重试', icon: 'none', duration: 1600 });
    return;
  }
  // await 完成后立即判断：过期响应静默丢弃，不提示、不导航、不回写。
  if (isStale()) return;

  // 只认复核结果：private/missing 一律静默失效，绝不回退旧 target。
  if (!state || state.status !== 'available' || !state.target) {
    reportUnavailable(state);
    return;
  }
  // 用复核下发的目标覆盖整项，旧 target 不再参与后续拼接。
  const target = state.target;
  assignment = { ...assignment, target, targetStatus: 'available', targetPrivate: false, target_status: 'available' };

  const objectType = assignment.objectType || assignment.object_type || assignment.type || target.type || '';
  const objectId = target.id || assignment.objectId || assignment.object_id || '';
  // 复核下发的 target.partId 优先于旧 assignment.partId。
  const partId = target.partId || target.part_id || assignment.partId || assignment.part_id || '';

  const routeMap = {
    track_collection: '/pages/track-collection/index',
    track_point: '/pages/track-detail/index',
    track_part: '/pages/track-detail/index',
    knowledge_collection: '/pages/knowledge-collection/index',
    knowledge_point: '/pages/knowledge-detail/index',
    knowledge_part: '/pages/knowledge-detail/index'
  };

  const path = routeMap[objectType];

  if (!path || !objectId) {
    reportUnavailable({ status: 'missing' });
    return;
  }

  wx.navigateTo({
    url: buildUrl(path, {
      id: objectId,
      part: objectType.endsWith('_part') ? partId || objectId : ''
    })
  });
}

module.exports = {
  UNAVAILABLE_TITLE,
  buildUrl,
  isAssignmentUnavailable,
  navigateByAssignment
};
