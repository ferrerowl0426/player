// 作业目标「稳定身份 / 当前显示 / 公开资格」的共享 SQL 片段。
//
// 目的（阶段一 B1）：把原先散落在 user-auth.routes.js、admin.routes.js、
// miniprogram.services.js 中各自手写的 video CASE、P 封面投影、存在性过滤统一到一处，
// 且与 content-object-access.js 的公开判定语义严格一致（有公开宿主即可见 / 旧独立视频可见）。
// 这里只生成参数化 SQL 片段与纯投影表达式，不连接数据库、不做鉴权放行：
// 真正的读权限仍由 content-object-access.js / assignment-navigation.js 在需要时执行。
//
// 约定：
// - 所有片段使用固定白名单别名，不拼接客户端输入；object id 一律走 $n 绑定。
// - P 的稳定 id 用 COALESCE(part_id, object_id)：兼容旧记录 part_id 为空但 object_id 确为 P 的情况。
// - 当前标题 / 序号 / 封面只从实时内容表取值；历史快照标题由调用方单独投影，绝不在此覆盖。
// - 资格判定下推到 SQL（EXISTS / CASE），不做「全表捞出后浏览器内存过滤」。

import { publicCoursePredicate } from './content-visibility.js';

// 可作为作业内容目标的类型白名单（message 是文案要求，不是内容目标）。
export const ASSIGNMENT_TARGET_TYPES = Object.freeze([
  'video',
  'track_point',
  'track_collection',
  'knowledge_point',
  'knowledge_collection',
  'track_part',
  'knowledge_part'
]);

export const ASSIGNMENT_TARGET_TYPE_SET = new Set(ASSIGNMENT_TARGET_TYPES);

export const ASSIGNMENT_TARGET_STATUS = Object.freeze({
  AVAILABLE: 'available',
  PRIVATE: 'private',
  MISSING: 'missing'
});

// 失效（private / missing）在首页统一展示的精确标题，不泄露原名称/封面/导航。
export const UNAVAILABLE_TITLE = '此资料已经被老师更改';

// 默认表别名。调用方如使用不同别名，传 alias 覆盖（admin 历史 activeVideos 用 pt/pkp）。
export const DEFAULT_TARGET_ALIASES = Object.freeze({
  ua: 'ua',
  v: 'v',
  t: 't',
  c: 'c',
  kp: 'kp',
  kpc: 'kpc',
  tp: 'tp',
  parentT: 'parent_t',
  kpp: 'kpp',
  parentKp: 'parent_kp',
  admins: 'a'
});

function withAliases(alias = {}) {
  return { ...DEFAULT_TARGET_ALIASES, ...alias };
}

// 作业目标类型表达式：兼容旧记录仅 video_id 有值的情况。
export function objectTypeExpr(alias = {}) {
  const a = withAliases(alias);
  return `COALESCE(${a.ua}.object_type, CASE WHEN ${a.ua}.video_id IS NOT NULL THEN 'video' ELSE 'message' END)`;
}

// P 稳定 id（规范化）：优先 part_id，旧记录回退 object_id（仅在确为 P 时由 JOIN 验证）。
export function resolvedPartIdExpr(alias = {}) {
  const a = withAliases(alias);
  return `COALESCE(${a.ua}.part_id, ${a.ua}.object_id)`;
}

// 批量 JOIN：一次性补齐当前标题/序号/封面/父 id 所需行，避免每行 N 次查询。
export function assignmentTargetJoins(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `LEFT JOIN videos ${a.v} ON ${a.v}.id = COALESCE(${a.ua}.object_id, ${a.ua}.video_id) AND ${type} = 'video'
       LEFT JOIN track_points ${a.t} ON ${a.t}.id = ${a.ua}.object_id AND ${type} = 'track_point'
       LEFT JOIN track_collections ${a.c} ON ${a.c}.id = ${a.ua}.object_id AND ${type} = 'track_collection'
       LEFT JOIN knowledge_points ${a.kp} ON ${a.kp}.id = ${a.ua}.object_id AND ${type} = 'knowledge_point'
       LEFT JOIN knowledge_collections ${a.kpc} ON ${a.kpc}.id = ${a.ua}.object_id AND ${type} = 'knowledge_collection'
       LEFT JOIN track_parts ${a.tp} ON ${a.tp}.id = ${resolvedPartIdExpr(a)} AND ${type} = 'track_part'
       LEFT JOIN track_points ${a.parentT} ON ${a.parentT}.id = ${a.tp}.track_id
       LEFT JOIN knowledge_parts ${a.kpp} ON ${a.kpp}.id = ${resolvedPartIdExpr(a)} AND ${type} = 'knowledge_part'
       LEFT JOIN knowledge_points ${a.parentKp} ON ${a.parentKp}.id = ${a.kpp}.knowledge_point_id
       LEFT JOIN admins ${a.admins} ON ${a.admins}.id = ${a.ua}.assigned_by_admin_id`;
}

