// Read-only startup gate. Existing databases must use the explicit migration
// (scripts/migrate-auth-version.js --apply) before the server will serve traffic.
// This mirrors the visibility schema gate: startup performs NO column backfill,
// it only refuses to run against a database that has not been migrated.
export const AUTH_VERSION_TABLES = Object.freeze(['admins', 'users']);

export async function assertAuthVersionSchema(client, { allowEmpty = false } = {}) {
  const { rows } = await client.query(
    `SELECT t.table_name, c.is_nullable, c.column_default, c.data_type
       FROM information_schema.tables t
       LEFT JOIN information_schema.columns c
         ON c.table_schema = t.table_schema
        AND c.table_name = t.table_name
        AND c.column_name = 'auth_version'
      WHERE t.table_schema = current_schema()
        AND t.table_name = ANY($1::text[])`,
    [AUTH_VERSION_TABLES]
  );

  if (allowEmpty && rows.length === 0) {
    const existing = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"
    );
    if (existing.rows.length === 0) return;
    // Docker's legacy init SQL creates only an empty videos table on a fresh volume.
    if (existing.rows.length === 1 && existing.rows[0].table_name === 'videos') {
      const videos = await client.query('SELECT 1 FROM videos LIMIT 1');
      if (videos.rows.length === 0) return;
    }
  }

  const invalid = AUTH_VERSION_TABLES.filter((name) => {
    const row = rows.find((r) => r.table_name === name);
    // 要求：INTEGER 类型、NOT NULL、默认 0。
    // column_default 可能为 '0' 或 '0::integer'，统一剥离类型转换后再比对。
    const defaultVal = String(row?.column_default ?? '').replace(/::[a-z ]+/gi, '').replace(/\s+/g, '');
    return (
      !row ||
      row.data_type !== 'integer' ||
      row.is_nullable !== 'NO' ||
      defaultVal !== '0'
    );
  });

  if (invalid.length) {
    const error = new Error(
      `Auth version schema upgrade required: ${invalid.join(', ')}. ` +
        'Back up the server database, rehearse, then run backend/scripts/migrate-auth-version.js --apply with DATABASE_URL. ' +
        'Startup performs no auth_version backfill.'
    );
    error.code = 'AUTH_VERSION_SCHEMA_REQUIRED';
    throw error;
  }
}
