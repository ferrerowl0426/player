// Optional authentication for public content. Dependencies are server-owned, never request body values.
// Invalid/disabled sessions degrade to guest; DB failures propagate rather than silently changing identity.
export function createContentViewerResolver({ verifyToken, loadAdmin, loadUser }) {
  return async function resolveContentViewer({ adminToken, userToken } = {}) {
    const guest = { role: 'guest', status: 'anonymous' };
    function decode(token, type) {
      if (!token) return null;
      try {
        const payload = verifyToken(token);
        return payload?.type === type ? payload : null;
      } catch {
        return null;
      }
    }
    const adminPayload = decode(adminToken, 'admin');
    if (adminPayload && Number.isSafeInteger(adminPayload.adminId) && adminPayload.adminId > 0) {
      const admin = await loadAdmin(adminPayload.adminId);
      if (admin?.status === 'active' && ['teacher', 'super_admin'].includes(admin.role)) {
        return { adminId: admin.id, role: admin.role, status: admin.status };
      }
    }
    const userPayload = decode(userToken, 'user');
    if (userPayload && Number.isSafeInteger(userPayload.userId) && userPayload.userId > 0) {
      const user = await loadUser(userPayload.userId);
      if (user?.status === 'active') return { userId: user.id, role: 'user', status: user.status };
    }
    return guest;
  };
}

export function createContentViewerMiddleware(resolve, { adminCookieName, userCookieName }) {
  return async function optionalContentViewer(req, res, next) {
    try {
      req.contentViewer = await resolve({
        adminToken: req.cookies?.[adminCookieName],
        userToken: req.cookies?.[userCookieName]
      });
      // Viewer-specific JSON must not be shared across accounts or cached as public.
      res.setHeader('Cache-Control', 'private, no-store');
      res.vary('Cookie');
      next();
    } catch (error) {
      next(error);
    }
  };
}
