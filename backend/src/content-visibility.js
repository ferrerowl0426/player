// Foundation only: callers must supply a server-verified identity and transaction client.
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
