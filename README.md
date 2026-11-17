# 能学慧吉他教室 · 项目交接 README

> **小程序端开发者请注意**：本 README 主要面向**网页端**。如果你接手的是微信小程序学生端，请直接阅读 [README-miniprogram.md](README-miniprogram.md) 和 [docs/PRD-小程序端学生功能.md](docs/PRD-小程序端学生功能.md)，本 README 只需按其中 §2「开工前必读」挑选部分章节阅读。

这是给下一位程序员 / AI 编码助手的交接文档。详细需求不要以 README 为准，必须优先阅读：

1. [PRD.md](docs/PRD.md)
2. [开发计划-组件复用与实施.md](docs/开发计划-组件复用与实施.md)
3. [design-spec.md](docs/design/guitar-home/design-spec.md)
4. [docs/design/guitar-home](docs/design/guitar-home) 下对应页面设计稿

README 只记录当前代码状态、启动方式、已完成阶段和接手注意事项。历史 PRD/阶段计划若与本文最新密码、作业或业务私密规则冲突，先核对当前实现和用户确认，不恢复旧方案。

### Git 协作

主分支 `main`；`gitee` 对应 `gitee.com/ferrerowl/player`，`origin` 对应 `github.com/ferrerowl0426/player`。本机推送必须使用系统 Git（内置 PortableGit 缺少凭据助手）：

```bash
"/c/Program Files/Git/cmd/git.exe" push gitee main
"/c/Program Files/Git/cmd/git.exe" push origin main
```

仅在明确授权提交/推送后执行。不要提交 `.env`、备份 dump、真实密钥和临时测试输出；服务器本地配置有差异时不得用 reset --hard 强制覆盖。

---

## 1. 当前项目定位

项目已从“通用视频播放器”演进为：

> 能学慧吉他教室内部教学平台。

核心对象不再是单一 `video` 页面，而是：

- 曲目区：单曲目 `track_point`、曲谱集 `track_collection`、曲目 P 分段 `track_part`
- 知识点区：单知识点 `knowledge_point`、知识点集 `knowledge_collection`、知识点 P 分段 `knowledge_part`
- 图书馆：`library_resource`
- 通用前置关系：`prerequisites`
- 通用作业：`user_assignments.object_type / object_id / part_id`

当前 M0–M9 开发阶段已经全部完成。现在不是继续新增里程碑，而是进入：

> 逐个页面对照 PRD 和 HTML 设计稿修 bug / 修视觉偏差 / 清理旧实现。

不要再按旧“视频播放器”思路开发页面。

---

## 2. 当前必须遵守的文档口径

### 2.1 表名 / object_type 新口径

旧名不要再用。

| object_type | 表 |
|---|---|
| `track_point` | `track_points` |
| `track_collection` | `track_collections` |
| `track_part` | `track_parts` |
| `knowledge_point` | `knowledge_points` |
| `knowledge_collection` | `knowledge_collections` |
| `knowledge_part` | `knowledge_parts` |
| `library_resource` | `library_resources` |

已废弃旧名：

- `tracks`
- `collections`
- `collection_tracks`
- `kp_parts`
- `kp_collections`
- `kp_collection_items`
- `track`
- `collection`
- `kp_*`

### 2.2 前置关系规则

- 统一使用 `prerequisites` 表。
- 允许多级前置。
- 不做环形依赖判定。
- 只禁止对象直接指向自身。

### 2.3 数据迁移规则

M0早期曾采用废弃测试数据后重新建表和seed的方式，此规则仅属历史，不适用于当前存量业务库或生产桶。

当前涉及字段变更，应先备份、在隔离副本演练、再显式执行对应版本迁移；禁止因升级而清空数据库、MinIO/COS桶或Docker数据卷。确需重建测试数据时，必须另行确认范围并使用精确清理流程。

---

## 3. 技术栈、端口与环境

### 前端

- Next.js App Router
- React
- JavaScript
- 本地端口固定：`http://localhost:3001`

### 后端

- Node.js
- Express
- PostgreSQL
- S3 兼容对象存储：本地 MinIO / 生产 COS
- 本地端口固定：`http://localhost:3000`

不要再把前端指向旧的 `3002`。

端口口径必须在三种环境完全一致：

| 环境 | 前端 | 后端 |
|---|---|---|
| 本地直接启动 | `3001` | `3000` |
| Docker / docker compose | `3001:3001` | `3000:3000` |
| 服务器部署 | `3001` | `3000` |

前端浏览器 API 地址统一指向：

```txt
http://localhost:3000/api
```

Docker 内部服务间调用统一使用：

```txt
http://backend:3000/api
```

环境文件当前应保持：

- 根目录 [.env](.env)
- 根目录 [.env.local](.env.local)
- 后端 [backend/.env](backend/.env)

关键配置：

```txt
PORT=3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

### 3.1 生产环境（线上）口径

线上服务器：`/root/player`，公网 IP `150.158.122.193`，Docker Compose + 腾讯云 COS。

| 入口 | 地址 | 说明 |
|---|---|---|
| 主站（唯一业务入口） | `https://nxhguitar.com` | 前端容器 `3001`，Nginx 反代 |
| API | `https://api.nxhguitar.com/api` | 后端容器 `3000`，Nginx 反代 |
| `http://nxhguitar.com` | 301 → `https://nxhguitar.com` | 只做跳转 |
| `http://` / `https://www.nxhguitar.com` | 301 → `https://nxhguitar.com` | 只做跳转 |

约定：

- 只保留 `https://nxhguitar.com` 一个业务 Origin；`www`、HTTP 一律 301 跳主站，避免登录态 / CORS / localStorage 分裂。
- 证书由 Certbot（Let's Encrypt）签发并自动续期，覆盖 `nxhguitar.com`、`www`、`api` 三个域名。
- 生产环境变量：Docker Compose 统一读取 `/root/player/.env`；本机直接跑后端时才读取 `backend/.env`。除非明确要在服务器宿主机直接执行后端 Node 进程，否则不要把服务器配置分散维护成两份。

```env
FRONTEND_URL=https://nxhguitar.com
NEXT_PUBLIC_API_BASE_URL=https://api.nxhguitar.com/api
CI_CALLBACK_SECRET=<数据万象回调密钥，见第 17 节>
```

- `NEXT_PUBLIC_API_BASE_URL` 是**前端构建时变量**，改完必须 `build frontend` 重建，否则浏览器仍用旧 API 地址。
- 云端 COS 桶 `gy-nodejs-study-1423556188` 的 CORS 必须放行 `https://nxhguitar.com`（改域名 / 上 HTTPS 后都要同步）。
- 站点元数据标题（`frontend/app/layout.js`）为：`能学慧吉他课堂笔记整理工具`。

部署、HTTPS 申请、Nginx、CORS、故障排查的完整记录见：

- [debug复盘/2026-09-20-服务器部署问题复盘.md](debug复盘/2026-09-20-服务器部署问题复盘.md)

### 3.2 服务器更新规则（当前生产三文件组合）

> 当前服务器保留 `docker-compose.local.yml` 提供既有 MinIO 等服务，最后加载 `docker-compose.production.yml` 覆盖后端为 `NODE_ENV=production`。不能只用 base + local，也不能直接删掉 local 而忽略服务、网络及存储卷。生产覆盖文件在服务器上创建；全新拉取或换机时必须检查其是否存在，不假定 Git 已包含它。

服务器生产覆盖文件至少应包含（不是本地试用配置）：

```yaml
services:
  backend:
    environment:
      NODE_ENV: production
      CONTENT_PRIVACY_MODE: business
```

