// Callers must supply a server-verified identity and transaction client.
// Acquire family locks before any content row locks; cross-family order is fixed.
const VISIBILITY_FAMILIES = Object.freeze({ track: 1, knowledge: 2 });
export async function lockVisibilityFamilies(client, families = ['track', 'knowledge']) {
  if (!Array.isArray(families) || families.length === 0 || families.some((family) => !Object.hasOwn(VISIBILITY_FAMILIES, family))) {
    throw new VisibilityError('内容类型无效', 'INVALID_CONTENT_TYPE');
  }
  const ids = [...new Set(families.map((family) => VISIBILITY_FAMILIES[family]))].sort((a, b) => a - b);
  for (const id of ids) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [73281029, id]);
}
export const PUBLIC = 'public';
export const PRIVATE = 'private';

export class VisibilityError extends Error {
  constructor(message, code = 'INVALID_VISIBILITY') {
    super(message);
    this.name = 'VisibilityError';
    this.code = code;
    this.status = 400;
  }
}

export function normalizeStoredVisibility(value) {
  if (value === undefined || value === null || value === '') return PUBLIC;
  if (value === PUBLIC || value === PRIVATE) return value;
  throw new VisibilityError('数据库可见性状态异常');
}

export function resolveVisibilityInput(input, previous) {
  if (input === undefined) return normalizeStoredVisibility(previous);
  if (input !== PUBLIC && input !== PRIVATE) throw new VisibilityError('请选择公开或私密');
  return input;
}

export function canViewPrivate(viewer) {
  return viewer?.status === 'active' && ['teacher', 'super_admin'].includes(viewer?.role);
}

export function canViewContent(visibility, viewer) {
  return normalizeStoredVisibility(visibility) === PUBLIC || canViewPrivate(viewer);
}

// Pure authorization intersection only; never resolves IDs, signs URLs or bypasses
// existing access rules. Callers must load the real parent (and optional P) server-side.
export function canDownloadAttachment({ attachment, course, part, viewer, existingAccessAllowed = false } = {}) {
  if (existingAccessAllowed !== true || !attachment || !course || part === null) return false;
  const states = [attachment.visibility, course.visibility];
  if (part !== undefined) states.push(part.visibility);
  // Evaluate every stored value even for staff: corrupt data must fail closed.
  return states.map(normalizeStoredVisibility).every((value) => canViewContent(value, viewer));
}

// Eligibility only; caller must ALSO validate class/edit permissions and parent visibility.
export function isPublicTarget(visibility) {
  return normalizeStoredVisibility(visibility) === PUBLIC;
}

export function deriveCourseVisibility(parts = []) {
  return parts.some((part) => normalizeStoredVisibility(part.visibility) === PUBLIC) ? PUBLIC : PRIVATE;
}

const TYPES = Object.freeze({
  track_point: { course: 'track_points', parts: 'track_parts', parent: 'track_id' },
  knowledge_point: { course: 'knowledge_points', parts: 'knowledge_parts', parent: 'knowledge_point_id' }
});

function definition(type) {
  if (!Object.hasOwn(TYPES, type)) throw new VisibilityError('课程类型无效', 'INVALID_CONTENT_TYPE');
  return TYPES[type];
}

function positiveId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new VisibilityError('课程ID无效', 'INVALID_CONTENT_ID');
  return value;
}

// Fixed aliases only: never interpolate client-provided identifiers into SQL.
export function publicCoursePredicate(type) {
  const { parts, parent } = definition(type);
  return `(COALESCE(NULLIF(c.visibility, ''), 'public') = 'public' AND EXISTS (SELECT 1 FROM ${parts} p WHERE p.${parent} = c.id AND COALESCE(NULLIF(p.visibility, ''), 'public') = 'public'))`;
}

export function publicPartPredicate() {
  return "COALESCE(NULLIF(p.visibility, ''), 'public') = 'public'";
}

// Caller owns BEGIN/COMMIT and must lock before reading or mutating any child P.
export async function lockCourse(client, type, courseId) {
  const { course } = definition(type);
  const result = await client.query(`SELECT id FROM ${course} WHERE id = $1 FOR UPDATE`, [positiveId(courseId)]);
  if (!result.rows.length) {
    const error = new VisibilityError('课程不存在', 'CONTENT_NOT_FOUND');
    error.status = 404;
    throw error;
  }
}

