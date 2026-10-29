# 2026-10-29 生产部署 502 复盘：VISIBILITY_SCHEMA_REQUIRED

## 背景

完成「分 P 公开/私密权限」全链路（后端 A–E + 前端 F）并推送后，将新代码部署到生产服务器，重启后端后 `api.nxhguitar.com` 返回 **502**。表现：

- 登录页 `POST https://api.nxhguitar.com/api/auth/login` 请求失败，浏览器控制台报 `Failed to fetch` / CORS 预检失败。
- 这些 CORS 报错是 502 的**连带现象**，根因在后端进程没有起来。

后端容器日志关键行：

```txt
VISIBILITY_SCHEMA_REQUIRED
```

即新后端启动时校验数据库必须已有 `visibility` 字段，校验失败直接拒绝启动，进程退出进入崩溃重启循环。

---

## 根因

新后端 `assertVisibilitySchema`（`backend/src/visibility-schema.js`）出于安全考虑，**不会在启动时自动修改生产数据库**，而是要求 DBA 显式执行迁移脚本 `backend/scripts/migrate-content-visibility.js --apply` 后再启动。

本次部署时**跳过了迁移步骤**，直接把新镜像拉起来，导致：

1. 后端启动 → 校验 `visibility` 字段 → 生产库没有该字段 → 抛 `VISIBILITY_SCHEMA_REQUIRED` → 进程退出。
2. Docker 重启策略让容器反复重启（Restarting 循环）。
3. Nginx 反代的后端上游始终不可用 → 502。
4. 登录页 CORS / `Failed to fetch` 是后端不可用的连带表现。

本质：**部署流程缺少「数据库迁移」这一前置步骤**。

---

## 排查过程

### 1. 确认容器真实名称

生产服务器容器名与本地 compose 项目名不同，不能照搬本地名字：

```bash
docker ps --format "{{.Names}}"
```

实际为全下划线命名：

- `video_player_backend`
- `video_player_frontend`
- `video_player_postgres`
- `video_player_minio`

数据库名 `video_player`，用户 `postgres`。

### 2. 确认后端日志

```bash
docker logs --tail 30 video_player_backend
```

看到 `VISIBILITY_SCHEMA_REQUIRED`，确认是缺 `visibility` 字段。

### 3. 备份数据库

```bash
docker exec video_player_postgres pg_dump -U postgres video_player > ~/player_backup_1029.sql
```

### 4. 尝试在 backend 容器内跑迁移 —— 失败

```bash
docker exec video_player_backend node scripts/migrate-content-visibility.js --apply
```

报错：

```txt
Error response from daemon: Container ... is restarting, wait until the container is running
```

backend 处于崩溃重启循环，`docker exec` 进不去，此路不通。

### 5. 改在 postgres 容器内直接执行等价迁移 SQL —— 成功

迁移只需连数据库，postgres 容器是正常运行的。用 heredoc 把与 `migrate-content-visibility.js` 中 `VISIBILITY_MIGRATION_SQL` **逐字等价**的 SQL 喂给 psql 执行（见下）。

---

## 处理方式

### 1. 在 postgres 容器内执行迁移 SQL

```bash
docker exec -i video_player_postgres psql -U postgres -d video_player -v ON_ERROR_STOP=1 <<'EOF'
BEGIN;
SELECT pg_advisory_xact_lock(73281028);
LOCK TABLE track_points, knowledge_points, track_parts, knowledge_parts, content_attachments, video_attachments IN ACCESS EXCLUSIVE MODE;
ALTER TABLE content_attachments ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE video_attachments ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE track_parts ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE knowledge_parts ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS visibility TEXT;
ALTER TABLE knowledge_points ADD COLUMN IF NOT EXISTS visibility TEXT;
UPDATE content_attachments SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE video_attachments SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE track_parts SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE knowledge_parts SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
UPDATE track_points c SET visibility = CASE WHEN EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id = c.id AND p.visibility = 'public') THEN 'public' ELSE 'private' END;
UPDATE knowledge_points c SET visibility = CASE WHEN EXISTS (SELECT 1 FROM knowledge_parts p WHERE p.knowledge_point_id = c.id AND p.visibility = 'public') THEN 'public' ELSE 'private' END;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['track_parts','knowledge_parts','track_points','knowledge_points','content_attachments','video_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility SET DEFAULT %L', t, CASE WHEN t IN ('track_points','knowledge_points') THEN 'private' ELSE 'public' END);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = t::regclass AND conname = t || '_visibility_check') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (visibility IN (''public'',''private''))', t, t || '_visibility_check');
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_track_parts_parent_visibility ON track_parts (track_id, visibility);
CREATE INDEX IF NOT EXISTS idx_knowledge_parts_parent_visibility ON knowledge_parts (knowledge_point_id, visibility);
COMMIT;
EOF
```

说明：

- `ADD COLUMN IF NOT EXISTS`、约束/索引 `IF NOT EXISTS`，幂等，可重复执行。
- advisory lock + 表锁 + `ON_ERROR_STOP=1` 保证迁移要么整体成功、要么整体失败回滚。
- 存量数据全部标 `public`（课程/合集按「存在公开 P」派生），**行为与旧版完全一致**。
- 迁移本身**不启用私密功能**；生产 `CONTENT_PRIVACY_MODE` 保持 `off` 时线上匿名访问行为不变。

### 2. 重启后端并验证

```bash
docker restart video_player_backend
sleep 5
docker logs --tail 10 video_player_backend
curl -s http://localhost:3000/api/health
```

curl 返回：

```txt
{"message":"后端服务运行正常"}
```

恢复完成，登录页 CORS / Failed to fetch 全部消失。

---

## 经验结论

1. **部署新版本必须带上数据库迁移**：只要新代码包含 `backend/scripts/` 下的迁移脚本（如 `migrate-content-visibility.js`），必须在重建后端容器**之前**先执行迁移，否则后端会因 `assertVisibilitySchema` 校验失败而崩溃循环。
2. **后端崩溃循环时 `docker exec` 进不去**：迁移只需数据库，可绕过 backend 容器，直接在 postgres 容器内用 psql 执行等价 SQL。
3. **服务器容器名 ≠ 本地容器名**：先 `docker ps --format "{{.Names}}"` 确认真实名字，不要照搬本地 `video_player_backend`/`video_player_postgres` 的猜测（本次生产实际是全下划线 `video_player_*`）。
4. **迁移前先备份**：`pg_dump` 到宿主机文件，本次备份在 `~/player_backup_1029.sql`。
5. 这类「启动即校验 schema」的 fail-fast 设计，优点是避免启动时静默改库，缺点是部署时漏迁移会直接宕机——**务必把迁移写进标准部署流程**。

---

## 标准部署流程（更新版，已并入 README）

见 README「部署与更新」章节，核心顺序：

```bash
cd /root/player
git pull gitee main

# 1) 先确认容器名（生产是全下划线）
docker ps --format "{{.Names}}"

# 2) 备份数据库
docker exec <postgres容器名> pg_dump -U postgres video_player > ~/player_backup_$(date +%m%d).sql

# 3) 若新版本含迁移脚本，先执行迁移（幂等可重复）
docker exec <backend容器名> node scripts/migrate-content-visibility.js --apply

# 4) 重建并重启
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml build backend frontend
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml up -d --force-recreate backend frontend

# 5) 验证
curl -s http://localhost:3000/api/health
```
