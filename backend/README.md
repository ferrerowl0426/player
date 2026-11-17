# 后端交接：部署、数据库与媒体分发

> 与根目录 [README.md](../README.md)、[小程序 README](../README-miniprogram.md) 配套阅读。本文记录当前实现，旧 TypeA 短签方案已撤销，不再作为部署要求。真实密钥只保存在受控环境配置中。

## 1. 服务与环境

- Node.js + Express + PostgreSQL；本地 MinIO，线上 COS；API 前缀 `/api`，小程序 `/api/miniprogram`。
- 后端端口 `3000`，Web 端口 `3001`；健康检查 `http://localhost:3000/api/health`，不是前端 3001 的 `/api/health`。
- 线上 API：`https://api.nxhguitar.com/api`；主站：`https://nxhguitar.com`。
- 容器网络内数据库端口 `5432`，宿主机映射 `15432`；连接凭据以受控配置为准。
- Docker Compose 后端读取项目根 `.env`。`backend/.env` 仅本机直接启动 Node 时读取，已被 `.dockerignore` 排除，不要在服务器维护两份配置。
- 前端 `NEXT_PUBLIC_API_BASE_URL` 为构建期变量，改值必须重新 build frontend。后端变量改值必须重新创建容器，restart 不会重新注入。

## 2. 服务器发布规则

服务器目录 `/root/player`，Compose 项目名 `video_player`。每次先确认当前目录、工作区、发布前提交及备份。生产始终使用下列顺序：

```bash
cd /root/player
git status --short
git rev-parse HEAD
git pull --ff-only gitee main

docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml build backend frontend
# 若有 schema 变更，先完成第 3 节，不能直接继续启动
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml up -d --no-deps --force-recreate backend frontend

docker exec video_player_backend printenv NODE_ENV
curl --fail http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1:3001
docker logs --tail=150 video_player_backend
```

`docker-compose.production.yml` 在服务器创建，换机/新克隆时要确认存在，不能假定仓库已包含。至少含：

```yaml
services:
  backend:
    environment:
      NODE_ENV: production
      CONTENT_PRIVACY_MODE: business
```

- local 文件仍有 `NODE_ENV=development`，生产覆盖文件必须最后加载；实际容器应返回 `production`。
- 保留 local 是为了兼容现有服务、网络与卷，不是让线上跑 development。不能直接省略 local 或 production。
- 禁止 `docker compose down -v`、清空数据库或桶、删除已有 MinIO 卷；卷归属警告不等于数据损坏。
- 首次启动短暂 curl 连接重置后必须复查就绪、日志及重启次数；健康检查不能代替业务验收。

## 3. 数据库迁移与回滚

新后端检查 schema，**不会自动替生产执行迁移**。缺字段会报 `VISIBILITY_SCHEMA_REQUIRED` / `AUTH_VERSION_SCHEMA_REQUIRED`，导致容器退出和 Nginx 502；不要通过 development 绕过。

流程：备份正式库及部署配置 → 构建新版镜像 → 用隔离副本演练 → 审阅数据变化 → 人工批准 → 正式迁移 → 启动服务 → 检查。

| 脚本 | 作用 |
|---|---|
| `scripts/migrate-content-visibility.js --apply` | 八表 visibility，含两合集；回填约束/索引并重算课程、合集派生状态；保留分 P、附件已有 private |
| `scripts/migrate-auth-version.js --apply` | 给 admins/users 加 auth_version，不重置存量密码、不注入初始业务数据 |

批准后从新版镜像执行一次性任务，不依赖旧容器内可能过时的脚本：

```bash
cd /root/player
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml run --rm --no-deps backend node scripts/migrate-content-visibility.js --apply
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.production.yml run --rm --no-deps backend node scripts/migrate-auth-version.js --apply
```

上面使用 compose 当前配置的数据库，**不是副本演练命令**；演练时必须明确改为隔离库。脚本幂等不代表每次普通更新都必须运行，按版本和 schema 判断。禁止运行 reset/seed、导入本地 dump 来升级正式库。

升级前保存 pg_dump、旧提交、可回退镜像标识、根 `.env` 和生产覆盖文件。数据库备份不包含 COS/MinIO 对象。代码回滚只允许回到与当前 schema 兼容的版本；数据库恢复需单独审批，明确备份后新增数据会丢失，不能自动覆盖。

最近服务器升级记录：`24c9c32`，备份 `/root/player-backups/20261118_012041`，副本/正式库迁移及生产启动健康检查已完成；本次文档更新未重新操作服务器。

## 4. 业务可见性（不是文件级保密）

- P 的 public/private 是源头；存在公开 P 则课程公开，存在公开课程则合集公开，事务内刷新派生字段。
- 八表：track_parts、knowledge_parts、track_points、knowledge_points、track_collections、knowledge_collections、content_attachments、video_attachments。
- 附件独立私密，不参与课程/合集派生；图书馆无 visibility。
- 学生/游客不可读取私密内容，有效老师/教导主任按后端权限可读；前端隐藏不能代替后端授权。
- 已布置、已有前置的目标允许改私密；学生隐藏私密前置，作业按第 6 节降级。
- `CONTENT_PRIVACY_MODE` 已仅作兼容/诊断，私密不再依赖它开通，也不依赖 development 放行。
- **只实现业务权限，不承诺 COS/CDN 文件加密或直链撤回**。已知公开直链、转发、缓存与已下载文件可能继续可用，用户已接受该边界。

