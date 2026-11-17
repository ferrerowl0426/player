// 作业展示与回填的纯逻辑，不依赖 React / DOM / fetch，便于 Node 内置 test 直接验证。
// 目标状态由后端 projected 的 target_status 决定；未知状态一律按不可用处理，
// 不降级到同名对象，也不从旧快照兜底封面或名称。

export const UNAVAILABLE_TITLE = '此资料已经被老师更改';

export const TARGET_STATUS = Object.freeze({
  AVAILABLE: 'available',
  PRIVATE: 'private',
  MISSING: 'missing'
});

const UNAVAILABLE_STATUSES = new Set([TARGET_STATUS.PRIVATE, TARGET_STATUS.MISSING]);

// 目标是否不可用。available 明确可用；private/missing 不可用；
// 旧数据没有 target_status 时退回 target_private；未知状态按不可用。
export function isTargetUnavailable(item) {
  if (!item || typeof item !== 'object') return true;
  const status = item.target_status;
  if (status === TARGET_STATUS.AVAILABLE) return false;
  if (UNAVAILABLE_STATUSES.has(status)) return true;
  if (status === undefined || status === null || status === '') {
    // 旧数据用 target_private；缺失该字段时按不可用保守处理，不猜测为可播放。
    return item.target_private !== false;
  }
  return true;
}

// 卡片标题：失效时强制精确文案，绝不回退旧快照/旧封面名。
export function assignmentDisplayTitle(item) {
  if (isTargetUnavailable(item)) return UNAVAILABLE_TITLE;
  return item?.title || '推荐内容';
}

// 卡片封面：失效时强制为空（浅灰默认框），不泄露原封面 URL。
export function assignmentDisplayCover(item) {
  if (isTargetUnavailable(item)) return '';
  return item?.cover_url || '';
}

// 是否允许点击复核入口。失效项没有 onClick / href，这里只作第二重防御。
export function isAssignmentClickable(item) {
  return !isTargetUnavailable(item);
}

// 点击复核结果里代表「内容不可达」的状态集合（含未知状态，统一静默处理）。
export function isNavigationUnavailable(status) {
  return status !== TARGET_STATUS.AVAILABLE;
}

function kindFromObjectType(objectType) {
  if (objectType === 'track_collection' || objectType === 'knowledge_collection') return 'collection';
  if (objectType === 'track_part' || objectType === 'knowledge_part') return 'part';
  return 'lesson';
}

// 稳定身份 key，与 admin/users/page.js 的 objectKey 保持一致：
// P 用真实 partId（稳定 P 主键），非 P 用 objectId，绝不用标题或 part_no。
export function stableObjectKey(item) {
  const objectType = item?.objectType ?? item?.object_type ?? '';
  const isPart = kindFromObjectType(objectType) === 'part' || String(objectType).endsWith('_part');
  if (isPart) {
    const id = item.partId ?? item.part_id ?? item.objectId ?? item.object_id ?? '';
    return `${objectType}:${id}:${id}`;
  }
  const id = item.objectId ?? item.object_id ?? '';
  return `${objectType}:${id}:0`;
}

function latestMeta(object, kind) {
  const partNo = object.partNo ?? object.part_no;
  if (kind === 'part') {
    return partNo != null && partNo !== '' ? `当前第 ${partNo} P` : '单 P';
  }
  if (kind === 'collection') {
    return object.objectType === 'knowledge_collection' ? '知识点集 · 回填' : '曲谱集 · 回填';
  }
  return object.objectType === 'knowledge_point' ? '单知识点 · 回填' : '单曲目 · 回填';
}

// 把 latest 接口返回的单个对象转成 selectedObjects 需要的形状。
// 直接使用后端当前标题/当前 P 序号，不查 contentOptions、不按标题匹配。
export function latestObjectToSelected(object) {
  if (!object || typeof object !== 'object') return null;
  const objectType = object.objectType ?? object.object_type;
  if (!objectType) return null;
  const kind = kindFromObjectType(objectType);
  return {
    kind,
    objectType,
    objectId: object.objectId ?? object.object_id,
    partId: object.partId ?? object.part_id ?? null,
    parentId: object.parentId ?? object.parent_id ?? null,
    title: object.title || '',
    meta: latestMeta(object, kind),
    coverUrl: object.coverUrl ?? object.cover_url ?? ''
  };
}

// 从 latest 的 objects 直接构造勾选项，按稳定 ID 去重；同名不同 ID 不误合并。
// 所有目标失效时返回 []，要求由调用方单独取 latestRequirements。
export function buildSelectionFromLatest(objects = [], max = 5) {
  const selected = [];
  const seen = new Set();
  for (const object of objects || []) {
    if (selected.length >= max) break;
    const item = latestObjectToSelected(object);
    if (!item || item.objectId == null) continue;
    const key = stableObjectKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
  }
  return selected;
}

// 目标全部失效（objects=[]）也必须保留最新批次要求，不回退旧批次。
export function latestRequirements(data = {}) {
  return {
    practiceRequirement: data.practiceRequirement ?? '',
    submitRequirement: data.submitRequirement ?? ''
  };
}

// 按稳定 ID 把回填项补入候选库：同 ID 用回填的当前名刷新，绝不让旧候选覆盖；
// 不同 ID 即使同名也各自保留。
export function mergeContentOptionsWithSelection(options = [], selected = []) {
  const byKey = new Map();
  for (const option of options || []) byKey.set(stableObjectKey(option), option);
  for (const item of selected || []) {
    const key = stableObjectKey(item);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        title: item.title,
        meta: item.meta || existing.meta,
        partId: item.partId ?? existing.partId,
        coverUrl: item.coverUrl ?? existing.coverUrl
      });
    } else {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

// 请求是否仍为当前有效结果：用于加载/回填的乱序与切学员保护。
// 版本不同或学员 ID 不一致时返回 false，调用方必须丢弃该响应。
export function isResponseCurrent({ requestVersion, currentVersion, requestedUserId, currentUserId } = {}) {
  if (requestVersion !== currentVersion) return false;
  if (requestedUserId != null && currentUserId != null && String(requestedUserId) !== String(currentUserId)) return false;
  return true;
}
