// Explicit offline-reviewed migration. NOT imported by server/db startup.
// Usage (after backup, in isolated DB first): node scripts/migrate-content-visibility.js --apply
// Uses only DATABASE_URL from the environment; does not load dotenv or db.js.
import { pathToFileURL } from 'node:url';

export const VISIBILITY_MIGRATION_SQL = `
SELECT pg_advisory_xact_lock(73281028);
LOCK TABLE track_points, knowledge_points, track_parts, knowledge_parts, content_attachments, video_attachments IN ACCESS EXCLUSIVE MODE;
ALTER TABLE content_attachments ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE video_attachments ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE track_parts ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE knowledge_parts ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE knowledge_points ADD COLUMN IF NOT EXISTS visibility TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content_attachments WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private'))
     OR EXISTS (SELECT 1 FROM video_attachments WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private'))
     OR EXISTS (SELECT 1 FROM track_parts WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private'))
     OR EXISTS (SELECT 1 FROM knowledge_parts WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private'))
     OR EXISTS (SELECT 1 FROM track_points WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private'))
     OR EXISTS (SELECT 1 FROM knowledge_points WHERE visibility IS NOT NULL AND visibility NOT IN ('', 'public', 'private')) THEN
    RAISE EXCEPTION 'Invalid existing visibility: review data before migration';
  END IF;
END $$;
UPDATE content_attachments SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE video_attachments SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE track_parts SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE knowledge_parts SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE track_points c SET visibility = CASE WHEN EXISTS (
  SELECT 1 FROM track_parts p WHERE p.track_id = c.id AND p.visibility = 'public'
) THEN 'public' ELSE 'private' END;
UPDATE knowledge_points c SET visibility = CASE WHEN EXISTS (
  SELECT 1 FROM knowledge_parts p WHERE p.knowledge_point_id = c.id AND p.visibility = 'public'
) THEN 'public' ELSE 'private' END;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['track_parts', 'knowledge_parts', 'track_points', 'knowledge_points', 'content_attachments', 'video_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility SET DEFAULT %L', t,
      CASE WHEN t IN ('track_points', 'knowledge_points') THEN 'private' ELSE 'public' END);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = t || '_visibility_check') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (visibility IN (''public'', ''private''))', t, t || '_visibility_check');
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_track_parts_parent_visibility ON track_parts (track_id, visibility);
CREATE INDEX IF NOT EXISTS idx_knowledge_parts_parent_visibility ON knowledge_parts (knowledge_point_id, visibility);
`;

export async function migrateContentVisibility(client) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query(VISIBILITY_MIGRATION_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
    throw new Error('Explicit --apply required; back up and rehearse in an isolated database first.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (not loaded from files).');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await migrateContentVisibility(client);
    console.log('Visibility migration completed. Private feature is NOT enabled by this migration.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