`CONTENT_PRIVACY_MODE` 目前仅兼容/诊断，不再控制私密写入；不能用 development 绕过生产要求。

**普通代码更新（不包含待执行 schema 变更）**：

```bash
cd /root/player
# 先确认工作区，记录当前提交；有本地改动时先处理，禁止强制覆盖
git status --short
git rev-parse HEAD
git pull --ff-only gitee main

docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml build backend frontend
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml up -d --no-deps --force-recreate backend frontend
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1:3001
```

- 所有命令先进入 `/root/player`；在 `/root` 执行会找不到 compose 文件。
- 三份文件顺序固定，production 必须最后；项目名固定 `video_player`，避免误建另一套数据卷。
- 只改前端或后端可仅构建、重建对应服务。前端 `NEXT_PUBLIC_API_BASE_URL` 是构建期配置，改后必须重建前端镜像。
- 后端 `.env` 在容器创建时注入，改环境变量至少要重建容器，单纯 restart 不会更新环境；依赖/代码变化还需 build。
- 更新后检查 `docker exec video_player_backend printenv NODE_ENV` 返回 `production`，并检查日志、重启次数及域名入口；刚启动时短暂连接重置不等于发布成功，须等待就绪后复查。
- 禁止 `docker compose down -v`，禁止清空或改名 PostgreSQL/MinIO 卷；既有 `video_player_minio_data` 的归属警告不构成删卷理由。

**首次升级或存在 schema 变更时**：备份 → 拉取并构建新版镜像 → 隔离副本迁移演练 → 审阅派生状态变化 → 人工批准 → 正式迁移 → 重建服务。不要先启动新后端再补迁移。

本次需要关注两个显式脚本：

1. `backend/scripts/migrate-content-visibility.js --apply`：八表可见性（含两合集），重算课程及合集派生值；保留 P/附件已有私密状态。
2. `backend/scripts/migrate-auth-version.js --apply`：`admins` / `users.auth_version`，不重置已有账号密码、不注入业务数据。

使用**新版镜像的一次性任务**执行，例如（只能在备份、演练和审批完成后执行正式库命令）：

```bash
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml run --rm --no-deps backend node scripts/migrate-content-visibility.js --apply
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml run --rm --no-deps backend node scripts/migrate-auth-version.js --apply
```

运行前核对一次性任务的数据库连接确为预期目标；副本演练必须显式覆盖为隔离库，不能把上述正式库命令当成演练命令。两个脚本幂等不等于每次发布都需要执行；按当前 schema 和版本判断。禁止导入本地 dump、运行 reset/seed 或以初始化替代生产迁移。

**备份与回滚**：升级前保存 `pg_dump`、当前代码提交、根 `.env`、生产覆盖配置及可回退镜像标识；备份只放受控目录，不提交密钥。数据库备份不包含 COS/MinIO 文件，涉及文件操作另制定备份方案。普通代码故障可切回已记录且与当前 schema 兼容的版本重建；迁移后的数据库不能靠回退 Git 撤销。恢复数据库必须单独审批并确认会丢失备份之后的写入，禁止自动覆盖。

最近一次升级交接记录：提交 `24c9c32` 已同步双远端，服务器已完成副本演练、两项正式迁移及生产容器启动检查；备份目录 `/root/player-backups/20261118_012041`。这只证明部署与健康检查完成，不等同于浏览器、真机或真实 CDN 全量业务验收。

> **数据库迁移（重要，2026-10-29 曾因此线上 502）**：新后端启动时会校验 `visibility` 等 schema（fail-fast，绝不自动改生产库）。凡是新版本新增了 `backend/scripts/` 下的迁移脚本（如 `migrate-content-visibility.js`），**必须在重建后端容器之前先执行迁移**，否则后端会因 `VISIBILITY_SCHEMA_REQUIRED` 崩溃循环、Nginx 502。步骤见 [2026-10-29-生产部署502-VISIBILITY_SCHEMA_REQUIRED复盘.md](docs/debug复盘/2026-10-29-生产部署502-VISIBILITY_SCHEMA_REQUIRED复盘.md)。要点：
>
> - 生产容器名是全下划线（`video_player_backend` / `video_player_postgres`），先 `docker ps --format "{{.Names}}"` 确认。
> - 迁移前先 `pg_dump` 备份。
> - 迁移脚本可重复执行，但须确认运行环境包含**本次八表版本**；旧运行容器的六表脚本不会补齐合集字段。可用新版镜像的一次性迁移任务，或在postgres执行已审阅的本次等价SQL；不依赖崩溃中的后端容器。历史复盘SQL需与当前脚本比对，不能照抄旧版。

---

## 4. 样式架构与 CSS Module 规则

这是当前接手最容易踩坑的地方。

### 4.1 全局样式职责

全局样式分两层：

- [design-system.css](frontend/app/design-system.css)
  - 设计 token。
  - 公共设计系统类。
  - 跨页面复用结构：导航、卡片、网格、分页、弹层、格纹背景等。
- [globals.css](frontend/app/globals.css)
  - 只保留最小 reset。
  - 不要继续往里面堆页面样式。

### 4.2 新页面样式必须用 CSS Module

M6 收尾后已经明确：

- 新页面私有样式使用 `*.module.css`。
- 不要把页面私有样式继续追加进 [globals.css](frontend/app/globals.css)。
- 如果某个样式只服务单页，就放到该页同目录 CSS Module。
- 如果某个样式跨多个 PRD 页面复用，才考虑放进 [design-system.css](frontend/app/design-system.css)。

已经使用 CSS Module 的页面包括：

- [login.module.css](frontend/app/login/login.module.css)
- [home.module.css](frontend/app/home.module.css)
- [my-homework.module.css](frontend/app/my-homework/my-homework.module.css)
- [library.module.css](frontend/app/library/library.module.css)
- [library-book.module.css](frontend/app/library/[id]/library-book.module.css)
- [admin-library.module.css](frontend/app/admin/library/admin-library.module.css)
- [page.module.css](frontend/app/admin/classes/page.module.css)

### 4.3 CSS Module 故障排查

后面还有很多模块依赖 CSS Module，因此不要用“组件内写 `<style>`”作为长期方案。

如果页面出现裸 HTML：

1. 先确认组件是否正确 `import styles from './xxx.module.css'`。
2. 确认 JSX 使用的 `styles.xxx` 在 CSS Module 中真实存在。
3. 确认没有被全局样式覆盖。
4. 如果代码没问题但 dev server 显示异常，重启前端。
5. 必要时删除 [frontend/.next](frontend/.next) 后重新 `npm run dev`。

登录页曾出现裸 HTML，最终应保持 CSS Module 方案，不应绕开模块样式体系。

---

## 5. 本地启动、重置与测试数据

### 5.1 启动依赖

本地依赖由 Docker 提供，通常包括 PostgreSQL 和 MinIO。先确保 Docker Desktop 已启动。

### 5.2 隔离测试环境重置（破坏性，生产禁止）

> 以下 reset / seed / clean 仅用于已确认可丢弃的隔离测试库和测试桶。执行前核对真实连接目标；不要在生产服务器执行本节命令，正式业务库升级只能走第 3.2 节显式迁移。

```bash
cd backend
npm run test:reset
```

该脚本用于重置基础环境，当前会：

- DROP public schema 下旧表并重新建表。
- 清空对象存储桶。
- 执行 [ensureAppSchema](backend/src/db.js)。
- 初始化系统必需的基础账号 / 表结构。

注意：完整业务测试数据已迁移到 [test-data](test-data/) 独立目录维护，不再把 README 里的旧账号当作准。

### 5.3 注入 / 清理完整测试数据

