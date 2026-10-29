// Read-only startup gate. Existing databases must use the explicit migration.
export const VISIBILITY_TABLES = Object.freeze(['track_points', 'knowledge_points', 'track_parts', 'knowledge_parts', 'content_attachments', 'video_attachments']);
export async function assertVisibilitySchema(client, { allowEmpty = false } = {}) {
  const { rows } = await client.query(`SELECT t.table_name, c.is_nullable, c.column_default, c.data_type,
    EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class r ON r.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname=current_schema() AND r.relname=t.table_name
      AND k.conname=t.table_name || '_visibility_check' AND k.contype='c' AND k.convalidated
      AND pg_get_constraintdef(k.oid) LIKE '%visibility%'
      AND pg_get_constraintdef(k.oid) LIKE '%public%'
      AND pg_get_constraintdef(k.oid) LIKE '%private%') AS has_check
    FROM information_schema.tables t LEFT JOIN information_schema.columns c
      ON c.table_schema=t.table_schema AND c.table_name=t.table_name AND c.column_name='visibility'
    WHERE t.table_schema=current_schema() AND t.table_name=ANY($1::text[])`, [VISIBILITY_TABLES]);
  if (allowEmpty && rows.length === 0) {
    const existing = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type=\'BASE TABLE\'');
    if (existing.rows.length === 0) return;
    // Docker's legacy init SQL creates only an empty videos table on a fresh volume.
    if (existing.rows.length === 1 && existing.rows[0].table_name === 'videos') {
      const videos = await client.query('SELECT 1 FROM videos LIMIT 1');
      if (videos.rows.length === 0) return;
    }
  }
  const invalid = VISIBILITY_TABLES.filter((name) => {
    const row = rows.find((r) => r.table_name === name);
    const expected = ['track_points', 'knowledge_points'].includes(name) ? 'private' : 'public';
    return !row || row.data_type !== 'text' || row.is_nullable !== 'NO' || !row.has_check || row.column_default !== `'${expected}'::text`;
  });
  if (invalid.length) {
    const error = new Error(`Visibility schema upgrade required: ${invalid.join(', ')}. Back up the server database, rehearse, then run backend/scripts/migrate-content-visibility.js --apply with DATABASE_URL. Startup performs no visibility backfill.`);
    error.code = 'VISIBILITY_SCHEMA_REQUIRED';
    throw error;
  }
}