// Call after mutation, before prerequisite/assignment checks and COMMIT.
// This helper never commits; any later conflict must roll back the entire transaction.
export async function refreshCourseVisibility(client, type, courseId) {
  const { course, parts, parent } = definition(type);
  const result = await client.query(
    `UPDATE ${course} c SET visibility = CASE WHEN EXISTS (
      SELECT 1 FROM ${parts} p WHERE p.${parent} = c.id
      AND COALESCE(NULLIF(p.visibility, ''), 'public') = 'public'
    ) THEN 'public' ELSE 'private' END WHERE c.id = $1 RETURNING id, visibility`,
    [positiveId(courseId)]
  );
  if (!result.rows.length) {
    const error = new VisibilityError('课程不存在', 'CONTENT_NOT_FOUND');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

// ---- Collection visibility (Stage A) ----
// NOTE ON CONCURRENCY: lock ordering across the whole system is unified by all
// entry points in a later stage. This helper does NOT claim to solve every
// concurrency hazard. Callers must still acquire locks in the global order and
// own the surrounding transaction; these helpers only ever lock the specific
// rows they touch and never COMMIT/ROLLBACK on their own.

const COLLECTION_TYPES = Object.freeze({
  track_collection: {
    collection: 'track_collections',
    items: 'track_collection_items',
    course: 'track_points',
    itemCourse: 'track_id',
    parts: 'track_parts',
    parent: 'track_id'
  },
  knowledge_collection: {
    collection: 'knowledge_collections',
    items: 'knowledge_collection_items',
    course: 'knowledge_points',
    itemCourse: 'knowledge_point_id',
    parts: 'knowledge_parts',
    parent: 'knowledge_point_id'
  }
});

function collectionDefinition(type) {
  if (!Object.hasOwn(COLLECTION_TYPES, type)) throw new VisibilityError('合集类型无效', 'INVALID_CONTENT_TYPE');
  return COLLECTION_TYPES[type];
}

// Pure derivation over already-refreshed course flags; callers need not load parts.
// SQL refresh below additionally guards against stale public course flags.
export function deriveCollectionVisibility(courses = []) {
  return courses.some(
    (course) =>
      normalizeStoredVisibility(course.visibility) === PUBLIC
  )
    ? PUBLIC
    : PRIVATE;
}

// Alias-only SQL: never interpolate client-provided identifiers. A collection is
// public when it contains a public course (legacy-safe via COALESCE) that also
// has a public part (inner EXISTS guards against stale derived course visibility).
export function publicCollectionPredicate(type) {
  const { items, course, itemCourse, parts, parent } = collectionDefinition(type);
  return `(EXISTS (SELECT 1 FROM ${items} i JOIN ${course} cc ON cc.id = i.${itemCourse} WHERE i.collection_id = c.id AND COALESCE(NULLIF(cc.visibility, ''), 'public') = 'public' AND EXISTS (SELECT 1 FROM ${parts} p WHERE p.${parent} = cc.id AND COALESCE(NULLIF(p.visibility, ''), 'public') = 'public')))`;
}

// Call after mutating membership/visibility of a collection's courses, before
// COMMIT. This helper never commits; any later conflict must roll back the
// entire transaction. Returns { id, visibility }.
export async function refreshCollectionVisibility(client, type, id) {
  const { collection, items, course, itemCourse, parts, parent } = collectionDefinition(type);
  const result = await client.query(
    `UPDATE ${collection} c SET visibility = CASE WHEN EXISTS (
      SELECT 1 FROM ${items} i
      JOIN ${course} cc ON cc.id = i.${itemCourse}
      WHERE i.collection_id = c.id
      AND COALESCE(NULLIF(cc.visibility, ''), 'public') = 'public'
      AND EXISTS (SELECT 1 FROM ${parts} p WHERE p.${parent} = cc.id AND COALESCE(NULLIF(p.visibility, ''), 'public') = 'public')
    ) THEN 'public' ELSE 'private' END WHERE c.id = $1 RETURNING id, visibility`,
    [positiveId(id)]
  );
  if (!result.rows.length) {
    const error = new VisibilityError('合集不存在', 'CONTENT_NOT_FOUND');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

// Course type -> collection type that references it (fixed, whitelisted).
const COURSE_COLLECTION_TARGET = Object.freeze({
  track_point: 'track_collection',
  knowledge_point: 'knowledge_collection'
});

// Refresh every collection that references the given course. Locks the
// collection rows in fixed id order (FOR UPDATE) before refreshing each one in
// that same order, to avoid deadlocks against the global lock order defined by
// later-stage entry points. Caller owns the transaction; this helper never
// commits. Returns the array of updated collections in id order.
export async function refreshCollectionsForCourse(client, courseType, courseId) {
  if (!Object.hasOwn(COURSE_COLLECTION_TARGET, courseType)) throw new VisibilityError('课程类型无效', 'INVALID_CONTENT_TYPE');
  const collectionType = COURSE_COLLECTION_TARGET[courseType];
  const { collection, items, itemCourse } = collectionDefinition(collectionType);
  const locked = await client.query(
    `SELECT id FROM ${collection} c WHERE id IN (SELECT collection_id FROM ${items} WHERE ${itemCourse} = $1) ORDER BY id FOR UPDATE`,
    [positiveId(courseId)]
  );
  const updated = [];
  for (const row of [...locked.rows].sort((a, b) => a.id - b.id)) {
    updated.push(await refreshCollectionVisibility(client, collectionType, row.id));
  }
  return updated;
}