本地常规用法：

```bash
cd test-data
node generate-assets.mjs
node seed.mjs
node clean.mjs
```

不提供生产服务器 seed / clean 示例，避免误操作正式库。隔离测试连接须自行配置；PostgreSQL 宿主机映射端口为 `15432`，容器网络内端口为 `5432`，不要混用，也不要复制文档示例密码到生产。

说明：

- `generate-assets.mjs` 生成封面、PDF、MP3 等静态素材。
- `seed.mjs` 新建普通教导主任、老师、学员、内容、图书馆、附件和作业历史。
- `clean.mjs` 按 `manifest.json` 精确清理 seed 生成的数据，不清理手工数据。
- `seed.mjs` / `clean.mjs` 通过 `test-data/runtime-config.mjs` 读取配置，兼容根目录 `.env`、`backend/.env`、`DATABASE_URL`、`DB_*` 和 `PG*` 变量。
- 新上传 / 新注入的 PDF 对象会写入 `Content-Disposition: inline`，网页端仅 PDF 显示“预览 + 下载”；MP3/JPG/PNG/ZIP 等其他附件只显示下载。
- 后端容器镜像不包含 `test-data/` 目录，不要进入 backend 容器执行 `node clean.mjs`。
- 系统自带超级管理员不由测试数据注入，seed 不创建、不修改、不清理该账号。

详细测试数据说明见：

- [test-data/README.md](test-data/README.md)
- [test-data/TEST_ACCOUNTS.md](test-data/TEST_ACCOUNTS.md)
- [debug复盘/2026-10-09-测试数据清理脚本环境变量问题复盘.md](debug复盘/2026-10-09-测试数据清理脚本环境变量问题复盘.md)

### 5.4 启动后端

```bash
cd backend
$env:PORT='3000'; npm start
```

健康检查：

```txt
http://localhost:3000/api/health
```

### 5.5 启动前端

```bash
cd frontend
$env:PORT='3001'; npm run dev
```

如果出现 Next dev 缓存错误，例如：

- `.next/server` 缺 chunk
- React Client Manifest 找不到模块
- `__webpack_modules__[moduleId] is not a function`
- 页面 HTML 已更新但 CSS Module 不生效

处理方式：停止前端 dev server，删除 `frontend/.next`，再重新启动前端。

---

## 6. 测试账号

测试数据账号以 [test-data/TEST_ACCOUNTS.md](test-data/TEST_ACCOUNTS.md) 为准；登录页左侧也有一个临时“测试账号”提示卡片，代码里已标注后续上线 / 交付前可整块删除。

当前所有演示账号密码统一为（测试环境统一演示密码，详见 [test-data/TEST_ACCOUNTS.md](test-data/TEST_ACCOUNTS.md)）：

```txt
<测试环境统一演示密码>
```

常用账号：

| 身份 | 登录账号 | 内部测试标识 | 昵称 | 来源 | 密码 |
|---|---|---|---|---|---|
| 初始超级管理员 | `admin` | `admin` | admin | 系统初始化 `ensureAppSchema` 仅在无超管时创建 | `<测试环境统一演示密码>` |
| 普通教导主任 / 普通管理员 | `13900000002` | `dean_yuhan` | 教务雨涵老师 | `test-data/seed.mjs` 注入 | `<测试环境统一演示密码>` |
| 老师 | `13900000011` | `teacher_luxiang` | 鲁祥老师 | `test-data/seed.mjs` 注入 | `<测试环境统一演示密码>` |
| 老师 | `13900000012` | `teacher_yuanyuan` | 缘缘老师 | `test-data/seed.mjs` 注入 | `<测试环境统一演示密码>` |
| 老师 | `13900000013` | `teacher_zhangning` | 张宁老师 | `test-data/seed.mjs` 注入 | `<测试环境统一演示密码>` |
| 内部测试学员 | `13776186160` / `13013811119` / `18362776877` / `13382800426` | `internal_student_yuhan` / `internal_student_luxiang` / `internal_student_zhangning` / `internal_student_yuanyuan` | 学生雨涵 / 学生鲁详 / 学生张宁 / 学生缘缘 | `test-data/seed.mjs` 注入（能学慧内部测试班，账号表置顶） | `<测试环境统一演示密码>` |
| 学员 | `13800001001` ~ `13800001016` | `test_student_01` ~ `test_student_16` | 见账号表 | `test-data/seed.mjs` 注入 | `<测试环境统一演示密码>` |

口径说明：

- 普通教导主任、老师、学员的产品登录账号优先使用手机号 / 纯数字账号。
- 初始超级管理员账号是 `admin`，不由 `test-data` 注入。启动初始化只在**库中不存在任何 `super_admin`** 时创建它；如果已经存在超管（无论是否改过密码），启动过程不覆盖、不改密码。
- `username = admin` 且 `role = super_admin` 的默认超管账号**禁止删除**，接口会返回「默认教导主任账号不可删除」。
- `seed.mjs` 只负责注入普通教导主任、老师、学员和业务测试数据；`clean.mjs` 按 `manifest.json` 精确清理 seed 数据，不清理初始超级管理员。
- 已有线上存量业务数据，不再采用“上线前清空重建”的旧约定；测试账号清单仅用于隔离测试环境，不代表线上账号或密码。新建学员初始密码服务端固定为 `Nxh123456`，可选择“暂不分班”（`class_id=null`）；不追溯重置已有账号，不改变老师/教导主任的创建密码规则。

密码策略已接入：Web头像菜单与小程序“我的”支持本人凭旧密码改密；班级管理仅 root/教导主任可替权限范围内的其他账号重置为固定 `Nxh123456`，唯一 `admin` 禁改。密码变更原子递增 `auth_version`，旧 Cookie/Bearer 会话失效。首次部署必须备份并执行 `backend/scripts/migrate-auth-version.js`，再重建服务；不含版本字段的旧Token需要重新登录。隔离数据库真实HTTP集成34项检查通过（历史实施结果，非本次重新测试）；双端交互由用户验收，不能视为已完成真机验收。后端回归测试使用Node 22时须加 `--experimental-test-module-mocks`（测试使用 `mock.module`），不能只执行 `node --test`。详见 [实施计划与交接记录](docx/用户自助改密与固定密码重置实施计划.md)。

登录页：

```txt
http://localhost:3001/login
```

游客入口应进入 `/tracks`。

---

## 7. 当前阶段状态

M0–M9 均已完成，当前进入整体回归修 bug 阶段。

### 已完成里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 | 已完成 | 清理、初始化、新表结构、重置测试环境 |
| M1 | 已完成 | 权限基础设施、停用账号、前置关系、媒体关联 |
| M2 | 已完成 | 设计系统基建、AppNav、ContentCard、公共组件 |
| M3 | 已完成 | 曲目区、曲谱集、曲目详情、曲谱集详情、曲目后台创建 |
| M4 | 已完成 | 知识点区、知识点集、知识点详情、知识点后台创建 |
| M5 | 已完成 | 作业推送扩展，支持合集、单对象、单 P |
| M6 | 已完成 | 权限页面、停用账号行为、班级管理、弹层交互、样式架构收尾 |
| M7 | 已完成 | 图书馆、PDF 详情、后台 PDF 上传、关联资料展示 |
| M8 | 已完成 | 学员首页、我的历史作业、停用学员文案和历史快照 |
| M9 | 已完成，正在回归修 bug | 清理旧页面、退役旧 `/videos` 前端页面、逐页对照设计稿修复 |

### 当前重点

当前工作重点：

