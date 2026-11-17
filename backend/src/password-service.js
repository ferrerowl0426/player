// 共享密码服务：本人改密（原子 hash + 版本递增）与管理员固定密码重置。
// 所有写 password_hash 的入口都收口到这里，确保：改密/重置都递增 auth_version
// 使旧 token 立即失效；root（username='admin' && role='super_admin'）永禁改密/被重置；
// 通过 SELECT ... FOR UPDATE + 条件 UPDATE 防止并发覆盖过期旧密码。
import bcrypt from 'bcryptjs';

export const PASSWORD_MIN_LENGTH = 5;
export const PASSWORD_MAX_LENGTH = 30;
// 管理端替他人重置固定密码（不信任客户端传入的 password）。
export const FIXED_RESET_PASSWORD = 'Nxh123456';
export const ROOT_USERNAME = 'admin';

export function isRootAdmin(row) {
  return Boolean(row) && row.username === ROOT_USERNAME && row.role === 'super_admin';
}

// 校验新密码长度。密码不 trim：长度按原始字符串计，避免“看起来够长实则被截断”的歧义。
export function validatePasswordLength(password) {
  if (password === undefined || password === null || typeof password !== 'string') {
    return '请填写新密码';
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `密码长度必须是 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 个字符`;
  }
  return '';
}

// 本人改密：校验旧密码 → 原子更新 password_hash 并递增 auth_version。
// 返回 { ok: true } 或 { status, code, message }。
export async function changeOwnPassword({ pool, table, id, oldPassword, newPassword }) {
  const lengthError = validatePasswordLength(newPassword);
  if (lengthError) {
    return { status: 400, code: 'INVALID_PASSWORD', message: lengthError };
  }

  if (typeof oldPassword !== 'string') {
    return { status: 400, code: 'OLD_PASSWORD_INCORRECT', message: '旧密码错误' };
  }

  // 新旧密码必须不同（按原始字符串比较，不 trim）。
  if (newPassword === oldPassword) {
    return { status: 400, code: 'PASSWORD_UNCHANGED', message: '新密码不能与旧密码相同' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockRes = await client.query(
      table === 'admins'
        ? 'SELECT id, username, role, password_hash, auth_version FROM admins WHERE id = $1 FOR UPDATE'
        : 'SELECT id, password_hash, auth_version FROM users WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (lockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 404, code: 'ACCOUNT_NOT_FOUND', message: '账号不存在' };
    }

    const row = lockRes.rows[0];

    // root 账号禁止本人改密（无论是谁发起）。
    if (isRootAdmin(row)) {
      await client.query('ROLLBACK');
      return { status: 403, code: 'ROOT_PASSWORD_FORBIDDEN', message: '默认教导主任账号不可修改密码' };
    }

    const matched = await bcrypt.compare(oldPassword, row.password_hash);
    if (!matched) {
      await client.query('ROLLBACK');
      // 有效账号 + 旧密码错：明确 400 + 业务码，绝不返回 401（避免与“未登录”混淆）。
      return { status: 400, code: 'OLD_PASSWORD_INCORRECT', message: '旧密码错误' };
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const currentVersion = row.auth_version ?? 0;
    const upd = await client.query(
      `UPDATE ${table} SET password_hash = $1, auth_version = auth_version + 1 WHERE id = $2 AND auth_version = $3`,
      [newHash, id, currentVersion]
    );

    if (upd.rowCount === 0) {
      // 并发期间版本已被他人改动（理论上有行锁保护不会触发，作为兜底）。
      await client.query('ROLLBACK');
      return { status: 409, code: 'VERSION_CONFLICT', message: '密码修改冲突，请稍后重试' };
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// 管理员固定密码重置：不信任客户端传入的 password，一律使用 FIXED_RESET_PASSWORD，
// 并递增 auth_version 使目标旧 token 失效。
// 返回 { ok: true } 或 { status, code, message }。
export async function resetPasswordAsAdmin({ pool, table, id, operatorId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockRes = await client.query(
      table === 'admins'
        ? 'SELECT id, username, role, auth_version FROM admins WHERE id = $1 FOR UPDATE'
        : 'SELECT id, auth_version FROM users WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (lockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 404, code: 'ACCOUNT_NOT_FOUND', message: '账号不存在' };
    }

    const row = lockRes.rows[0];

    // 目标为 root：禁止任何管理员（含其他 super_admin）重置默认教导主任账号。
    if (isRootAdmin(row)) {
      await client.query('ROLLBACK');
      return { status: 400, code: 'ROOT_PASSWORD_FORBIDDEN', message: '默认教导主任账号不可重置密码' };
    }

    // 管理员不可重置自己（防止“重置自己 + 固定密码”把当前账号锁死）。
    if (table === 'admins' && Number(operatorId) === Number(id)) {
      await client.query('ROLLBACK');
      return { status: 400, code: 'CANNOT_RESET_SELF', message: '不能重置当前登录账号' };
    }

    const newHash = await bcrypt.hash(FIXED_RESET_PASSWORD, 10);
    const currentVersion = row.auth_version ?? 0;
    const upd = await client.query(
      `UPDATE ${table} SET password_hash = $1, auth_version = auth_version + 1 WHERE id = $2 AND auth_version = $3`,
      [newHash, id, currentVersion]
    );

    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 409, code: 'VERSION_CONFLICT', message: '密码重置冲突，请稍后重试' };
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// 极简内存限流：固定窗口。用于改密 / 重置接口，防爆破与滥用。
// 注意：多实例部署需换成共享存储（如 Redis）；当前单体部署足够。
export function createInMemoryRateLimiter({ windowMs = 60 * 1000, max = 10 } = {}) {
  const hits = new Map();

  function cleanup(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    // 返回 true 表示允许；false 表示已超限。
    allow(key) {
      const now = Date.now();
      cleanup(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= max) {
        return false;
      }
      entry.count += 1;
      return true;
    }
  };
}

// 共享限流器：按“作用域 + IP + 账号”维度，60 秒内最多 10 次改密 / 重置尝试。
export const changePasswordRateLimiter = createInMemoryRateLimiter({ windowMs: 60 * 1000, max: 10 });

export function changePasswordRateLimitKey(scope, ip, account) {
  return `${scope}:${ip || 'unknown'}:${account ?? 'unknown'}`;
}