## 5. CDN / COS 当前策略及排障

### 地址契约

- 数据库保存 COS 源地址，不批量改成 CDN 地址；授权后的响应保留 `video_url` / `videoUrl`，新增 `play_url` / `playUrl`。
- `src/playback-url.js` 精确转换默认源：`https://gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com` → `https://media.nxhguitar.com`，路径/查询保持原样。
- `MEDIA_CDN_ENABLED` 默认开启；false/0/no/off 关闭转换。MinIO、其他域名和带签名参数 URL 不做默认转换。
- Web/小程序优先 CDN，失败尝试同一视频**同一清晰度**的 COS 源，防止回退成不同视频/档位；保留播放位置和播放状态，避免循环重试。
- 不再生成 TypeA 短签，不再有 `MEDIA_CDN_AUTH_*` 启动要求；旧云端 TypeA 若仍强制校验，普通播放地址可能 403，需先核对控制台现状，不能只改代码声称云端已修复。
- `/api/playback/videos/:id/play-url` 兼容端点仍检查权限，但返回正常 CDN/COS 地址，不是私密短签接口。`visibility_revocations` 仅历史审计，不代表已撤回文件。
- 附件/图书馆文件下载预签名仍是独立功能；移除视频 TypeA 不等于移除所有文件签名。

### 排障顺序

1. 对比接口中 COS 与 CDN 的完整路径、档位、HTTP 状态；不要把签名参数和回调 token 写入公开日志。
2. COS 也 404：查对象 key、上传/转码结果和接口数据，不先怪 CDN。COS 正常而 CDN 403/404：查 CDN 域名证书、源站、回源权限、防盗链、残留 TypeA 与边缘负缓存。
3. COS 403：查桶/对象策略、签名有效性及请求要求。不要为了业务私密直接把整个桶私有化，否则封面/PDF/附件也可能失效。
4. 浏览器独有故障：核对 HTTPS 混合内容、COS/CDN CORS、Range/206、Content-Type；COS CORS 放行主站 `https://nxhguitar.com`，按实际上传/播放请求配置，不把“已配置”写成未核验的结论。
5. 小程序独有故障：核对 request/downloadFile 合法域名、HTTPS 证书、CDN 和 COS 回退域名；开发工具关闭校验不代表真机/正式版可用。
6. 缺少画质：查 CI 工作流、回调及 video_renditions，不把 CDN 缓存刷新当成转码补救。

真实云端策略需控制台独立核验；本地 MinIO 成功不能证明线上 CDN 命中、回退或权限已验收。必要时精确刷新出问题的 URL 缓存，不盲目整站刷新。

### CI 转码

保留 MP4 工作流（720p/1080p），输入前缀 tracks/、knowledge/；产物与源同目录，文件名追加 `-720p` / `-1080p`。不要启用整桶无限循环转码。回调 `/api/videos/transcode/callback` 需要 `CI_CALLBACK_SECRET`，未配置则拒绝；token 只在受控控制台配置，不写文档/仓库。详细控制台配置见根 README 第 17 节。

## 6. 密码与作业契约

- 本人凭旧密码改密；旧密码错误返回 400，避免小程序 401 分支误退出。
- 改密/管理重置递增 auth_version，旧 Cookie/Bearer 失效。唯一 admin 禁改/禁重置；普通老师不能替他人重置，root/教导主任受权限范围限制。
- 新建学员固定 `Nxh123456`，忽略客户端 password，可暂不分班；不追溯更改已有密码。
- 作业使用稳定 object_type + object_id，P 使用真实 part_id，兼容 COALESCE(part_id, object_id)，不使用 P 序号或 URL 作身份。
- 今日作业按当前目标投影；private/missing 原位灰框，精确标题“此资料已经被老师更改”，不下发封面/导航，点击无 Toast/弹窗/跳转。
- available 点击另走导航复核。恢复公开后下一次查询恢复，历史只读标题快照不变。
- latest 回填接口按稳定 ID 过滤失效目标；全失效仍返回最新批次要求，不回退旧批次。
- 实现定位：assignment-targets.js、assignment-navigation.js、user-auth.routes.js、admin.routes.js、miniprogram.services.js。

## 7. 验证与交接边界

Node 22 模块 mock 测试需实验参数，在 backend 目录执行：

```bash
node --experimental-test-module-mocks --test src/*.test.js
```

集成脚本运行前先审阅目标连接，必须使用隔离数据库；不要为了测试连接生产。Web/小程序人工交互由用户验收，小程序前端需单独上传发布。历史结果：改密 HTTP 集成 34 项、小程序相关测试 51 项通过，均不是本次文档更新重新执行的结果。