- 按 HTML 设计稿逐页比对。
- 修复视觉偏差。
- 修复角色差异。
- 修复页面跳转、编辑、删除、悬停操作等 bug。
- 清理旧“视频播放器”残留。
- 使用 `test-data` 大体量数据回归：20 单曲 / 5 曲谱集、20 单知识点 / 5 知识点集、多附件、图书馆继承关联并集、8 天作业历史。

不要随意发明 UI。设计稿有角色预览时，必须按角色预览实现。

### 最近状态补充

- 曲目区 / 知识点区首页已按一屏布局收敛：合集超过 1 行分页，单课 / 单知识点超过 2 行分页，页面使用 `body.library-index-page` 锁定高度避免整页滚动。
- 新建单曲目、单知识点、曲谱集、知识点集成功后会直接跳到对应详情页。
- 登录页已新增左侧独立测试账号卡片；管理员登录文案使用“用户名 / 账号”，显示密码按钮使用内联 SVG，避免图标偶发消失。
- 头像下拉菜单已修复 hover 断层，鼠标从头像移到菜单不会立即消失。
- 学员管理 / 班级管理已把当前选择同步到 URL 参数，刷新后应恢复到原学员 / 原班级。
- 学员管理会保存学生列表和历史列表滚动位置，刷新或切换后尽量恢复原滚动位置。
- 学员管理列表单击学生卡片即可选中，不需要双击。
- 学员管理页仅保留“标记学生”和作业相关操作；重置密码、停用 / 恢复、删除等账号管理操作统一放在班级管理页。
- 老师端和学生端历史作业均按推送时标题快照展示，历史记录不再作为跳转入口；搜索支持标题、练习要求、提交要求。老师端历史区有“回到顶部”。
- 站点元数据标题已改为 `能学慧吉他课堂笔记整理工具`（`frontend/app/layout.js`），不是导航栏名称。
- 公安备案审核期间的临时配置（未登录首屏游客曲目区、登录页审核提示）**已全部恢复**，现在未登录访问 `/` 会正常跳转 `/login`。相关记录见 [debug复盘/2026-09-29-公安备案审核临时配置说明.md](debug复盘/2026-09-29-公安备案审核临时配置说明.md)。
- 视频播放器控制栏已重构为：`上一P` / 播放暂停 / `下一P` / 进度条 / 时间 / 画质 / 倍速 / 全屏。上一P、下一P 由详情页传入，切换的是当前曲目 / 知识点的 P，不会跨对象跳转。
- 图书馆详情页已修复被全局样式撑高的拉伸问题，图书馆列表翻页器也已统一为与知识点区一致的样式，见第 9 节。
- 正在接腾讯云数据万象（CI）自动转码：曲目 / 知识点 P 上传后自动产出 720p、1080p 两档，播放器画质菜单可切换，详见第 17 节。

---

## 8. 测试数据覆盖范围

完整测试数据位于 [test-data](test-data/)：

- 账号：1 个普通教导主任、3 个老师、4 个常规测试班级 × 4 名学员 + 1 个「能学慧内部测试班」4 名内部测试学员；常规班级的第 3、8、13、16 名学员为停用状态。
- 曲目区：20 个单曲目 + 5 个曲谱集；单曲按 1~4 个 P 分布，部分单曲加入多个合集。
- 知识点区：20 个单知识点 + 5 个知识点集；单知识点按 1~4 个 P 分布，部分知识点加入多个合集。
- 附件：覆盖 MP3、JPG、PDF；曲目、曲目合集、知识点、知识点集均有样例附件，部分对象有多个附件。
- 图书馆：6 本 PDF 资料，分别关联单曲目、曲目合集、单知识点、知识点集。
- 并集测试：部分单曲 / 单知识点与其所属合集同时有关联图书馆资料，详情页应展示“直接关联 + 合集继承关联”的并集，不能漏项或重复。
- 作业历史：每名学员固定 8 天作业推送，日期为 `2026-09-10` ~ `2026-09-17`；每次推送 1~5 个内容，覆盖合集、单对象、具体分 P；同一视频可跨日期重复推送。
- 文案滚动：练习要求与提交要求均为超长文本，用于测试三行限制和内部滚动。

## 9. 最近已处理的回归问题

### 曲目区首页

文件：

- [tracks/page.js](frontend/app/tracks/page.js)
- [ContentCard.js](frontend/components/ui/ContentCard.js)
- [design-system.css](frontend/app/design-system.css)

已修复：

- 按 [tracks-home.html](docs/design/guitar-home/tracks-home.html) 恢复上下分区。
- 上区为曲谱集，下区为曲目。
- 教导主任新建按钮在各区块标题右侧，不在导航右侧。
- 卡片悬停显示查看详情 / 编辑 / 删除。
- 删除使用设计稿弹层，不用原生 `confirm`。
- 恢复下浓上淡的棕色格纹底图。
- 修复卡片操作按钮嵌套在整张 Link 里的结构问题。

### 知识点区首页

文件：

- [knowledge/page.js](frontend/app/knowledge/page.js)
- [admin/knowledge/page.js](frontend/app/admin/knowledge/page.js)

已修复：

- 按 [knowledge-home.html](docs/design/guitar-home/knowledge-home.html) 跑完和曲目库一致的流程。
- 上区为知识点集，下区为知识点。
- 教导主任新建按钮在各区块标题右侧。
- 卡片悬停显示查看详情 / 编辑 / 删除。
- 删除使用设计稿弹层。
- 修复知识点集编辑入口：`/admin/knowledge?type=collection&id=...` 会加载已有知识点集。

### 登录页

文件：

- [LoginForm.js](frontend/app/login/LoginForm.js)
- [login.module.css](frontend/app/login/login.module.css)

当前状态：

- 登录主卡片右侧展示，测试账号提示卡片在左侧独立展示，并带框内滚动。
- 测试账号卡片由 `TEMP_TEST_ACCOUNTS` 维护，代码注释已注明“上线或交付前删除”。
- 超管账号：`admin` / `<测试环境统一演示密码>`；其余演示账号由 `test-data/seed.mjs` 注入。
- 登录表单文案使用“用户名 / 账号”，避免把初始超管误认为必须用手机号登录。
- 密码可见性按钮使用内联 SVG。

注意：登录页必须继续使用 CSS Module。曾经出现裸 HTML，多半与 CSS Module 映射 / dev 缓存 / M9 清理全局样式后的中间状态有关。不要改成组件内 `<style>` 长期方案。

### 学员管理 / 班级管理

文件：

- [admin/users/page.js](frontend/app/admin/users/page.js)
- [admin/classes/page.js](frontend/app/admin/classes/page.js)

当前状态：

- 学员管理刷新后通过 `?user=` 恢复选中学员；班级管理刷新后通过 `?class=` 恢复选中班级。
- 学员管理保存学生列表滚动和每个学员历史列表滚动，刷新后尽量回到原位置。
- 学员列表优先显示昵称，账号作为辅助信息。
- 选中学生使用单击；同步 URL 使用浏览器 history，不通过路由跳转打断选中状态。
- 学员管理页不再承担重置密码、停用 / 恢复、删除账号操作；这些账号操作统一在班级管理页处理。
- 学员历史作业支持按标题 / 练习要求 / 提交要求搜索，老师端历史区提供“回到顶部”。

### 图书馆区（详情页 + 翻页器）

文件：

- [library/[id]/page.js](frontend/app/library/[id]/page.js)
- [library/[id]/library-book.module.css](frontend/app/library/[id]/library-book.module.css)
- [library/page.js](frontend/app/library/page.js)

已修复：

