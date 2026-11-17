// 密码计划阶段二：纯逻辑（可见性判定、校验、文案、接口路径）。
// 本文件不含 DOM / fetch，可在 Node(vm) 中直接求值测试（见 tests/passwordResetLogic.test.js）。
// 组件与 api.js 可正常 import 此处导出；测试仅抽取下方 PURE-FOR-TEST 标记区块。

// ===== PURE-FOR-TEST-START =====
// 管理重置固定生成的目标密码（服务端固定哈希，前端仅展示与确认）。
export const FIXED_RESET_PASSWORD = 'Nxh123456';

// 唯一管理员判定：username=admin 且 role=super_admin。
export function isUniqueAdmin({ username, role } = {}) {
  return role === 'super_admin' && username === 'admin';
}

// 头像下拉是否显示「重置密码」（本人自助改密入口）。
// 仅有效账号（学生/老师/普通教导主任）显示；游客与唯一 admin 隐藏。
export function shouldShowSelfReset({ username, role } = {}) {
  if (!['user', 'teacher', 'super_admin'].includes(role)) return false;
  if (role === 'super_admin' && !username) return false;
  return !isUniqueAdmin({ username, role });
}

// 按角色构建本人改密接口路径（学员走 user，老师/管理员走 admin）。
export function buildChangePasswordPath(role) {
  return role === 'user' ? '/user/change-password' : '/admin/change-password';
}

// 本人改密表单校验：5-30 字符（不 trim）、新旧不同。
// 返回 { ok, error }；error 为中文提示（空字符串表示通过）。
export function validateSelfChangePassword({ oldPassword, newPassword } = {}) {
  const oldValue = oldPassword == null ? '' : String(oldPassword);
  const newValue = newPassword == null ? '' : String(newPassword);

  if (!oldValue) {
    return { ok: false, error: '请输入当前密码' };
  }
  if (newValue.length < 5 || newValue.length > 30) {
    return { ok: false, error: '新密码长度需在 5-30 个字符之间' };
  }
  if (oldValue === newValue) {
    return { ok: false, error: '新密码不能与当前密码相同' };
  }
  return { ok: true, error: '' };
}

// 管理重置（班级管理弹窗）是否显示重置入口。
// 仅对学生(user)目标显示；老师/管理员目标与本人隐藏。
export function shouldShowManageReset({ target, operator, type = 'user' } = {}) {
  if (!target || operator?.role !== 'super_admin') return false;
  if (type === 'user') return true;
  if (isUniqueAdmin(target) || String(target.id) === String(operator.id)) return false;
  return target.role === 'teacher' || (target.role === 'super_admin' && isUniqueAdmin(operator));
}

// 构造管理重置确认文案，展示目标身份与目标密码。
export function buildManageResetConfirm(accountName) {
  const who = accountName || '该学员';
  return `确定将该账号（${who}）密码重置为 ${FIXED_RESET_PASSWORD} 吗？`;
}
// ===== PURE-FOR-TEST-END =====