// 目标内容是否存在（删除目标保留灰框，不再用此表达式过滤整行）。
// 与 content-object-access.js 的 canMaintainPrerequisite 一致：仅要求真实行存在。
export function assignmentTargetExistsExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  const partExists = (part, parent) => `${part}.id IS NOT NULL AND ${parent}.id IS NOT NULL`;
  return `CASE ${type}
    WHEN 'message' THEN TRUE
    WHEN 'video' THEN ${a.v}.id IS NOT NULL
    WHEN 'track_point' THEN ${a.t}.id IS NOT NULL
    WHEN 'knowledge_point' THEN ${a.kp}.id IS NOT NULL
    WHEN 'track_collection' THEN ${a.c}.id IS NOT NULL
    WHEN 'knowledge_collection' THEN ${a.kpc}.id IS NOT NULL
    WHEN 'track_part' THEN ${partExists(a.tp, a.parentT)}
    WHEN 'knowledge_part' THEN ${partExists(a.kpp, a.parentKp)}
    ELSE FALSE
  END`;
}

// 目标是否「公开可达」：严格复刻 canReadContentObject(client, type, id, GUEST_VIEWER)
// 的 SQL 谓词——视频「有任一公开宿主或无宿主即可见」，P「自身 public + 父课程 public」，
// 课程「课程 public + 至少一个 public P」，合集「含公开公开课程成员」。
// 注意：这里不因调用方是老师而放宽；不新增第四份口径。
export function assignmentTargetPublicExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  const partId = resolvedPartIdExpr(a);
  const objectId = `${a.ua}.object_id`;

  // 视频公开可达：存在任一公开宿主，或没有任何宿主（旧独立视频）。
  const videoPublic = `( ${a.v}.id IS NOT NULL AND (
        EXISTS (
          SELECT 1 FROM track_parts x JOIN track_points c ON c.id = x.track_id
           WHERE x.video_id = ${a.v}.id AND x.visibility = 'public' AND ${publicCoursePredicate('track_point')}
          UNION ALL
          SELECT 1 FROM knowledge_parts x JOIN knowledge_points c ON c.id = x.knowledge_point_id
           WHERE x.video_id = ${a.v}.id AND x.visibility = 'public' AND ${publicCoursePredicate('knowledge_point')}
        )
        OR NOT EXISTS (
          SELECT 1 FROM track_parts x WHERE x.video_id = ${a.v}.id
          UNION ALL SELECT 1 FROM knowledge_parts x WHERE x.video_id = ${a.v}.id
        )
      ) )`;

  const trackPointPublic = `EXISTS (SELECT 1 FROM track_points c WHERE c.id = ${objectId} AND ${publicCoursePredicate('track_point')})`;
  const knowledgePointPublic = `EXISTS (SELECT 1 FROM knowledge_points c WHERE c.id = ${objectId} AND ${publicCoursePredicate('knowledge_point')})`;
  const trackCollectionPublic = `EXISTS (SELECT 1 FROM track_collection_items ci JOIN track_points c ON c.id = ci.track_id WHERE ci.collection_id = ${objectId} AND ${publicCoursePredicate('track_point')} LIMIT 1)`;
  const knowledgeCollectionPublic = `EXISTS (SELECT 1 FROM knowledge_collection_items ci JOIN knowledge_points c ON c.id = ci.knowledge_point_id WHERE ci.collection_id = ${objectId} AND ${publicCoursePredicate('knowledge_point')} LIMIT 1)`;
  const trackPartPublic = `EXISTS (SELECT 1 FROM track_parts x JOIN track_points c ON c.id = x.track_id WHERE x.id = ${partId} AND x.visibility = 'public' AND ${publicCoursePredicate('track_point')})`;
  const knowledgePartPublic = `EXISTS (SELECT 1 FROM knowledge_parts x JOIN knowledge_points c ON c.id = x.knowledge_point_id WHERE x.id = ${partId} AND x.visibility = 'public' AND ${publicCoursePredicate('knowledge_point')})`;

  return `CASE ${type}
    WHEN 'message' THEN TRUE
    WHEN 'video' THEN ${videoPublic}
    WHEN 'track_point' THEN ${trackPointPublic}
    WHEN 'knowledge_point' THEN ${knowledgePointPublic}
    WHEN 'track_collection' THEN ${trackCollectionPublic}
    WHEN 'knowledge_collection' THEN ${knowledgeCollectionPublic}
    WHEN 'track_part' THEN ${trackPartPublic}
    WHEN 'knowledge_part' THEN ${knowledgePartPublic}
    ELSE FALSE
  END`;
}