- 详情页曾被全局 `.detail` 类污染导致排版错乱：页面外层改为使用 CSS Module 私有类 `styles.bookDetail`，不再复用全局 `.detail`。
- 详情页被 flex 拉伸：改为自然高度 —— `.bookDetail{align-items:start}`、`.binfo{min-height:0}`、`.bsec{flex:none}`，简介区固定 `max-height:140px` 内部滚动。
- 图书馆列表翻页器替换为与知识点区一致的数字分页（`‹ 1 2 3 … ›`）。

### 播放器控制栏

文件：

- [VideoPlayer.js](frontend/components/VideoPlayer.js)
- [design-system.css](frontend/app/design-system.css)
- [tracks/[id]/page.js](frontend/app/tracks/[id]/page.js)
- [knowledge/[id]/page.js](frontend/app/knowledge/[id]/page.js)

当前状态：

- 控制栏顺序固定为：`上一P` → 播放 / 暂停 → `下一P` → 进度条 → 时间 → 画质 → 倍速 → 全屏。
- 已去掉此前无效的快进 / 快退按钮；上下 P 使用竖向分隔条 + 三角的内联 SVG，图标不再出现“奇怪”的观感。
- `VideoPlayer` 新增 `onPrev` / `onNext` 两个 prop，为空时按钮置灰不可点；由详情页计算相邻 P 并传入。
- 画质菜单来自 `renditions` prop（见第 17 节），无转码档位时只显示原画。
- 进度条与按钮间距在 `design-system.css` 的 `.vctrl` / `.pbar` / `.ibtn` 中统一，不要再单独塞回 `.seek-btn` 之类的一次性类。

---

## 10. 关键页面清单

当前逐页修 bug 应优先检查这些页面：

```txt
/login
/tracks
/tracks/:id
/tracks/collections/:id
/knowledge
/knowledge/:id
/knowledge/collections/:id
/library
/library/:id
/admin/tracks
/admin/tracks/collections
/admin/knowledge
/admin/users
/admin/classes
/admin/library
/
/my-homework
```

每个页面都要对照：

- PRD 角色权限。
- 对应 HTML 设计稿。
- 设计稿里的角色预览。
- AppNav 角色矩阵。

---

## 11. AppNav 角色矩阵

按 PRD §3：

| 角色 | 导航入口 |
|---|---|
| 游客 | 曲目区、知识点区、图书馆 |
| 学员 / user | 首页、曲目区、知识点区、图书馆、我的历史作业 |
| 老师 / teacher | 曲目区、知识点区、图书馆、学生管理 |
| 教导主任 / super_admin | 曲目区、知识点区、图书馆、学生管理、班级管理 |

游客不应看到作业记录 / 我的历史作业。

---

## 12. 作业推送关键规则

M5 已完成，后续修 bug 时不要破坏这些规则：

- 作业绑定稳定身份 `object_type + object_id`；分 P 使用真实 `part_id`，兼容旧数据 `COALESCE(part_id, object_id)`。P 序号和 URL 都不是作业身份，不能存“P2”或播放地址代替 ID。
- 今日作业与老师回填显示目标的当前名称、封面、P 序号；改名、换封面、移动 P 不影响关联。
- 目标删除或改私密：今日作业保留原位灰框，标题精确为“此资料已经被老师更改”，无封面、无导航；点击完全无响应，无 Toast、无弹窗。
- 老师“回填上次作业”使用 `/api/admin/users/:userId/assignments/latest` 按稳定 ID 回填，过滤失效目标；整批目标失效仍保留该批练习/提交要求，不回退旧批次。恢复公开后，下次查询恢复显示和回填。
- Web focus / visibilitychange、小程序 onShow 刷新状态；可用卡片点击另走导航复核，异步回调需做页面存活及请求版本保护。
- 支持合集、单对象、单 P。
- 单 P 标题必须是：`单课名-P名` / `单知识点名-P名`。
- 分隔符是半角 `-`。
- 学员首页的“今日 / 当前作业”仍可作为学习入口，单 P 点击进入父详情页并带 `?part=`。
- 搜索 placeholder 必须是：`搜索合集 / 单课 / 单 P 名称…`
- 老师每次可给学生推送 1~5 个内容。
- 昨天推送过的视频 / 内容，今天仍可继续推送，不受历史记录影响。
- 删除作业 / 历史记录必须填写原因。
- 老师只能推送给自己班级里的学员，后端必须强校验。
- 老师端 / 学生端历史作业必须使用推送时标题快照：优先 `assigned_object_title`，再用 `assigned_video_title`，缺失时显示“已删除内容”。
- 历史作业页只做记录浏览，不做内容跳转；视频或内容被删除后，历史标题仍必须保留。
- 历史作业搜索范围包括：推送内容标题、练习要求、提交要求。
- 新作业字段使用 `practice_requirement`、`submit_requirement`；旧 `message` 仅保留历史兼容，不作为新页面输入。

---

## 13. 旧实现与清理注意事项

旧前端 `/videos` 页面应视为已退役方向。不要继续开发旧视频首页。

保留但不要误删：

- [VideoPlayer.js](frontend/components/VideoPlayer.js)
  - 这是曲目 P / 知识点 P 的复用播放器组件。
- [uploadVideo.js](frontend/components/uploadVideo.js)
  - 这是 P 分段上传 helper。
- [videos.routes.js](backend/src/videos.routes.js)
  - 后端视频上传、存储、清晰度、转码基础设施仍被 P 分段使用。

不要把“旧 `/videos` 前端页面”与“仍需要的视频基础能力”混为一谈。

---

## 14. 开发纪律

1. 每次开工先读 PRD 对应章节和设计稿。
2. 前端页面必须逐块对照设计稿，不接受“风格接近”。
3. 设计稿里有角色预览，就必须核对不同角色显示差异。
4. 注意：CSS 数学函数里不能照抄 `min(..., 1fr)`。`1fr` 不能出现在 `min()` 内，会导致浏览器丢弃整条声明并破坏布局；详情页两列布局应使用 `minmax(0, calc(...)) 260px`。
5. 不要自己发明 UI、文案、按钮位置。
6. 新页面私有样式用 CSS Module。
7. 不要继续往 [globals.css](frontend/app/globals.css) 堆页面样式。
8. 跨页面复用样式才放 [design-system.css](frontend/app/design-system.css)。
9. 不要重写分片上传，调用 [uploadVideo.js](frontend/components/uploadVideo.js) 现有能力。
10. 不要修改 [storage.js](backend/src/storage.js) 的核心对象存储流程，除非 PRD 明确要求。
11. 保留存量数据；字段升级先备份及隔离演练再迁移，不沿用M0清空重建约定。
12. 写接口必须后端鉴权，前端隐藏入口不算安全。
13. 后续启动端口固定：后端 `3000`，前端 `3001`。
14. 涉及服务器部署、生产 COS、生产环境变量、线上端口和反向代理配置时，不要凭猜测改 README 或配置；必须以当前部署文档 / 运维确认信息为准。

---

## 15. 快速验证清单

后端健康检查：

```txt
http://localhost:3000/api/health
```

前端页面：

```txt
http://localhost:3001/login
http://localhost:3001/tracks
http://localhost:3001/knowledge
http://localhost:3001/library
http://localhost:3001/admin/tracks
http://localhost:3001/admin/knowledge
http://localhost:3001/admin/users
http://localhost:3001/admin/classes
```

前端构建：

```bash
cd frontend
npm run build
```

后端常用接口验证：

```txt
GET /api/health
GET /api/tracks
GET /api/knowledge
GET /api/library
POST /api/auth/login
POST /api/admin/login
```

---

## 16. 线上运维速查

服务器：`/root/player`（Docker Compose，项目名 `video_player`）。

