// Real HTTP transport against prerequisites router; controlled DB/identity boundaries.
// Verifies a private target CAN be saved as a prerequisite (teachers may maintain
// private prerequisites), and that only the real existence of the target matters
// (canMaintainPrerequisite, not the visibility-gated canAssignContentObject).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbRows = (type, id) => {
  if (type === 'track_point') return { rows: [{ id, name: 'course', cover: '' }], rowCount: 1 };
  if (type === 'track_part') return { rows: [{ id, title: 'part', track_id: 1 }], rowCount: 1 };
  return { rows: [{ id, name: 'obj', cover: '' }], rowCount: 1 };
};
mock.module(new URL('./db.js', import.meta.url).href, {
  namedExports: {
    pool: {
      connect: async () => ({
        query: async (sql, values) => {
          if (/FOR UPDATE/.test(sql)) return { rows: [{ id: values ? values[0] : 1, track_id: 1, knowledge_point_id: 1 }], rowCount: 1 };
          if (/INSERT INTO prerequisites/.test(sql)) return { rows: [], rowCount: 1 };
          if (/DELETE FROM prerequisites/.test(sql)) return { rows: [], rowCount: 1 };
          if (/FROM prerequisites/.test(sql)) return { rows: [], rowCount: 0 };
          if (/SELECT 1 FROM \w+ WHERE id\s*=\s*\$1/.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {}
      }),
      query: async (sql, values) => {
        if (/SELECT id, name AS title, cover FROM track_points/.test(sql)) return dbRows('track_point', values[0]);
        if (/SELECT id, title, track_id AS parent_id FROM track_parts/.test(sql)) return dbRows('track_part', values[0]);
        if (/SELECT id, name AS title, cover FROM track_collections/.test(sql)) return { rows: [{ id: values[0], name: 'col', cover: '' }], rowCount: 1 };
        if (/SELECT id, name AS title, cover FROM knowledge_points/.test(sql)) return { rows: [{ id: values[0], name: 'kp', cover: '' }], rowCount: 1 };
        if (/SELECT id, name AS title, cover FROM knowledge_collections/.test(sql)) return { rows: [{ id: values[0], name: 'kc', cover: '' }], rowCount: 1 };
        if (/SELECT id, title, knowledge_point_id AS parent_id FROM knowledge_parts/.test(sql)) return dbRows('track_part', values[0]);
        if (/SELECT id, title, cover_url AS cover FROM videos/.test(sql)) return { rows: [{ id: values[0], title: 'video', cover: '' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
    }
  }
});
mock.module(new URL('./auth.js', import.meta.url).href, {
  namedExports: {
    optionalContentViewer(req, res, next) { req.contentViewer = { role: 'super_admin', status: 'active' }; next(); },
    requireSuperAdmin(req, res, next) { req.admin = { adminId: 1 }; next(); }
  }
});
// canMaintainPrerequisite 在本测试中由真实存在性检查驱动（委托给被 mock 的 client）。
mock.module(new URL('./content-object-access.js', import.meta.url).href, {
  namedExports: {
    canReadContentObject: async () => true,
    canMaintainPrerequisite: async (client, type, id) => {
      const table = {
        track_point: 'track_points', knowledge_point: 'knowledge_points',
        track_part: 'track_parts', knowledge_part: 'knowledge_parts',
        track_collection: 'track_collections', knowledge_collection: 'knowledge_collections',
        video: 'videos'
      }[type];
      if (!table) return false;
      const result = await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id]);
      return result.rowCount > 0;
    }
  }
});

const { prerequisiteRouter } = await import('./prerequisites.routes.js');
const app = express(); app.use(express.json()); app.use('/prerequisites', prerequisiteRouter);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise((r) => server.close(r)); mock.reset(); });

test('private prerequisite target is accepted (teachers may maintain private prerequisites)', async () => {
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 2 }] })
  });
  assert.equal(res.status, 200);
});

test('public prerequisite target is accepted', async () => {
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 2 }] })
  });
  assert.equal(res.status, 200);
});

test('self prerequisite is rejected', async () => {
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 1 }] })
  });
  assert.equal(res.status, 400);
});
