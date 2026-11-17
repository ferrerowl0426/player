// 单个作业点击导航的共享 helper。
// 同时为 Web（user-auth.routes.js）与小程序（miniprogram.routes.js）提供“作业目标导航状态”决策，
// 避免两端各写一套脱敏 / 可见性逻辑。
//
// 设计要点（来自安全与可见性需求）：
// 1. 归属 / 删除优先于可见性：作业不属于当前学生、或已 is_deleted、或目标内容已被删除，一律返回
//    MISSING，绝不返回 PRIVATE——防止通过状态差异越权探测“他人 / 已删私密目标”是否存在。
// 2. 作业归属 / 班级关系不扩展读权限：目标可见性一律按“公开可达”口径判定（canAssignContentObject
//    内部使用 GUEST_VIEWER 语义），私密目标绝不向学生放行，也不下发真实 URL / 封面 / 标题。
// 3. 参数化 SQL：所有查询均使用 $1 占位，绝不拼接作业 id / 课程 id 到 SQL 文本中。
// 4. 绝不用 assignment.id 充当课程 id：part 类型的导航地址里，课程段取“父课程 id”，part 段取
//    part_id；可见性 / 存在性查询也针对真实 part_id，而非作业主键。
// 5. 恢复可达：目标由私密恢复为公开后，因每次实时判定，自动恢复为 AVAILABLE。
// 6. 网络 / DB 错误与 PRIVATE 严格区分：路由层 try/catch 透传为 500，不伪装成 PRIVATE。

import { canAssignContentObject, canMaintainPrerequisite } from './content-object-access.js';

export const ASSIGNMENT_NAVIGATION_STATUS = Object.freeze({
  AVAILABLE: 'available',
  PRIVATE: 'private',
  MISSING: 'missing'
});

// 作业目标类型 -> 小程序目标 page（与 miniprogram.services.js assignmentTarget 完全一致）。
const OBJECT_PAGE = Object.freeze({
  track_collection: 'track-collection',
  track_point: 'track-detail',
  track_part: 'track-detail',
  knowledge_collection: 'knowledge-collection',
  knowledge_point: 'knowledge-detail',
  knowledge_part: 'knowledge-detail',
  video: 'video-detail'
});

// 纯函数：根据“已解析的作业归属”和“已解析的目标可见性”，推导单个作业点击导航状态。
// 不依赖数据库、不依赖请求对象，便于纯函数单测覆盖各类场景。
//   assignment: { userId, isDeleted, objectType }
//   target:     { exists, publicReadable, url, navigationTarget } | null
//   viewer:     { userId } | null   （调用方身份，用于归属校验；传 null 表示已在更上层处理）
export function resolveAssignmentNavigationStatus({ assignment, target, viewer } = {}) {
  // 不存在 / 已删除 / 非本人作业 -> 一律 missing（绝不可泄露为 private，避免越权探测）。
  if (!assignment) return { status: ASSIGNMENT_NAVIGATION_STATUS.MISSING, url: null, target: null };
  if (assignment.isDeleted) return { status: ASSIGNMENT_NAVIGATION_STATUS.MISSING, url: null, target: null };
  if (
    viewer &&
    assignment.userId != null &&
    viewer.userId != null &&
    Number(assignment.userId) !== Number(viewer.userId)
  ) {
    return { status: ASSIGNMENT_NAVIGATION_STATUS.MISSING, url: null, target: null };
  }

  const objectType = assignment.objectType || 'video';
  // message 类型无内容目标，永远可点击（仅展示消息），视为 available 但无 target。
  if (objectType === 'message') {
    return { status: ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE, url: null, target: null };
  }

  // 目标内容不存在（被删除等）-> missing，而非 private（不把 404 一律当私密）。
  if (!target || !target.exists) return { status: ASSIGNMENT_NAVIGATION_STATUS.MISSING };

  // 目标存在但对学生不可公开可见 -> private（脱敏，不下发真实 URL / target）。
  if (!target.publicReadable) {
    return { status: ASSIGNMENT_NAVIGATION_STATUS.PRIVATE, url: null, target: null };
  }

  // 公开可见 -> available，下发真实导航地址与目标。
  return {
    status: ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE,
    url: target.url || null,
    target: target.navigationTarget || null
  };
}

// 根据作业目标类型、真实对象 id、part id 与父课程 id，构造小程序目标对象。
// 注意：part 类型的“课程 id”取父课程（parentId），绝不用 assignment.id 充当课程 id。
export function buildAssignmentNavigationTarget(objectType, objectId, partId, parentId) {
  const type = objectType || 'video';
  let id = objectId != null ? String(objectId) : '';
  const pid = partId != null ? String(partId) : '';

  if (type === 'track_part' || type === 'knowledge_part') {
    // 课程段取父课程 id，part 段取 part id；assignment.id 绝不出现在这里。
    id = parentId != null ? String(parentId) : id;
  }

  return { type, id, partId: pid, page: OBJECT_PAGE[type] || 'video-detail' };
}