// 目标状态：existing 优先（删除 -> missing），再判公开资格（私密 -> private）。
// message 视为 available（仅承载要求，不渲染资源卡）。
export function assignmentTargetStatusExpr(alias = {}) {
  const a = withAliases(alias);
  return `CASE
    WHEN NOT (${assignmentTargetExistsExpr(a)}) THEN '${ASSIGNMENT_TARGET_STATUS.MISSING}'
    WHEN NOT (${assignmentTargetPublicExpr(a)}) THEN '${ASSIGNMENT_TARGET_STATUS.PRIVATE}'
    ELSE '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}'
  END`;
}

// 当前私密判定（供保留 target_private 旧字段兼容）：等价于「非公开且非 message」。
export function assignmentTargetPrivateExpr(alias = {}) {
  return `NOT (${assignmentTargetPublicExpr(alias)})`;
}

// 布置时标题快照（历史专用，读取/改名/调序/隐私切换都不改这些列）。
export function assignmentSnapshotTitleExpr(alias = {}) {
  const a = withAliases(alias);
  return `COALESCE(NULLIF(${a.ua}.assigned_object_title, ''), NULLIF(${a.ua}.assigned_video_title, ''), '已删除内容')`;
}

// 当前标题：按类型 CASE 生成，P 使用当前父名 + 实时 part_no + 自定义标题。
export function assignmentCurrentTitleExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `CASE ${type}
    WHEN 'message' THEN COALESCE(NULLIF(${a.ua}.message, ''), '')
    WHEN 'video' THEN COALESCE(${a.v}.title, '')
    WHEN 'track_point' THEN COALESCE(${a.t}.name, '')
    WHEN 'track_collection' THEN COALESCE(${a.c}.name, '')
    WHEN 'knowledge_point' THEN COALESCE(${a.kp}.name, '')
    WHEN 'knowledge_collection' THEN COALESCE(${a.kpc}.name, '')
    WHEN 'track_part' THEN COALESCE(${a.parentT}.name, '') || ' P' || COALESCE(${a.tp}.part_no, 0) || ' ' || COALESCE(${a.tp}.title, '')
    WHEN 'knowledge_part' THEN COALESCE(${a.parentKp}.name, '') || ' P' || COALESCE(${a.kpp}.part_no, 0) || ' ' || COALESCE(${a.kpp}.title, '')
    ELSE ''
  END`;
}

// 当前封面：P 使用实时父课程封面（原管理端 activeVideos 投影漏父封面）。
export function assignmentCurrentCoverExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `CASE ${type}
    WHEN 'video' THEN COALESCE(${a.v}.cover_url, '')
    WHEN 'track_point' THEN COALESCE(${a.t}.cover, '')
    WHEN 'track_collection' THEN COALESCE(${a.c}.cover, '')
    WHEN 'knowledge_point' THEN COALESCE(${a.kp}.cover, '')
    WHEN 'knowledge_collection' THEN COALESCE(${a.kpc}.cover, '')
    WHEN 'track_part' THEN COALESCE(${a.parentT}.cover, '')
    WHEN 'knowledge_part' THEN COALESCE(${a.parentKp}.cover, '')
    ELSE ''
  END`;
}

