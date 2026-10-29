// Creates ONLY a uniquely named disposable PostgreSQL container; never loads application env.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { VISIBILITY_MIGRATION_SQL } from './migrate-content-visibility.js';

const docker = process.env.TEST_DOCKER_BINARY || 'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const name = `player-visibility-test-${randomBytes(6).toString('hex')}`;
let created = false;
let checks = 0;
function run(args, input) {
  const result = spawnSync(docker, args, { input, encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
}
function sql(text) {
  return run(['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'visibility_test', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text);
}
function check(text, expected, label) {
  assert.equal(sql(text), expected, label);
  checks++;
  console.log(`PASS ${label}`);
}
const seed = `
CREATE TABLE content_attachments (id INTEGER PRIMARY KEY, visibility TEXT);
CREATE TABLE video_attachments (id INTEGER PRIMARY KEY, visibility TEXT);
INSERT INTO content_attachments VALUES (1,NULL),(2,''),(3,'private');
INSERT INTO video_attachments VALUES (1,NULL),(2,'public'),(3,'private');
CREATE TABLE track_points (id INTEGER PRIMARY KEY);
CREATE TABLE knowledge_points (id INTEGER PRIMARY KEY);
CREATE TABLE track_parts (id INTEGER PRIMARY KEY, track_id INTEGER REFERENCES track_points(id), visibility TEXT);
CREATE TABLE knowledge_parts (id INTEGER PRIMARY KEY, knowledge_point_id INTEGER REFERENCES knowledge_points(id), visibility TEXT);
INSERT INTO track_points VALUES (1),(2),(3);
INSERT INTO knowledge_points VALUES (1),(2),(3);
INSERT INTO track_parts VALUES (1,1,NULL),(2,1,''),(3,2,'private');
INSERT INTO knowledge_parts VALUES (1,1,NULL),(2,1,'public'),(3,2,'private');
`;
const migrate = `BEGIN; SET LOCAL lock_timeout = '10s'; ${VISIBILITY_MIGRATION_SQL} COMMIT;`;
try {
  // --pull=never avoids implicit downloads; failure is explicit if no local image exists.
  run(['run', '--pull=never', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=visibility_test', 'postgres:16']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync(docker, ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'visibility_test'], { encoding: 'utf8', timeout: 10000 });
    if (probe.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
  sql(seed);
  sql(migrate);
  check("SELECT string_agg(visibility, ',' ORDER BY id) FROM track_parts;", 'public,public,private', 'legacy NULL/empty filled, private preserved');
  check("SELECT string_agg(visibility, ',' ORDER BY id) FROM knowledge_parts;", 'public,public,private', 'knowledge P compatibility');
  check("SELECT string_agg(visibility, ',' ORDER BY id) FROM track_points;", 'public,private,private', 'mixed/private/empty track courses');
  check("SELECT string_agg(visibility, ',' ORDER BY id) FROM knowledge_points;", 'public,private,private', 'knowledge course derivation');
  sql(migrate);
  check("SELECT string_agg(visibility, ',' ORDER BY id) FROM track_parts;", 'public,public,private', 'repeat migration preserves private');
  for (const table of ['content_attachments', 'video_attachments']) {
    check(`SELECT string_agg(visibility, ',' ORDER BY id) FROM ${table};`, 'public,public,private', `${table} legacy values and private preserved after repeat migration`);
    sql(`INSERT INTO ${table} (id) VALUES (4);`);
    check(`SELECT visibility FROM ${table} WHERE id=4;`, 'public', `${table} new attachment default public`);
    for (const value of ["'invalid'", 'NULL', "''"]) {
      assert.throws(() => sql(`UPDATE ${table} SET visibility=${value} WHERE id=1;`)); checks++;
    }
  }
  sql('INSERT INTO track_parts (id,track_id) VALUES (4,3); INSERT INTO track_points(id) VALUES(4);');
  check('SELECT visibility FROM track_parts WHERE id=4;', 'public', 'new P default public');
  check('SELECT visibility FROM track_points WHERE id=4;', 'private', 'new empty course default private');
  for (const statement of ["UPDATE track_parts SET visibility='other' WHERE id=1;", 'UPDATE knowledge_parts SET visibility=NULL WHERE id=1;']) {
    assert.throws(() => sql(statement)); checks++;
  }
  // Reset only fixtures inside this disposable container, then verify failed DDL is rolled back.
  sql('DROP TABLE track_parts, knowledge_parts, track_points, knowledge_points, content_attachments, video_attachments;');
  sql(seed);
  sql("UPDATE track_parts SET visibility='invalid' WHERE id=3;");
  assert.throws(() => sql(migrate)); checks++;
  check("SELECT count(*) FROM information_schema.columns WHERE table_name='track_points' AND column_name='visibility';", '0', 'failed migration rolls back added columns');
  check('SELECT visibility IS NULL FROM track_parts WHERE id=1;', 't', 'failed migration leaves legacy data untouched');
  // Completely missing P columns must also be supported.
  sql("UPDATE track_parts SET visibility='private' WHERE id=3; ALTER TABLE track_parts DROP COLUMN visibility; ALTER TABLE knowledge_parts DROP COLUMN visibility;");
  sql(migrate);
  check("SELECT bool_and(visibility='public') FROM track_parts;", 't', 'missing P field backfilled public');
  sql('ALTER TABLE content_attachments DROP COLUMN visibility; ALTER TABLE video_attachments DROP COLUMN visibility;');
  sql(migrate);
  for (const table of ['content_attachments', 'video_attachments']) {
    check(`SELECT bool_and(visibility='public') FROM ${table};`, 't', `${table} missing field backfilled public`);
    sql(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_visibility_check; UPDATE ${table} SET visibility='invalid' WHERE id=1;`);
    sql("UPDATE track_parts SET visibility='private' WHERE id=1;");
    assert.throws(() => sql(migrate)); checks++;
    check('SELECT visibility FROM track_parts WHERE id=1;', 'private', `${table} invalid migration rolls back without modifying P`);
    check(`SELECT visibility FROM ${table} WHERE id=1;`, 'invalid', `${table} invalid existing value not silently published`);
    sql(`UPDATE ${table} SET visibility='private' WHERE id=1;`);
    sql(migrate);
  }
  // Real concurrent sessions: second editor must observe first editor's committed state.
  function session() {
    return { query(text, values = []) {
      const bound = text.replace(/\$(\d+)/g, (_, n) => String(Number(values[Number(n) - 1])));
      return new Promise((resolve, reject) => {
        const child = spawn(docker, ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'visibility_test', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
        let out = '', err = '';
        child.stdout.on('data', (d) => out += d);
        child.stderr.on('data', (d) => err += d);
        child.on('error', reject);
        child.on('close', (code) => code ? reject(new Error(err)) : resolve({ rows: out.trim() ? [{ id: 1, visibility: out.trim().split('|').at(-1) }] : [] }));
        child.stdin.end(bound);
      });
    } };
  }
  sql("UPDATE track_parts SET visibility='public' WHERE track_id=1;");
  const first = session().query("BEGIN; SELECT id FROM track_points WHERE id=1 FOR UPDATE; SELECT pg_sleep(0.4); UPDATE track_parts SET visibility='private' WHERE track_id=1; UPDATE track_points SET visibility='private' WHERE id=1; COMMIT;");
  const second = session().query("BEGIN; SELECT pg_sleep(0.15); SELECT id FROM track_points WHERE id=1 FOR UPDATE; UPDATE track_parts SET visibility='public' WHERE id=1; UPDATE track_points c SET visibility=CASE WHEN EXISTS(SELECT 1 FROM track_parts p WHERE p.track_id=c.id AND p.visibility='public') THEN 'public' ELSE 'private' END WHERE id=1; COMMIT;");
  await Promise.all([first, second]);
  check("SELECT visibility FROM track_points WHERE id=1;", 'public', 'concurrent parent-locked edits preserve final derived state');
  sql("BEGIN; SELECT id FROM track_points WHERE id=1 FOR UPDATE; UPDATE track_parts SET visibility='private' WHERE track_id=1; UPDATE track_points SET visibility='private' WHERE id=1; ROLLBACK;");
  check("SELECT visibility FROM track_points WHERE id=1;", 'public', 'failed edit rollback preserves course state');
  check("SELECT visibility FROM track_parts WHERE id=1;", 'public', 'failed edit rollback preserves P state');

  // ---- 阶段 D：前置引用与作业布置的并发正确性 ----
  sql(`
    CREATE TABLE prerequisites (
      object_type VARCHAR(30) NOT NULL, object_id INTEGER NOT NULL,
      prerequisite_type VARCHAR(30) NOT NULL, prerequisite_id INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (object_type, object_id, prerequisite_type, prerequisite_id)
    );
    CREATE TABLE user_assignments (id SERIAL PRIMARY KEY, user_id INTEGER, object_type VARCHAR(30), object_id INTEGER, part_id INTEGER, is_deleted BOOLEAN DEFAULT FALSE);
  `);

  // 设前置的“资格校验”SQL：课程必须有公开 P 才可作为前置目标。
  const courseAssignable = (id) => `SELECT 1 FROM track_points c WHERE c.id=${id} AND COALESCE(NULLIF(c.visibility,''),'public')='public' AND EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id=c.id AND COALESCE(NULLIF(p.visibility,''),'public')='public')`;

  // 显式把课程2 设为私密（无公开 P），作为“私密不可作前置”的确定性前提。
  sql("UPDATE track_parts SET visibility='private' WHERE track_id=2; UPDATE track_points SET visibility='private' WHERE id=2;");
  check(courseAssignable(2), '', 'private course is not assignable as prerequisite (SQL predicate)');
  // 课程1 保持公开，可作前置。
  check(courseAssignable(1), '1', 'public course is assignable as prerequisite (SQL predicate)');

  // 设前置事务锁课程行；改私密事务锁同一课程行，二者串行化。
  // 场景1：课程2 公开时设前置 vs 并发改私密。
  // 设前置先拿锁并写入引用；改私密后拿锁，检查到前置引用 → 回滚（409），课程2 保持公开。
  sql("UPDATE track_parts SET visibility='public' WHERE id=3; UPDATE track_points SET visibility='public' WHERE id=2;");
  check(courseAssignable(2), '1', 'course 2 now public after P3 made public');
  const setPrereq = session().query("BEGIN; SELECT id FROM track_points WHERE id=2 FOR UPDATE; SELECT pg_sleep(0.3); INSERT INTO prerequisites (object_type, object_id, prerequisite_type, prerequisite_id) VALUES ('track_point', 1, 'track_point', 2); COMMIT;");
  // 模拟 finalizeCourseVisibility：锁后若存在前置引用则不改私密（用条件 UPDATE 表达“冲突即回滚/不生效”）。
  const makePrivate = session().query("BEGIN; SELECT pg_sleep(0.1); SELECT id FROM track_points WHERE id=2 FOR UPDATE; UPDATE track_parts SET visibility='private' WHERE track_id=2 AND NOT EXISTS (SELECT 1 FROM prerequisites WHERE prerequisite_type='track_point' AND prerequisite_id=2); UPDATE track_points SET visibility='private' WHERE id=2 AND NOT EXISTS (SELECT 1 FROM prerequisites WHERE prerequisite_type='track_point' AND prerequisite_id=2); COMMIT;");
  await Promise.all([makePrivate, setPrereq]);
  // 因前置引用冲突，改私密被拒绝，课程2 保持公开且引用保留。
  check("SELECT visibility FROM track_points WHERE id=2;", 'public', 'make-private blocked by prerequisite reference (course stays public)');
  check("SELECT count(*) FROM prerequisites WHERE prerequisite_type='track_point' AND prerequisite_id=2;", '1', 'prerequisite reference preserved when make-private is blocked');

  // 场景2：改私密先提交后，设前置应在锁后复核失败（真实路由拒绝）。
  // 用“锁后带条件 INSERT”（复核课程仍公开才写入）模拟路由语义，断言不会写入私密课程引用。
  sql("UPDATE track_parts SET visibility='public' WHERE track_id=2; UPDATE track_points SET visibility='public' WHERE id=2; DELETE FROM prerequisites;");
  const makePrivate2 = session().query("BEGIN; SELECT id FROM track_points WHERE id=2 FOR UPDATE; SELECT pg_sleep(0.3); UPDATE track_parts SET visibility='private' WHERE track_id=2; UPDATE track_points SET visibility='private' WHERE id=2; COMMIT;");
  const setPrereq2 = session().query("BEGIN; SELECT pg_sleep(0.1); SELECT id FROM track_points WHERE id=2 FOR UPDATE; INSERT INTO prerequisites (object_type, object_id, prerequisite_type, prerequisite_id) SELECT 'track_point', 1, 'track_point', 2 WHERE EXISTS (SELECT 1 FROM track_points c WHERE c.id=2 AND COALESCE(NULLIF(c.visibility,''),'public')='public' AND EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id=c.id AND COALESCE(NULLIF(p.visibility,''),'public')='public')); COMMIT;");
  await Promise.all([makePrivate2, setPrereq2]);
  check("SELECT count(*) FROM prerequisites WHERE prerequisite_type='track_point' AND prerequisite_id=2;", '0', 'prerequisite insert re-checked against private course');

  // 作业布置资格：公开 P 且父课程公开才可布置。
  check(`SELECT 1 FROM track_parts x JOIN track_points c ON c.id=x.track_id WHERE x.id=1 AND COALESCE(NULLIF(x.visibility,''),'public')='public' AND COALESCE(NULLIF(c.visibility,''),'public')='public' AND EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id=c.id AND COALESCE(NULLIF(p.visibility,''),'public')='public')`, '1', 'public P assignable as assignment target');
  // 私密 P 不可布置。
  sql("UPDATE track_parts SET visibility='private' WHERE id=3;");
  check(`SELECT 1 FROM track_parts x JOIN track_points c ON c.id=x.track_id WHERE x.id=3 AND COALESCE(NULLIF(x.visibility,''),'public')='public' AND COALESCE(NULLIF(c.visibility,''),'public')='public' AND EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id=c.id AND COALESCE(NULLIF(p.visibility,''),'public')='public')`, '', 'private P is not assignable as assignment target');

  console.log(`SUCCESS: ${checks} real PostgreSQL checks; no host port, no production connection.`);
} finally {
  if (created) {
    run(['rm', '-f', name]);
    console.log('Removed isolated test container and ephemeral fixtures.');
  }
}