容器与日志：

```bash
cd /root/player
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml ps
docker logs --tail=150 video_player_backend
docker logs --tail=150 video_player_frontend
```

健康检查与域名验证：

```bash
curl http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1:3001
curl -I https://nxhguitar.com
curl -I https://www.nxhguitar.com
curl https://api.nxhguitar.com/api/health
```

Nginx：

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo tail -n 100 /var/log/nginx/error.log
```

数据库：

```bash
docker exec -it video_player_postgres psql -U postgres -d video_player -c "\dt"
docker exec -it video_player_postgres psql -U postgres -d video_player -c "SELECT COUNT(*) FROM track_points;"
```

端口占用：

```bash
sudo ss -tnlp | grep -E ':80|:3000|:3001'
docker ps --filter publish=3000 --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}"
```

完整排障手册（DNS、Certbot、CORS、端口冲突、www 跳转）：

- [debug复盘/2026-09-20-服务器部署问题复盘.md](debug复盘/2026-09-20-服务器部署问题复盘.md)

---

## 17. 视频清晰度与自动转码（腾讯云数据万象 CI）

### 17.1 目标与现状

- 每个 P（曲目 P / 知识点 P）上传后自动产出 **720p / 1080p** 两档，播放器画质菜单可切换，默认优先 1080p。
- 前端播放器是原生 `<video>` **直接播 MP4**，没有接 hls.js，因此**只使用 MP4 转码模板，不要选 HLS 系列**（选了也播不了，需要先改造前端）。
- 数据模型沿用现有表，**不需要新建表**：
  - `videos`：统一视频实体，曲目 P、知识点 P 都指向它（`track_parts.video_id` → `videos.id`）。
  - `video_renditions`：`source` / `720p` / `1080p` 三档，上传时预置 `processing` 状态。

### 17.2 数据流

```txt
前端分片上传
  -> COS: tracks/<曲目id>/<uuid>.mp4 或 knowledge/<知识点id>/<uuid>.mp4
  -> CI 工作流（输入路径 tracks/ 或 knowledge/）自动触发
  -> 输出: tracks/<曲目id>/<uuid>-720p.mp4、tracks/<曲目id>/<uuid>-1080p.mp4
          或 knowledge/<知识点id>/<uuid>-720p.mp4、knowledge/<知识点id>/<uuid>-1080p.mp4
  -> CI 工作流完成回调: POST https://api.nxhguitar.com/api/videos/transcode/callback?token=<CI_CALLBACK_SECRET>
  -> 后端解析 WorkflowExecution.Tasks[].ResultInfo.ObjectInfo[] -> 源文件 key 反查 videos.id -> 写 video_renditions 对应档位为 ready + 转码地址
```

### 17.3 控制台配置要点（两个工作流）

| 项目 | tracks 工作流 | knowledge 工作流 |
|---|---|---|
| 输入路径 | `tracks/` | `knowledge/` |
| 上传触发执行 | 开启 | 开启 |
| 720p 节点输出路径 | `${InputPath}` | `${InputPath}` |
| 1080p 节点输出路径 | `${InputPath}` | `${InputPath}` |
| 输出文件名 | `${InputName}-720p.${ext}` / `${InputName}-1080p.${ext}` | 同左 |
| 模板 | H264-MP4-高清（1280px）/ H264-MP4-全高清（1920px） | 同左 |
| 回调 | 自定义回调配置 + HTTP 回调，格式 **JSON**，勾「工作流完成回调」 | 同左 |

必须注意：

- 输入路径**结尾必须带斜杠**（`tracks/`）；**留空表示整桶生效**，会把封面、附件和转码产物一起卷进来，形成循环转码刷费用。
- 转码节点输出路径保持 `${InputPath}`：控制台实测 `${InputPath}` 已包含完整源目录（如 `tracks/25/`），不要写 `tracks/${InputPath}` 或 `knowledge/${InputPath}`，否则会生成 `tracks/tracks/...` / `knowledge/knowledge/...`。
- 两个节点必须使用不同文件名：`${InputName}-720p.${ext}` / `${InputName}-1080p.${ext}`，不要使用同名输出，避免互相覆盖。
- 文件名必须使用连字符 `-720p` / `-1080p`；后端会拒绝 `_720p` / `_1080p` 这类非当前约定产物。
- 两个节点都关闭「闲时转码」（闲时资源最长 72 小时才处理，教学场景等不起）；倍速转码、水印保持关闭。
- 工作流默认关闭，保存后需**启用**，约 5 分钟生效；**启用状态下不能编辑**，要改先暂停。
- 存量视频不会自动转码，需要在工作流里用「测试 / 创建执行实例」手动触发，可分批做。

### 17.4 后端实现位置

| 文件 | 职责 |
|---|---|
| [transcode.js](backend/src/transcode.js) | `parseCiWorkflowCallbackPayload` 解析工作流完成回调真实结构 `WorkflowExecution.Tasks[].ResultInfo.ObjectInfo[]`；`resolveTranscodeQuality` 按产物路径 / 画面长边判定档位；`isAllowedCiOutputKey` 校验产物必须与源视频同目录且文件名为 `原名-720p/-1080p`；`findVideoIdBySourceKey` 用源 key 反查 `videos.id`；`verifyCiCallbackRequest` 校验回调身份 |
| [videos.routes.js](backend/src/videos.routes.js) | `POST /api/videos/transcode/callback`：验签 → 解析工作流任务 → 反查视频 → HeadObject 确认产物存在 → 写档位状态；失败写 `failed`，无效产物返回 400 便于排查 |
| [storage.js](backend/src/storage.js) | `publicKeyPrefixes` 允许 `tracks/` / `knowledge/` / `transcoded/` 等公开视频 key 生成公开地址 |

回调安全策略（重要）：

- 密钥来自环境变量 `CI_CALLBACK_SECRET`（服务器根目录 `/root/player/.env`；`docker-compose.yml` 的 backend 用这个文件；本地直接跑后端时读 `backend/.env`）。
- **未配置密钥时回调接口一律拒绝**（返回 503），不会像旧实现那样「没配密钥就放行」——那个写法等于任何人构造一个 POST 就能伪造回调。
- 回调 URL 用 `?token=<CI_CALLBACK_SECRET>` 传密钥（CI 控制台没有密钥配置项）；另保留 HMAC 签名头校验分支备用。
- 额外防御：产物 key 必须满足“源目录同级 + 原文件名后追加 `-720p/-1080p`”，或兼容旧 `transcoded/` 前缀；并用 HeadObject 确认产物确实存在（只有 404 才拒绝，网络抖动类异常放行不丢结果）。

配好后验证：在工作流手动跑一个 `tracks/` 下的小视频，后端日志应出现 `[ci-callback-job]` 且包含非空 `outputKey` 与 `quality`，随后出现“已登记转码结果”；桶里应出现 `tracks/<曲目id>/<uuid>-720p.mp4` 与 `tracks/<曲目id>/<uuid>-1080p.mp4`，播放页画质菜单能看到并切换 720P / 1080P。

排查命令：

```bash
cd /root/player

docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml logs --tail=300 backend | grep -i ci-callback

docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml exec postgres \
psql -U postgres -d video_player -c "SELECT video_id, quality, status, video_url, file_size, updated_at FROM video_renditions WHERE video_id = <视频ID> ORDER BY quality;"
```

控制台逐步操作指南与问题复盘：

- [debug复盘/2026-10-01-腾讯云数据万象转码接入操作指南.md](debug复盘/2026-10-01-腾讯云数据万象转码接入操作指南.md)
- [debug复盘/2026-10-04-数据万象工作流回调与清晰度不显示复盘.md](debug复盘/2026-10-04-数据万象工作流回调与清晰度不显示复盘.md)

---

## 18. CDN / COS 交接与故障定位

- 数据库存 COS 源地址，响应额外提供 CDN 播放字段；默认 COS 域名 `gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com`，CDN 域名 `media.nxhguitar.com`。`backend/src/playback-url.js` 仅精确转换默认源，保留路径/查询；带签名参数或其他域名不盲目改写。
- `MEDIA_CDN_ENABLED` 默认开启，false/0/no/off 关闭转换；本地 MinIO 不会因此自动走线上 CDN。
- Web/小程序优先 CDN，出错回退同一视频、同一清晰度 COS，保留播放位置/播放状态，避免循环回退。不要覆盖数据库源地址或回退到无关档位。
- 已移除视频 TypeA 短签及 `MEDIA_CDN_AUTH_*` 启动强校验；兼容 play-url 端点做权限检查但返回正常源。附件/图书馆下载签名仍保留，不能混为一谈。
- 业务私密不要求桶私有化、CDN 鉴权、文件加密或旧直链撤回。已知直链和下载不可追回；不能因页面隐藏就承诺文件级保密。
- 云端配置不会随代码自动变化：若控制台仍强制旧 TypeA，普通地址可能 403。核对后再调整，不声称本轮已核验控制台，也不要盲目私有化整桶导致封面/PDF/附件失效。

排障顺序：

1. 对比接口 COS/CDN 完整路径、档位与 HTTP 状态；不要把签名参数、回调 token 或密钥写入公开问题单。
2. COS 也 404：检查 key、上传结果、CI 转码和数据库档位。COS 正常而 CDN 403/404：检查 CDN HTTPS 证书、源站/回源权限、防盗链、残留 TypeA、边缘负缓存，必要时精确刷新故障 URL。
3. COS 403：核对桶/对象策略、签名和请求要求，不用切 development 掩盖。
4. 浏览器独有问题：查 HTTPS 混合内容、COS/CDN CORS、Content-Type、Range/206；COS CORS 放行 `https://nxhguitar.com`，以实际上传/播放请求核对。
5. 小程序独有问题：查 request/downloadFile 合法域名、CDN 与 COS 回退域名、证书和真机网络。关闭开发工具校验不能代替正式配置。
6. 播放有原画但无清晰度：查 CI 回调和 video_renditions，见第 17 节，不直接归因 CDN。

更多实现位置与测试约束见 [backend/README.md](backend/README.md)。小程序默认连线上，本地 3000/真机局域网联调及独立上传发布流程见 [README-miniprogram.md](README-miniprogram.md)。Docker 更新不会自动发布小程序。

## 18A. 近期变更记录

| 日期 | 内容 |
|---|---|
| 2026-09-29 | 完成 HTTPS 域名部署（`https://nxhguitar.com` 唯一业务入口，www / HTTP 301 跳转），流程写入部署复盘 |
| 2026-09-29 | 公安备案审核临时配置（未登录游客视图 + 登录页审核提示） |
| 2026-10-01 | 公安备案通过，临时配置全部恢复，未登录正常跳转 `/login` |
| 2026-10-01 | 新增腾讯云数据万象转码接入操作指南 |
| 2026-10-03 | 播放器控制栏改为 上一P / 播放 / 下一P 布局；默认超管仅在无超管时创建且禁止删除；`prerequisites` 视频封面字段改用 `cover_url` 修复详情页 500；实现数据万象转码回调（真实报文解析 + 回调密钥校验 + `transcoded/` 公开地址） |
| 2026-10-04 | 数据万象转码产物改为输出到源目录同级（`${InputPath}` + `${InputName}-720p/-1080p.${ext}`），修复工作流完成回调真实结构 `WorkflowExecution.Tasks[].ResultInfo.ObjectInfo[]` 解析，解决 COS 已生成转码文件但前端只显示原画的问题 |
| 2026-10-28 | 分 P 公开/私密权限（后端 A–E 阶段）：`visibility` 字段与 `CONTENT_PRIVACY_MODE` 开关、课程公开性派生、前置/作业的私密资格校验、视频短期签名授权、`visibility_revocations` 撤销审计表。详见第 19 节 |
| 2026-10-29 | 分 P 公开/私密权限（前端 F 阶段）：管理端曲目/知识点编辑页新增「公开/私密」切换按钮（分 P + 附件），报错提示带内容标题，修复合集封面叠层装饰误叠加、开关双重线框与高饱和配色问题 |
| 2026-10-30 | 业务可见性方案收敛：已布置/已有前置目标允许改私密；附件独立私密、图书馆无私密（旧交互方案已被最新静默灰框规则替代） |
| 2026-10-31 | 轻量实现阶段 A：新增合集 `visibility` 列 + 八表迁移 + schema 门禁，课程→合集派生刷新 helper；私密写入不再依赖 `CONTENT_PRIVACY_MODE`，前置维护允许私密目标 |
| 2026-11-03 | 媒体改为有权限 P 正常 COS 源 + CDN，移除 TypeA 签名及启动强校验，停止改私密撤销调用；新增双端导航资格复核 |
| 2026-11-17 | 自助改密、固定密码重置、auth_version 会话失效、学员固定初始密码/暂不分班、双端作业稳定关联与静默失效恢复完成；提交 `24c9c32` 同步 Gitee/GitHub |
| 2026-11-18 | 服务器完成副本迁移演练、八表 visibility 与 auth_version 正式迁移；三文件生产覆盖、后端健康及前端 HTTP 200 检查通过。浏览器/真机交互仍由用户验收 |

> 说明：2026-10-28 / 10-29 两条记录的是**最初「模式门禁」版本**的实现（当时 `CONTENT_PRIVACY_MODE` 仍作为开关、改私密会触发撤销）。2026-10-31 起已收敛为轻量业务可见性：`CONTENT_PRIVACY_MODE` 仅保留兼容、不再门禁，详见第 19 节。

---

## 19. 分 P 公开 / 私密权限（轻量业务可见性）

> 本节约 2026-10-28/29 最初的「模式门禁」设计做了大幅收敛：公开/私密已是常规业务能力，
> `CONTENT_PRIVACY_MODE` 仅保留为兼容/诊断变量、不再门禁；有权限内容统一走正常
> CDN/COS 源，不再强制私密短签 / TypeA / 改私密即撤销。变更时间线见第 18A 节。
> 下列说明区分可信度：① **本地代码已实现**（单测 / 本地 Docker 验证通过）；
> ② **本地逻辑/方向约定**（代码已落地但仅本地验证）；③ **线上未独立核验**
> （COS/CDN/生产库），不能据本地试用声称线上验收通过。

当前本地代码的轻量业务可见性口径：

- **P 决定课程**：单曲目/单知识点的可见性由「是否存在至少一个公开 P」派生，写入课程 `visibility` **派生列**（非独立手动开关；每次 P 增删改后在事务内刷新）。
- **课程决定合集**：曲谱集/知识点集的可见性由「是否包含至少一个公开课程（且含公开 P）」派生，写入合集 `visibility` 列（迁移脚本新增，刷新逻辑见 `content-visibility.js` 的 `refreshCollectionVisibility` / `refreshCollectionsForCourse`）。
- **附件独立**：附件（曲目/知识点/视频附件）有独立 `visibility`，不参与课程/合集派生；私密附件仅有效老师/教导主任可授权下载。
- **图书馆无私密**：`library_resources` 无 `visibility`，不受公开/私密体系约束。
- **游客/学员只看公开**；老师/教导主任可看私密，但私密内容**不可作为作业布置目标**。

