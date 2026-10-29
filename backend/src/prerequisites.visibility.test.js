// Real HTTP transport against prerequisites router; controlled DB/identity boundaries.
// Verifies a private target can never be saved as a prerequisite, even by a director.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// assignable(prerequisiteType, prerequisiteId) => bool, controlled per test.
let assignableResult = true;
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
mock.module(new URL('./content-object-access.js', import.meta.url).href, {
  namedExports: {
    canReadContentObject: async () => true,
    canAssignContentObject: async () => assignableResult
  }
});

const { prerequisiteRouter } = await import('./prerequisites.routes.js');
const app = express(); app.use(express.json()); app.use('/prerequisites', prerequisiteRouter);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise((r) => server.close(r)); mock.reset(); });

test('private prerequisite target is rejected with 409 even for director', async () => {
  assignableResult = false;
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 2 }] })
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.message, /私密/);
});

test('public prerequisite target is accepted', async () => {
  assignableResult = true;
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 2 }] })
  });
  assert.equal(res.status, 200);
});

test('self prerequisite is rejected', async () => {
  assignableResult = true;
  const res = await fetch(`${base}/prerequisites`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType: 'track_point', objectId: 1, prerequisites: [{ objectType: 'track_point', objectId: 1 }] })
  });
  assert.equal(res.status, 400);
});