// 构造 Web 端可直接跳转的导航地址字符串；目标不可达时返回 null。
export function buildAssignmentNavigationUrl(objectType, objectId, partId, parentId) {
  const type = objectType || 'video';
  const oid = objectId != null ? String(objectId) : '';
  switch (type) {
    case 'video':
      return oid ? `/videos/${oid}` : null;
    case 'track_point':
      return oid ? `/tracks/${oid}` : null;
    case 'track_collection':
      return oid ? `/tracks/collections/${oid}` : null;
    case 'knowledge_point':
      return oid ? `/knowledge/${oid}` : null;
    case 'knowledge_collection':
      return oid ? `/knowledge/collections/${oid}` : null;
    case 'track_part':
    case 'knowledge_part': {
      const courseId = parentId != null ? String(parentId) : oid;
      const part = partId != null ? String(partId) : oid;
      if (!courseId) return null;
      const base = type === 'track_part' ? `/tracks/${courseId}` : `/knowledge/${courseId}`;
      return `${base}?part=${part}`;
    }
    default:
      return null;
  }
}

// 数据库支持的解析：加载单个作业（含 part 类型的父课程），并实时判定目标可见性。
// 返回 resolveAssignmentNavigationStatus 的结果；调用方只需把结果透传给两端即可。
// 入参 client 为 pg Pool 或 Client（兼容测试里注入的 fake pool）。
export async function loadAssignmentNavigation(client, assignmentId, viewer) {
  const numericId = Number(assignmentId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { status: ASSIGNMENT_NAVIGATION_STATUS.MISSING };
  }

  const result = await client.query(
    `SELECT ua.id,
            ua.user_id,
            ua.object_type,
            COALESCE(ua.object_id, ua.video_id) AS object_id,
            ua.video_id,
            ua.part_id,
            COALESCE(ua.part_id, ua.object_id) AS resolved_part_id,
            ua.is_deleted,
            parent_t.id AS parent_track_id,
            parent_kp.id AS parent_knowledge_id
       FROM user_assignments ua
       LEFT JOIN track_parts tp ON tp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'track_part'
       LEFT JOIN track_points parent_t ON parent_t.id = tp.track_id
       LEFT JOIN knowledge_parts kpp ON kpp.id = COALESCE(ua.part_id, ua.object_id) AND ua.object_type = 'knowledge_part'
       LEFT JOIN knowledge_points parent_kp ON parent_kp.id = kpp.knowledge_point_id
      WHERE ua.id = $1`,
    [numericId]
  );

  const row = result.rows[0];
  const assignment = row
    ? {
        userId: row.user_id,
        isDeleted: Boolean(row.is_deleted),
        objectType: row.object_type || (row.video_id ? 'video' : 'message')
      }
    : null;

  let target = null;
  if (row && assignment.objectType !== 'message') {
    // 统一 P 稳定 id：JOIN 用 COALESCE(part_id, object_id)，后续判定/URL 必须用同一个 resolvedPartId，
    // 否则旧记录 part_id 为空时 JOIN 到父课程但这里仍读 NULL，误判为 missing。
    const resolvedPartId = row.resolved_part_id != null
      ? row.resolved_part_id
      : (row.part_id != null ? row.part_id : row.object_id);
    let targetObjectId;
    let parentId = null;
    switch (assignment.objectType) {
      case 'video':
        targetObjectId = row.object_id;
        break;
      case 'track_part':
        targetObjectId = resolvedPartId;
        parentId = row.parent_track_id;
        break;
      case 'knowledge_part':
        targetObjectId = resolvedPartId;
        parentId = row.parent_knowledge_id;
        break;
      default:
        targetObjectId = row.object_id;
    }

    if (targetObjectId != null) {
      // 非 P 目标保持原有 partId 口径（空），只有 P 用规范化 resolvedPartId。
      const isPart = assignment.objectType === 'track_part' || assignment.objectType === 'knowledge_part';
      const navigationPartId = isPart ? resolvedPartId : row.part_id;
      // 复用真实判定：存在性用 canMaintainPrerequisite；公开可达用 canAssignContentObject
      // （GUEST_VIEWER 语义，作业归属 / 班级不扩展读权限）。
      const exists = await canMaintainPrerequisite(client, assignment.objectType, targetObjectId);
      const publicReadable = exists
        ? await canAssignContentObject(client, assignment.objectType, targetObjectId)
        : false;
      target = {
        exists,
        publicReadable,
        url: buildAssignmentNavigationUrl(assignment.objectType, targetObjectId, navigationPartId, parentId),
        navigationTarget: buildAssignmentNavigationTarget(assignment.objectType, targetObjectId, navigationPartId, parentId)
      };
    }
  }

  return resolveAssignmentNavigationStatus({ assignment, target, viewer });
}
