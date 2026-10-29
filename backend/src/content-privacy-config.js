// 私密内容开关的共享配置（由另一代理实现，这里集中维护）。
// 读 process.env.CONTENT_PRIVACY_MODE，默认 off（私密写入不放行）。
import { PRIVATE, normalizeStoredVisibility, refreshCourseVisibility } from './content-visibility.js';

// 部署模式：
//   off          : 任何“新的私密写入”都被拒绝（默认，私密功能当前不可上线）。
//   local-preview: 仅非生产环境允许私密写入，用于本地联调。
//   enforced     : 强制模式（暂禁，目前仍按未开放处理）。
const RESOLVED_MODE = String(process.env.CONTENT_PRIVACY_MODE || 'off').toLowerCase();

export const CONTENT_PRIVACY_MODE = RESOLVED_MODE;

export class PrivateWriteDisabledError extends Error {
  constructor(message = '私密内容功能暂未开放') {
    super(message);
    this.name = 'PrivateWriteDisabledError';
    this.code = 'PRIVATE_WRITE_DISABLED';
    this.status = 403;
  }
}

export class PrerequisiteConflictError extends Error {
  constructor(message = '该课程存在前置引用关系，无法转为私密，请先移除相关前置项') {
    super(message);
    this.name = 'PrerequisiteConflictError';
    this.code = 'PREREQUISITE_CONFLICT';
    this.status = 409;
  }
}

const normalizeVisibility = normalizeStoredVisibility;

export function validatePrivacyConfiguration(env = process.env) {
  const mode = env.CONTENT_PRIVACY_MODE || 'off';
  if (!['off', 'local-preview', 'enforced'].includes(mode)) throw new Error('Invalid CONTENT_PRIVACY_MODE');
  if (mode === 'local-preview' && env.NODE_ENV === 'production') throw new Error('local-preview is forbidden in production');
  if (mode === 'enforced') throw new Error('enforced requires cloud authorization acceptance and is not available yet');
  return mode;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// 保护“新的私密写入”。
//   nextVisibility     : 即将落库的值（public / private）。
//   previousVisibility : 改动前已存储的值（新行可为 undefined / null）。
// 规则：
//   - 非 private：始终放行。
//   - 已经是 private（含编辑时遗漏 visibility 而保留的旧 private）：不算新的私密写入，放行，不被重置。
//   - 新的 private 写入：按部署模式决定是否放行。
export function assertPrivateWriteAllowed(nextVisibility, previousVisibility) {
  if (nextVisibility !== PRIVATE) return;
  if (normalizeVisibility(previousVisibility) === PRIVATE) return;
  if (RESOLVED_MODE === 'off') throw new PrivateWriteDisabledError();
  if (RESOLVED_MODE === 'local-preview') {
    if (isProduction()) throw new PrivateWriteDisabledError('私密内容功能仅本地预览环境开放');
    return;
  }
  if (RESOLVED_MODE === 'enforced') {
    // enforced 暂禁：暂按未开放处理。
    throw new PrivateWriteDisabledError('私密内容功能暂未开放');
  }
  throw new PrivateWriteDisabledError();
}

// 父课程是否因本次改动“新变为”私密（之前不是 private，现在变成 private）。
export function courseBecamePrivate(nextVisibility, previousVisibility) {
  return (
    normalizeVisibility(nextVisibility) === PRIVATE &&
    normalizeVisibility(previousVisibility) !== PRIVATE
  );
}

// 查实际 prerequisites 表：是否存在以该课程为前置项（被其它内容依赖）的引用。
// 不假设表结构，直接查询真实关系表。
export async function hasPrerequisiteReferences(client, courseType, courseId) {
  const result = await client.query(
    `SELECT 1 FROM prerequisites WHERE prerequisite_type = $1 AND prerequisite_id = $2 LIMIT 1`,
    [courseType, courseId]
  );
  return result.rowCount > 0;
}

// 查是否任一私密/不可作前置的 P 正被 prerequisites 引用（P 级前置冲突）。
// 用于 P 改私密或删除前：被引用的 P 一旦失公开，前置关系即失效，须阻止。
//   type     : 'track_point' | 'knowledge_point'
//   parentId : 父课程 id；P 级冲突限定在该课程下的 P。
// 返回被引用 P 的类型与 id 列表（空数组表示无冲突）。
export async function findPrivatePartPrerequisiteConflicts(client, type, partId) {
  const partType = type === 'track_point' ? 'track_part' : 'knowledge_part';
  const result = await client.query(
    `SELECT prerequisite_type, prerequisite_id
     FROM prerequisites
     WHERE prerequisite_type = $1 AND prerequisite_id = $2
     LIMIT 50`,
    [partType, partId]
  );
  return result.rows;
}

// 在父课程锁内、P 保存之后调用：刷新派生可见性，并对“新变私密”做两道保护：
//   1) 私密写入开关（assertPrivateWriteAllowed）；2) 现有前置引用冲突（409 回滚）。
// 调用方负责 BEGIN / ROLLBACK（出错时）/ COMMIT。
export async function finalizeCourseVisibility(client, type, courseId, previousVisibility) {
  const refreshed = await refreshCourseVisibility(client, type, courseId);
  if (!courseBecamePrivate(refreshed.visibility, previousVisibility)) return refreshed;
  assertPrivateWriteAllowed(PRIVATE, previousVisibility);
  if (await hasPrerequisiteReferences(client, type, courseId)) {
    throw new PrerequisiteConflictError();
  }
  return refreshed;
}