### 19.1 数据模型与字段

| 表 | 字段 | 说明 |
|---|---|---|
| `track_parts` / `knowledge_parts` | `visibility` | `public` / `private`，P 级开关（源头） |
| `track_points` / `knowledge_points` | `visibility` | **派生列**，由公开 P 刷新（有公开 P 即 `public`，否则 `private`） |
| `track_collections` / `knowledge_collections` | `visibility` | **派生列**（迁移新增），由成员课程的派生可见性刷新 |
| `content_attachments` / `video_attachments` | `visibility` | 附件级独立公开/私密，不参与课程/合集派生 |
| `library_resources` | — | 无私密字段 |
| `visibility_revocations` | — | **历史审计表保留**，但「改私密即记录待撤销直链」的调用已移除，不再据其声称已删除/撤回已签短链或已下载内容 |

合集有落库的派生 `visibility` 字段；前置关系、作业不新增独立 `visibility`，读取时按目标当前可见性判断。

### 19.2 部署模式开关（已收敛为兼容变量）

环境变量 `CONTENT_PRIVACY_MODE` **已不再作为任何门禁**。`content-privacy-config.js` 的
`assertPrivateWriteAllowed` 只做可见性取值合法性校验、不再拦截 `private`；`validatePrivacyConfiguration`
固定返回 `'business'`。该变量仅保留作诊断/兼容用途，生产部署**无需**设置它来「开启」私密。

> 历史遗留值（`off` / `business` / `local-preview` / `enforced`）在代码里已无意义，不再区分行为。
> 若旧部署文档仍要求设置 `CONTENT_PRIVACY_MODE=business`，可保留但属多余。

业务私密：上传/编辑流程不变，仅保存 `visibility`；有效老师/管理员可读取私密，学生/游客不可读取，
由后端角色/权限校验负责。前置维护允许私密目标引用；「改私密」不再被前置引用阻断（旧 409 引用阻断已取消）。

### 19.3 关键后端实现（当前）

| 文件 | 职责 | 状态 |
|---|---|---|
| `content-visibility.js` | `deriveCourseVisibility` / `refreshCourseVisibility`（P→课程派生并落库）、`refreshCollectionVisibility` / `refreshCollectionsForCourse`（课程→合集派生并落库） | ① 已实现 |
| `content-object-access.js` | `canReadContentObject`（访客视角判定公开可读性）、`canAssignContentObject`（作业资格：私密不可布置）、`canMaintainPrerequisite`（前置维护：允许私密目标，不 bypass 角色） | ① 已实现 |
| `content-privacy-config.js` | `assertPrivateWriteAllowed`（仅取值校验，不门禁）、`finalizeCourseVisibility` | ① 已实现（门禁已移除） |
| `playback-access.js` / `playback.routes.js` | `GET /api/playback/videos/:id/play-url`：检查公开可读或老师/主任权限后返回正常 CDN/COS 播放地址；公开视频也可调用，不再签发私密短链 | ① 兼容端点保留 |
| `visibility_revocations`（`db.js`）/ `revocation.js` | 历史撤销审计表与 `recordVisibilityRevocations` | **表保留；改私密不再调用**，不据其声称内容已删除 |
| `assignment-navigation.js` + 双端端点 | `Web /api/user/assignments/:id/navigation`、`小程序 /api/miniprogram/homework/:id/navigation`，实时返回 `status: available/private/missing`，仅 `available` 给 `url`/`target` | ① 已实现 |

**媒体分发（当前代码）**：有权限的内容统一走正常 CDN/COS 源，不再强制私密短签 / TypeA / 改私密即撤销。Web播放器主路径已使用普通播放源，旧授权死分支仍待清理，不能把死分支误述成当前强制短签流程。附件已有独立下载能力，Web优先使用返回的文件地址，缺少地址时兼容下载接口；小程序保留文件签名接口。新增“下载当前分p”按钮及其是否走CDN仍待确认、尚未实施；不要与已有附件下载混淆。早期媒体讨论文档是历史材料，不能代替本节当前口径。

### 19.4 前端管理端入口与学生端行为

- 曲目编辑页 `/admin/tracks`、知识点编辑页 `/admin/knowledge`：每个分 P 行、每个附件行右侧有
  「公开/私密」切换按钮（通用组件 `frontend/components/VisibilityToggle.js`）；分 P 顶部有
  「全部公开 / 全部私密」批量操作，并实时提示课程派生状态。已实现（阶段 F）。
- **已布置 / 已有前置目标允许改私密**：不再因引用关系 409 阻断（参考 19.2）。
- **学生端前置隐藏**：私密或失效前置不作为学生学习入口。
- **失效作业（双端）**：今日页原位灰框，标题固定“此资料已经被老师更改”，不显示原封面或入口，点击静默无响应（无 Toast / 弹窗 / 跳转）。已知失效不必重复导航请求；原可用项点击实时复核，发现失效后原位变灰。
- **老师回填**：latest 接口过滤私密/删除目标，按稳定 ID 勾选；恢复公开后下一次查询自动恢复。
- **历史记录**：只读布置时标题快照，不能因目标私密、删除、改名而改成失效文案，也不提供跳转。

### 19.5 边界、待办与部署风险（如实提示）

- **本地 MinIO 不能证明线上 CDN**：本地 Docker 试用使用 MinIO 本地源、且 `NODE_ENV=development`、
  CDN 环境变量未注入，端到端通过只代表本地逻辑，**不能据以声称真实 COS/CDN 验收通过**。
- **生产配置覆盖已采用三文件组合解决**：local 仍写 development，但服务器最后加载 production 覆盖为 production；第 3.2 / 16 节命令必须保持完整顺序。仅根 `.env` 写 production 或漏掉最后覆盖文件，仍会回到 development。换机必须补齐服务器生产覆盖文件并检查容器实际环境。
- **八表含两合集迁移先于启动 schema 门禁**：`backend/scripts/migrate-content-visibility.js --apply`
  现在锁定并回填 **8 张表**（含 `track_collections` / `knowledge_collections` 两合集的 `visibility` 列）。
  启动新后端前**必须先跑迁移**，否则后端 `assertVisibilitySchema`（`VISIBILITY_SCHEMA_REQUIRED`）
  fail-fast 导致线上 502（详见 3.2 节与 [复盘文档](docs/debug复盘/2026-10-29-生产部署502-VISIBILITY_SCHEMA_REQUIRED复盘.md)）。
- 按用户确认的边界，本项目只做业务角色可见性，不要求COS/CDN文件级保密；不把桶私有化、CDN鉴权或旧直链撤销作为本功能验收前提。本轮未核实线上桶策略。
  已知公开直链 / 已转发内容仍可能直接访问，**不要把业务隐藏描述为文件加密或文件级保密**。
- 已签发的短期 URL 在其有效期内、以及已下载到客户端的内容**无法追回**；`visibility_revocations`
  表保留为历史审计，但不据其声称已删除/撤回。
- 无归属独立旧视频的布置策略尚未收紧（沿用「无宿主按公开」），正式发布前需审计。
- **登录保持时间（当前实现，线上未独立核验）**：Web JWT 有效期 7 天、Cookie `maxAge` 同步；
  小程序 token 15 天。已新增 `auth_version` 回查：改密/管理重置后，携带旧版本或缺少版本的 Cookie/Bearer 在鉴权时被拒绝，须重新登录；账号停用及角色变更仍有数据库回查。服务器本次已完成两个账号表版本字段迁移并更新服务；改密具体交互及多设备登录行为仍须人工验收。