// 当前 P 序号（非 P 为 null）。
export function assignmentPartNoExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `CASE
    WHEN ${type} = 'track_part' THEN ${a.tp}.part_no
    WHEN ${type} = 'knowledge_part' THEN ${a.kpp}.part_no
    ELSE NULL
  END`;
}

// 实时父课程 ID（非 P 为 null）。
export function assignmentParentIdExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `CASE
    WHEN ${type} = 'track_part' THEN ${a.parentT}.id
    WHEN ${type} = 'knowledge_part' THEN ${a.parentKp}.id
    ELSE NULL
  END`;
}

// 规范化目标 ID（非 P 为 COALESCE(object_id, video_id)，P 为稳定 part id）。
export function assignmentNormalizedObjectIdExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  return `CASE
    WHEN ${type} = 'track_part' OR ${type} = 'knowledge_part' THEN ${resolvedPartIdExpr(a)}
    ELSE COALESCE(${a.ua}.object_id, ${a.ua}.video_id)
  END`;
}

// Web 站内导航地址：仅可用时生成；P 用父课程 id + 稳定 part id。
export function assignmentNavigationUrlExpr(alias = {}) {
  const a = withAliases(alias);
  const type = objectTypeExpr(a);
  const oid = `COALESCE(${a.ua}.object_id, ${a.ua}.video_id)`;
  const partId = resolvedPartIdExpr(a);
  return `CASE ${type}
    WHEN 'video' THEN '/videos/' || ${oid}
    WHEN 'track_point' THEN '/tracks/' || ${oid}
    WHEN 'track_collection' THEN '/tracks/collections/' || ${oid}
    WHEN 'knowledge_point' THEN '/knowledge/' || ${oid}
    WHEN 'knowledge_collection' THEN '/knowledge/collections/' || ${oid}
    WHEN 'track_part' THEN '/tracks/' || ${a.parentT}.id || '?part=' || ${partId}
    WHEN 'knowledge_part' THEN '/knowledge/' || ${a.parentKp}.id || '?part=' || ${partId}
    ELSE NULL
  END`;
}

// 当前描述（仅 video 有 description；失效时由调用方置空，避免泄露私密内容信息）。
export function assignmentVideoDescriptionExpr(alias = {}) {
  const a = withAliases(alias);
  return `COALESCE(${a.v}.description, '')`;
}

// 批量投影：返回可供 SELECT 展开的片段数组，统一 today / latest 两处读取。
// status 表达式只计算一次（内联在每列），调用方也可用 assignmentTargetStatusExpr 单独取。
export function assignmentTargetProjection(alias = {}) {
  const a = withAliases(alias);
  const status = assignmentTargetStatusExpr(a);
  const unavailable = `'${UNAVAILABLE_TITLE}'`;
  return [
    `CASE WHEN ${status} = '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}' THEN ${assignmentCurrentTitleExpr(a)} ELSE ${unavailable} END AS title`,
    `CASE WHEN ${status} = '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}' THEN ${assignmentCurrentCoverExpr(a)} ELSE '' END AS cover_url`,
    `CASE WHEN ${status} = '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}' THEN ${assignmentNavigationUrlExpr(a)} ELSE NULL END AS navigation_url`,
    `CASE WHEN ${status} = '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}' THEN ${assignmentVideoDescriptionExpr(a)} ELSE '' END AS video_description`,
    `${status} AS target_status`,
    `CASE WHEN ${status} = '${ASSIGNMENT_TARGET_STATUS.AVAILABLE}' THEN FALSE ELSE TRUE END AS target_private`,
    `${assignmentNormalizedObjectIdExpr(a)} AS normalized_object_id`,
    `${assignmentParentIdExpr(a)} AS parent_id`,
    `${assignmentPartNoExpr(a)} AS part_no`
  ];
}
