import test from 'node:test';
import assert from 'node:assert/strict';
import { canDownloadAttachment, normalizeStoredVisibility, resolveVisibilityInput, canViewContent, isPublicTarget, deriveCourseVisibility, publicCoursePredicate, lockCourse, refreshCourseVisibility } from './content-visibility.js';
import { migrateContentVisibility, VISIBILITY_MIGRATION_SQL } from '../scripts/migrate-content-visibility.js';

test('legacy missing values become public; explicit private remains private', () => {
  for (const value of [undefined, null, '']) assert.equal(normalizeStoredVisibility(value), 'public');
  assert.equal(normalizeStoredVisibility('private'), 'private');
  assert.throws(() => normalizeStoredVisibility('unknown'));
});
test('editing omission preserves private; explicit invalid input is rejected', () => {
  assert.equal(resolveVisibilityInput(undefined, 'private'), 'private');
  assert.equal(resolveVisibilityInput(undefined), 'public');
  assert.equal(resolveVisibilityInput('public', 'private'), 'public');
  for (const value of [null, '', false, 'PUBLIC']) assert.throws(() => resolveVisibilityInput(value, 'private'));
});
test('private requires active server-verified teacher or director', () => {
  for (const role of ['teacher', 'super_admin']) assert.equal(canViewContent('private', { role, status: 'active' }), true);
  for (const viewer of [null, {}, { role: 'teacher' }, { role: 'teacher', status: 'disabled' }, { role: 'student', status: 'active' }]) {
    assert.equal(canViewContent('private', viewer), false);
    assert.equal(canViewContent('public', viewer), true);
  }
});
test('private is never an eligible assignment or prerequisite target', () => {
  assert.equal(isPublicTarget('private'), false);
  assert.equal(isPublicTarget('public'), true);
});
test('empty/all-private courses private, mixed and legacy courses public', () => {
  assert.equal(deriveCourseVisibility([]), 'private');
  assert.equal(deriveCourseVisibility([{ visibility: 'private' }]), 'private');
  assert.equal(deriveCourseVisibility([{ visibility: 'private' }, { visibility: 'public' }]), 'public');
  assert.equal(deriveCourseVisibility([{}]), 'public');
});
test('SQL predicates use whitelisted relations, protect stored and derived course visibility', () => {
  const sql = publicCoursePredicate('track_point');
  assert.match(sql, /c.visibility/);
  assert.match(sql, /EXISTS.*track_parts/s);
  assert.throws(() => publicCoursePredicate('track_points; DROP TABLE videos'));
});
test('lock and refresh use bound parameters and caller-owned transaction', async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: 5, visibility: 'private' }] }; } };
  await lockCourse(client, 'knowledge_point', 5);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].values, [5]);
  assert.equal((await refreshCourseVisibility(client, 'knowledge_point', 5)).visibility, 'private');
  assert.match(calls[1].sql, /knowledge_parts/);
  assert.match(calls[1].sql, /EXISTS/);
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
  await assert.rejects(() => lockCourse(client, 'track_point', '5 OR 1=1'));
});
test('missing course fails explicitly', async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(() => lockCourse(client, 'track_point', 9), { code: 'CONTENT_NOT_FOUND' });
  await assert.rejects(() => refreshCourseVisibility(client, 'track_point', 9), { code: 'CONTENT_NOT_FOUND' });
});
test('attachment permissions intersect attachment, course, optional P and existing access', () => {
  for (const attachment of ['public', 'private']) for (const course of ['public', 'private']) for (const part of ['public', 'private']) {
    for (const viewer of [null, { role: 'student', status: 'active' }, { role: 'teacher', status: 'disabled' }]) {
      assert.equal(canDownloadAttachment({ attachment: { visibility: attachment }, course: { visibility: course }, part: { visibility: part }, viewer, existingAccessAllowed: true }), [attachment, course, part].every((v) => v === 'public'));
    }
    for (const role of ['teacher', 'super_admin']) assert.equal(canDownloadAttachment({ attachment: { visibility: attachment }, course: { visibility: course }, part: { visibility: part }, viewer: { role, status: 'active' }, existingAccessAllowed: true }), true);
  }
});
test('attachment authorization denies missing parents and never overrides original access', () => {
  const input = { attachment: {}, course: {}, existingAccessAllowed: true };
  assert.equal(canDownloadAttachment(input), true);
  assert.equal(canDownloadAttachment(), false);
  assert.equal(canDownloadAttachment({ ...input, course: null }), false);
  assert.equal(canDownloadAttachment({ ...input, attachment: null }), false);
  assert.equal(canDownloadAttachment({ ...input, part: null }), false);
  assert.equal(canDownloadAttachment({ ...input, existingAccessAllowed: false, viewer: { role: 'super_admin', status: 'active' } }), false);
  assert.throws(() => canDownloadAttachment({ ...input, attachment: { visibility: 'invalid' } }));
});
test('attachments do not participate in course derivation', () => {
  assert.equal(deriveCourseVisibility([{ visibility: 'private', attachments: [{ visibility: 'public' }] }]), 'private');
  assert.equal(deriveCourseVisibility([{ visibility: 'public', attachments: [{ visibility: 'private' }] }]), 'public');
});

test('migration wrapper commits only on success', async () => {
  const calls = [];
  await migrateContentVisibility({ query: async (sql) => { calls.push(sql); } });
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls.at(-1), 'COMMIT');
  assert.equal(calls.includes('ROLLBACK'), false);
});
test('migration rolls back on SQL failure', async () => {
  const calls = [];
  await assert.rejects(() => migrateContentVisibility({ query: async (sql) => {
    calls.push(sql);
    if (sql === VISIBILITY_MIGRATION_SQL) throw new Error('invalid state');
  } }), /invalid state/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
});
test('migration SQL contract: backfill missing only, protect invalid states, constraints and locking', () => {
  for (const table of ['track_parts', 'knowledge_parts', 'content_attachments', 'video_attachments']) {
    assert.ok(VISIBILITY_MIGRATION_SQL.includes(`UPDATE ${table} SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';`));
  }
  assert.match(VISIBILITY_MIGRATION_SQL, /RAISE EXCEPTION/);
  assert.match(VISIBILITY_MIGRATION_SQL, /ACCESS EXCLUSIVE/);
  assert.match(VISIBILITY_MIGRATION_SQL, /pg_advisory_xact_lock/);
  assert.match(VISIBILITY_MIGRATION_SQL, /IF NOT EXISTS/);
  assert.match(VISIBILITY_MIGRATION_SQL, /SET NOT NULL/);
  assert.match(VISIBILITY_MIGRATION_SQL, /CHECK \(visibility IN/);
});
