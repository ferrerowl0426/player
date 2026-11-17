// 私密内容（公开/私密）已是常规业务功能，不再有部署模式门禁。
// 私密写入由角色/权限校验与对象存储边界负责访问控制；本模块只提供：
//   - 可见性取值的兼容性校验入口（assertPrivateWriteAllowed）：不再拦截 private。
//   - 派生可见性刷新（finalizeCourseVisibility）与 P 级前置引用查询（删除保护）。
// 旧的 CONTENT_PRIVACY_MODE 模式开关逻辑（off / business / local-preview / enforced）
// 已统一移除，见 finalizeCourseVisibility 注释。
import { PRIVATE, normalizeStoredVisibility, VisibilityError, refreshCourseVisibility, refreshCollectionsForCourse } from './content-visibility.js';

// 保留旧导出以避免无关调用方炸掉：仅作诊断/兼容用途，不再参与任何门禁。
export const CONTENT_PRIVACY_MODE = String(process.env.CONTENT_PRIVACY_MODE || 'business').toLowerCase();

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

const VALID_VISIBILITY = Object.freeze(new Set([PRIVATE, 'public']));

function assertLegalVisibility(value, label) {
  if (!VALID_VISIBILITY.has(value)) {
    throw new VisibilityError(`可见性取值非法：${label} 必须为 public 或 private`);
  }
}

// previous 允许 undefined / null / ''（等同 public，由调用方归一化）；其余必须为合法可见性。
function assertLegalPrevious(value, label) {
  if (value === undefined || value === null || value === '') return;
  if (!VALID_VISIBILITY.has(value)) {
    throw new VisibilityError(`可见性取值非法：${label} 必须为 public 或 private`);
  }
}

// 兼容入口：公开/私密已是常规业务，私密写入不再受部署模式门禁限制，也永不在本层阻止 private。
// 仅做可见性取值的合法性校验，确保 next 为合法可见性、previous 为合法可见性或缺失值。
// 非法的可见性值（如 'secret'、undefined 的 next）仍在此层拒绝，交由调用方统一错误映射处理。
// 调用方负责 BEGIN / ROLLBACK / COMMIT 与角色/权限校验。
export function assertPrivateWriteAllowed(nextVisibility, previousVisibility) {
  assertLegalVisibility(nextVisibility, 'nextVisibility');
  assertLegalPrevious(previousVisibility, 'previousVisibility');
}

// 父课程是否因本次改动“新变为”私密（之前不是 private，现在变成 private）。
export function courseBecamePrivate(nextVisibility, previousVisibility) {
  return (
    normalizeStoredVisibility(nextVisibility) === PRIVATE &&
    normalizeStoredVisibility(previousVisibility) !== PRIVATE
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

// 私密写入开关（assertPrivateWriteAllowed）与前置引用冲突（PREREQUISITE_CONFLICT）已取消：
// 公开/私密为常规业务，私密变更不再被模式门禁或前置引用阻断（前置维护/作业资格由各自
// helper 区分，见 content-object-access.js）。本函数仅刷新派生可见性并返回，
// 由调用方负责 BEGIN / ROLLBACK（出错时）/ COMMIT。previousVisibility 保留以兼容旧调用签名。
export async function finalizeCourseVisibility(client, type, courseId, previousVisibility) {
  const course = await refreshCourseVisibility(client, type, courseId);
  await refreshCollectionsForCourse(client, type, courseId);
  return course;
}

// 私密内容（公开/私密）已是常规业务功能，不再有部署模式开关。
// 固定返回 'business'：表示私密写入作为业务功能开放，访问控制由角色/权限校验负责。
export function validatePrivacyConfiguration() {
  return 'business';
}
