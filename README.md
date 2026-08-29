# Node.js 全栈视频播放器学习项目交接文档

这是一个用于教学和练习的前后端分离视频播放器项目。当前文档既是项目 README，也是后续新对话继续接手时的交接说明。

## 1. 项目当前定位

项目目标不是做复杂业务，而是通过一个完整的视频上传、管理、学生主页课程设置项目，练习全栈开发链路：

```txt
Next.js 前端页面 -> Express 后端 API -> PostgreSQL 数据库 -> 腾讯云 COS / S3 兼容对象存储
```

核心功能：

- 上传视频、标题、介绍、封面图（封面必填）、资料附件和前置知识点
- 上传视频已拆成独立页面，老师和教导主任都可从后台跳转上传
- 上传时可实时预览封面、标题、简介、附件数量和前置知识点显示效果
- 首页卡片形式展示视频列表，封面统一 16:9 比例
- 点击视频进入播放页
- 删除视频时同步删除数据库记录、视频文件、封面图片和附件
- 使用清理脚本排查和删除孤儿文件
- 三角色账号体系：学员、老师、教导主任
- 班级管理：老师负责一个班级，学员属于一个班级
- 老师和教导主任均可编辑学生主页置顶的课程视频，并填写作业备注
- 已置顶课程视频在选择区会禁选并用颜色区分，避免重复选择
- 学生主页课程设置记录按操作（operation）聚合展示
- 课程视频支持设置多个前置知识点，前置知识点本身也可以继续有前置知识点，学生点击后可跳转查看
- 登录时按选择的身份严格校验账号角色，角色不匹配拒绝登录
- 游客模式：无需登录即可浏览和搜索公开视频，看不到学生主页置顶课程和作业备注
- 后端提供 REST API，后续可继续接入小程序或其他客户端

当前上传方式：

```txt
浏览器 -> 后端 Express 创建 Multipart 上传任务 -> 浏览器分片直传腾讯云 COS -> 后端合并分片并保存数据库记录
```

也就是说，前端不再把视频文件提交给后端中转，而是先向后端创建腾讯云 COS Multipart 上传任务，再把视频切成多个分片直接 PUT 到对象存储，最后由后端通知 COS 合并分片并写入数据库。真实 COS 密钥只保存在后端。

## 2. 当前技术栈

### 前端

- Next.js App Router
- React
- JavaScript
- CSS
- HTML `video`

Docker 部署时前端默认端口：

```txt
http://服务器IP:3001
```

本地开发时前端默认端口：

```txt
http://localhost:3001
```

### 后端

- Node.js
- Express
- pg
- dotenv
- AWS S3 SDK
- uuid
- bcrypt

Docker 部署时后端 API 对外端口：

```txt
http://服务器IP:3002
```

容器内部后端端口：

```txt
3000
```

### 数据库和存储

- PostgreSQL：保存视频元数据、用户、管理员、班级、学生主页课程设置记录、附件和前置知识点关系
- 腾讯云 COS：保存视频文件、封面图片和附件
- AWS S3 SDK：后端通过 S3 兼容协议上传、删除、列出对象

数据库只保存文件 URL，不保存文件本体。

### Docker

当前 [docker-compose.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.yml) 是生产部署配置，负责启动：

- PostgreSQL
- Express 后端
- Next.js 前端

本地 MinIO 调试配置放在 [docker-compose.local.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.local.yml)，只在本地叠加使用。生产服务器部署腾讯云 COS 时不启动 MinIO。

服务器部署时只需要配置根目录 `.env`；本地 Docker 试用时使用根目录 `.env.local`，填写本地 MinIO 或 COS 配置。

## 3. 项目目录结构

```txt
播放器/
├── backend/                 # Express 后端 API
│   ├── scripts/             # 后端脚本，例如孤儿文件清理
│   ├── src/                 # 后端源码
│   ├── .env.example         # 后端本地环境变量示例
│   ├── Dockerfile           # 后端镜像构建文件
│   ├── package.json
│   └── package-lock.json
├── database/                # PostgreSQL 初始化 SQL
│   └── schema.sql
├── frontend/                # Next.js 前端
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── Dockerfile           # 前端镜像构建文件
│   ├── next.config.js
│   ├── package.json
│   └── package-lock.json
├── memory/                  # 项目长期记忆和学习复盘
├── .env.example             # 服务器 Docker 部署环境变量模板
├── docker-compose.yml       # 生产 Docker 配置：PostgreSQL + 后端 + 前端
├── docker-compose.local.yml # 本地 Docker 叠加配置：MinIO + bucket 初始化
├── package.json             # 根目录快捷命令
├── package-lock.json
├── .gitignore
└── README.md
```

## 4. 关键文件说明

### 后端关键文件

| 文件 | 作用 |
|---|---|
| [config.js](file:///c:/Users/user/Desktop/播放器/backend/src/config.js) | 读取环境变量，集中管理端口、数据库、S3/COS、JWT、Cookie 配置 |
| [server.js](file:///c:/Users/user/Desktop/播放器/backend/src/server.js) | Express 服务入口，配置 CORS、JSON、健康检查、路由注册 |
| [db.js](file:///c:/Users/user/Desktop/播放器/backend/src/db.js) | PostgreSQL 连接池；后端启动时兜底创建表、初始化默认角色和班级 |
| [auth.js](file:///c:/Users/user/Desktop/播放器/backend/src/auth.js) | JWT 签发、HttpOnly Cookie 配置、管理员接口鉴权中间件 |
| [admin.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/admin.routes.js) | 老师/教导主任登录、班级/老师/学员管理、学生主页课程设置、作业备注、操作聚合 API |
| [user-auth.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/user-auth.routes.js) | 学员登录、退出、今日作业查询 |
| [storage.js](file:///c:/Users/user/Desktop/播放器/backend/src/storage.js) | 生成预签名上传地址，删除、检查、列出 S3/COS 对象 |
| [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js) | 视频列表、详情、上传地址生成、完成上传、删除 API |
| [clean-orphan-objects.js](file:///c:/Users/user/Desktop/播放器/backend/scripts/clean-orphan-objects.js) | 清理存储桶孤儿文件脚本 |

### 前端关键文件

| 文件 | 作用 |
|---|---|
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/page.js) | 学员首页，登录后显示今日作业、学生主页置顶课程视频和作业备注 |
| [LoginForm.js](file:///c:/Users/user/Desktop/播放器/frontend/app/login/LoginForm.js) | 统一登录页，支持学员/老师/教导主任三种身份 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/page.js) | 老师/教导主任后台入口，按角色显示不同内容 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/users/page.js) | 学员列表；老师只看本班，教导主任看全部 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/users/[id]/assignments/page.js) | 编辑指定学员主页置顶课程视频、作业备注、查看历史操作聚合 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/classes/page.js) | 班级管理，教导主任可操作 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/admins/page.js) | 老师/教导主任账号管理，仅教导主任可操作 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/videos/[id]/page.js) | 视频详情播放页，显示资料附件和前置知识点 |
| [SiteHeader.js](file:///c:/Users/user/Desktop/播放器/frontend/components/SiteHeader.js) | 顶部导航，根据当前身份显示不同入口 |
| [VideoPlayer.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoPlayer.js) | 客户端视频播放器组件，处理播放清理和避免叠音 |
| [AdminUploadForm.js](file:///c:/Users/user/Desktop/播放器/frontend/components/AdminUploadForm.js) | 上传表单和直传流程入口，支持预览和前置知识点选择 |
| [VideoFilters.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoFilters.js) | 视频关键词和日期筛选表单 |
| [VideoList.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoList.js) | 视频列表展示组件，支持选择、删除模式 |
| [api.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/api.js) | 前端请求后端 API、直传对象存储和上传进度封装 |
| [guest.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/guest.js) | 游客模式状态管理（基于 localStorage） |
| [useVideoList.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/useVideoList.js) | 共用的视频列表加载、搜索、重置逻辑 |
| [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css) | 全局样式，包含 16:9 封面统一样式 |

### 数据库文件

| 文件 | 作用 |
|---|---|
| [schema.sql](file:///c:/Users/user/Desktop/播放器/database/schema.sql) | 创建 `videos` 表和视频列表相关索引 |

`schema.sql` 只维护视频基础表结构。管理员表、学员表、班级表、学生主页课程设置表、附件表和前置知识点关系表由后端启动时的 [ensureAppSchema](file:///c:/Users/user/Desktop/播放器/backend/src/db.js) 统一创建和更新，避免 Docker 数据卷已存在时初始化 SQL 不再执行导致旧环境缺表。

主要表：

- `videos`：视频元数据
- `admins`：老师/教导主任账号，含 `role` 字段（`teacher` / `super_admin`）
- `teaching_classes`：班级，含 `teacher_id` 外键，班级名唯一
- `users`：学员账号，含 `class_id` 外键
- `user_assignments`：学生主页课程设置和作业备注记录，按 `operation_id` 聚合，支持软删除
- `video_attachments`：视频资料附件
- `video_prerequisites`：课程视频的前置知识点关系

注意：视频文件、封面图片和附件不进数据库，只保存到对象存储桶。

## 5. memory 目录说明

[memory](file:///c:/Users/user/Desktop/播放器/memory) 是本项目的长期记忆目录，用于防止开新对话后上下文丢失。

已有文档：

| 文件 | 内容 |
|---|---|
| [README.md](file:///c:/Users/user/Desktop/播放器/memory/README.md) | memory 目录索引 |
| [project-study-notes.md](file:///c:/Users/user/Desktop/播放器/memory/project-study-notes.md) | 项目定位、技术栈、文件职责、数据流、学习重点 |
| [bug-video-audio-overlap.md](file:///c:/Users/user/Desktop/播放器/memory/bug-video-audio-overlap.md) | 播放页返回首页后视频叠音 Bug 复盘 |
| [validation-notes.md](file:///c:/Users/user/Desktop/播放器/memory/validation-notes.md) | 上传表单前后端边界校验学习记录 |
| [storage-sync-notes.md](file:///c:/Users/user/Desktop/播放器/memory/storage-sync-notes.md) | 数据库和存储桶同步、孤儿文件、清理脚本学习记录 |

历史调试文档可能保留当时的 MinIO 或旧部署内容，用于复盘，不代表当前部署方案。

## 6. 服务器部署流程

当前推荐部署方式：服务器直接从 GitHub 拉代码，在服务器本地构建 Docker 镜像。

```txt
本地提交 -> GitHub -> 腾讯云服务器 git pull -> docker compose up -d --build
```

### 6.1 服务器拉取代码

```bash
cd ~/player
git pull
```

如果是第一次部署：

```bash
git clone <你的仓库地址> ~/player
cd ~/player
```

### 6.2 配置服务器 .env

项目根目录已有 [.env.example](file:///c:/Users/user/Desktop/播放器/.env.example)。服务器上第一次部署时执行：

```bash
cp .env.example .env
nano .env
```

服务器 `.env` 示例：

```env
FRONTEND_URL=http://服务器公网IP:3001
NEXT_PUBLIC_API_BASE_URL=http://服务器公网IP:3002/api
JWT_SECRET=请改成一段长随机字符串
COOKIE_SECURE=false

S3_ENDPOINT=https://cos.ap-nanjing.myqcloud.com
S3_REGION=ap-nanjing
S3_BUCKET=你的存储桶名称
S3_ACCESS_KEY_ID=你的SecretId
S3_SECRET_ACCESS_KEY=你的SecretKey
S3_FORCE_PATH_STYLE=false
S3_PUBLIC_ENDPOINT=
PUBLIC_BUCKET_BASE_URL=https://你的存储桶名称.cos.ap-nanjing.myqcloud.com
```

说明：

- `FRONTEND_URL`：后端 CORS 允许的前端地址，也用于判断 Cookie 是否启用 `Secure`
- `NEXT_PUBLIC_API_BASE_URL`：浏览器访问后端 API 的地址，会在前端镜像构建时写入前端包
- `JWT_SECRET`：登录 JWT 签名密钥，生产环境必须改成一段长随机字符串
- `COOKIE_SECURE`：可选，强制控制登录 Cookie 是否启用 `Secure`。`true` 仅适合 HTTPS；`false` 适合 HTTP 临时调试。默认会根据 `FRONTEND_URL` 是否以 `https://` 开头自动判断
- `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET`：腾讯云 COS 的 S3 兼容配置
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`：腾讯云访问密钥，不要提交到 Git
- `S3_FORCE_PATH_STYLE=false`：腾讯云 COS 使用虚拟主机风格访问
- `S3_PUBLIC_ENDPOINT`：本地 MinIO 直传时才需要，生产腾讯云 COS 一般留空
- `PUBLIC_BUCKET_BASE_URL`：浏览器访问视频和封面时使用的公开 COS 地址

腾讯云 COS 存储桶需要配置 CORS，允许前端页面直传：

```txt
AllowedOrigin: http://服务器公网IP:3001
AllowedMethod: PUT, GET, HEAD
AllowedHeader: *
ExposeHeader: ETag
```

如果后续使用域名和 HTTPS，要把 `AllowedOrigin` 改成实际前端域名。

### 6.3 启动或重建容器

```bash
docker compose -p video_player --env-file .env down
docker compose -p video_player --env-file .env up -d --build
```

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker compose -p video_player --env-file .env logs --tail=100 backend
docker compose -p video_player --env-file .env logs --tail=100 frontend
```

说明：

- 生产 [docker-compose.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.yml) 会给后端设置 `NODE_ENV=production`
- Cookie 的 `Secure` 标志不再只由 `NODE_ENV` 控制，而是优先看 `COOKIE_SECURE` 环境变量；没有显式配置时根据 `FRONTEND_URL` 是否以 `https://` 开头自动判断
- 本地 [docker-compose.local.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.local.yml) 会覆盖为 `NODE_ENV=development`，避免本地 HTTP 调试时 Secure Cookie 导致登录状态无法保存

### 6.4 验证服务

后端健康检查：

```bash
curl http://localhost:3002/api/health
```

正常返回：

```json
{"message":"后端服务运行正常"}
```

前端检查：

```bash
curl -I http://localhost:3001
```

浏览器访问：

```txt
http://服务器公网IP:3001
```

上传成功后，浏览器 Network 中应看到：

```txt
POST http://服务器公网IP:3002/api/videos/multipart/create
POST http://服务器公网IP:3002/api/videos/multipart/part-url
PUT https://你的存储桶名称.cos.ap-nanjing.myqcloud.com/videos/...
POST http://服务器公网IP:3002/api/videos/multipart/complete
PUT https://你的存储桶名称.cos.ap-nanjing.myqcloud.com/covers/...
POST http://服务器公网IP:3002/api/videos/complete
```

不应再看到：

```txt
POST http://服务器公网IP:3002/api/videos
```

## 7. 本地开发说明

本地调试分两种：Docker 完整环境和 Node.js 代码开发。

### 7.1 本地 Docker 调试

本地 Docker 调试使用 MinIO 模拟 S3 存储桶。生产环境的 [docker-compose.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.yml) 不包含 MinIO，本地需要叠加 [docker-compose.local.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.local.yml)。

根目录创建 `.env.local`：

```env
FRONTEND_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3002/api
JWT_SECRET=dev-local-secret

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=videos
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_ENDPOINT=http://localhost:9000
PUBLIC_BUCKET_BASE_URL=http://localhost:9000/videos
```

说明：

- `S3_ENDPOINT=http://minio:9000`：后端容器访问 MinIO 的内部地址
- `S3_PUBLIC_ENDPOINT=http://localhost:9000`：浏览器直传分片使用的宿主机地址
- `PUBLIC_BUCKET_BASE_URL=http://localhost:9000/videos`：浏览器播放视频和显示封面使用的公开地址
- `.env.local` 已加入 [.gitignore](file:///c:/Users/user/Desktop/播放器/.gitignore)，不会提交到 Git

本地启动：

```bash
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local up -d --build
```

本地停止：

```bash
docker compose -p video_player -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local down
```

本地访问：

```txt
前端：http://localhost:3001
后端：http://localhost:3002/api/health
统一登录页：http://localhost:3001/login
MinIO 控制台：http://localhost:9001
```

MinIO 登录：

```txt
username: minioadmin
password: minioadmin
```

统一登录页支持三种身份：

```txt
学员登录 / 老师登录 / 教导主任登录
```

默认测试账号：

```txt
教导主任：admin / 123456
老师：    teacher_a / 123456（负责一班）
老师：    teacher_b / 123456（负责二班）
学员：    student_a1 / 123456（一班）
学员：    student_a2 / 123456（一班）
学员：    student_a3 / 123456（一班）
学员：    student_b1 / 123456（二班）
学员：    student_b2 / 123456（二班）
学员：    student_b3 / 123456（二班）
```

账号由后端启动时写入 PostgreSQL。数据库中不保存明文密码，均保存 bcrypt hash。

### 7.2 Node.js 代码开发

如果只做代码开发，可分别安装依赖：

```bash
npm install
npm run install:all
```

后端直接运行时使用 [backend/.env](file:///c:/Users/user/Desktop/播放器/backend/.env.example) 这一类配置；Docker 部署使用根目录 `.env` 或 `.env.local`。

## 8. 当前已实现的重要逻辑

### 8.1 三角色账号体系

当前项目使用三种角色：

| 角色 | 数据库 role | 功能范围 |
|---|---|---|
| 学员 | （users 表） | 登录后浏览视频列表，查看老师设置的今日作业、主页置顶课程视频和作业备注 |
| 老师 | `teacher` | 管理本班学员、上传课程视频、编辑本班学员主页置顶课程视频和作业备注，不能删除视频 |
| 教导主任 | `super_admin` | 管理所有班级、老师账号、教导主任账号、学员；可上传和删除视频；可编辑任意学员主页置顶课程视频和作业备注 |

老师和教导主任共享 `/admin` 路径，但页面内容根据 `role` 动态切换。

### 8.2 登录身份严格校验

登录页提供三个选项卡：学员登录、老师登录、教导主任登录。前端把当前选择的身份通过 `expectedRole` 传给后端，后端校验账号实际角色必须和选择身份一致：

- 学员登录输入老师/教导主任账号 → 返回 **"没有这个学生"**
- 老师登录输入学员账号 → 返回 **"没有这个老师"**
- 老师登录输入教导主任账号 → 返回 **"没有这个老师"**
- 教导主任登录输入老师账号 → 返回 **"该账号不是教导主任"**

后端 `/api/admin/login` 强制要求 `expectedRole` 字段，不允许跳过校验。

### 8.3 班级与权限边界

- 每个老师对应一个 `teaching_classes` 班级记录
- 每个学员通过 `users.class_id` 关联班级
- 老师只能查看和管理自己班级的学员
- 教导主任可以查看所有班级、所有学员、所有老师账号
- 新创建的学员默认放入创建者所属班级（老师创建）或教导主任选择的班级

### 8.4 上传校验

上传表单已做前后端校验。

规则：

| 内容 | 规则 |
|---|---|
| 标题 | 必填，最多 120 个字 |
| 标题特殊值 | 不能是 `null`、`undefined`、`NaN` |
| 介绍 | 可选，最多 1000 个字 |
| 介绍特殊值 | 不能是 `null`、`undefined`、`NaN` |
| 视频 | 必填，最大 500MB |
| 视频格式 | mp4、webm、mov |
| 封面 | 必填，最大 5MB |
| 封面格式 | jpg、jpeg、png、webp |
| 前置知识点 | 可选，可搜索并选择多个已有课程视频 |

原则：

```txt
前端校验是为了体验，后端校验才是真正安全。
```

### 8.5 上传数据流

当前上传流程：

```txt
1. 前端校验表单
2. 前端把标题、介绍、视频文件信息、封面文件信息、附件信息 POST 到 /api/videos/multipart/create
3. 后端校验元数据，创建视频 Multipart Upload，并返回 uploadId、videoKey、封面和附件的预签名上传地址
4. 前端把视频按 8MB 切片，每个分片向 /api/videos/multipart/part-url 申请预签名 PUT 地址
5. 前端并发把视频分片直接 PUT 到 COS，并记录每个分片返回的 ETag
6. 前端把 uploadId、videoKey、PartNumber + ETag 列表 POST 到 /api/videos/multipart/complete
7. 后端通知 COS 合并视频分片，并确认最终视频对象存在
8. 前端把封面和附件直接 PUT 到 COS
9. 前端把 title / description / videoKey / coverKey / attachments / prerequisiteVideoIds POST 到 /api/videos/complete
10. 后端确认视频、封面和附件对象存在后，把 video_url / cover_url / 附件 / 前置知识点关系保存到 PostgreSQL
11. 前端刷新列表
```

这个方案比后端中转更快，也适合大文件上传；如果上传中途失败，前端会调用 abort 接口取消未完成的 Multipart Upload，避免 COS 里长期残留未合并分片。

后端保存前会通过 COS HeadObject 校验对象真实大小，不轻信前端上报的文件元数据。

### 8.6 视频播放叠音修复

之前出现过：从视频播放页返回首页后，声音还在播放，甚至出现叠音。

最终处理：

- 播放页使用 `VideoPlayer` 客户端组件
- 返回首页使用普通 `<a href="/">`，不用 Next.js `<Link>`
- `VideoPlayer` 卸载时只做温和清理：移除监听、暂停视频
- 不再在 cleanup 中强行 `removeAttribute('src')` 和 `load()`，避免破坏进度条状态

详见：[bug-video-audio-overlap.md](file:///c:/Users/user/Desktop/播放器/memory/bug-video-audio-overlap.md)

### 8.7 数据库和存储桶同步

项目中：

```txt
PostgreSQL 保存“文件在哪里”
腾讯云 COS 保存“文件本体”
```

删除视频时要维护两边一致性。

当前思路：

```txt
1. 先查询数据库记录
2. 根据 video_url / cover_url / attachments 删除存储桶对象
3. 存储桶删除成功后，再删除数据库记录
```

并提供孤儿文件清理脚本。

预览孤儿文件：

```bash
npm run storage:clean --prefix backend
```

确认后删除孤儿文件：

```bash
npm run storage:clean --prefix backend -- --delete
```

详见：[storage-sync-notes.md](file:///c:/Users/user/Desktop/播放器/memory/storage-sync-notes.md)

### 8.8 老师/教导主任编辑学生主页课程和作业备注

老师和教导主任可以在 `/admin/users` 查看学员列表，进入某个学员的主页课程设置页 `/admin/users/[id]/assignments`：

- 查看当前学生主页置顶的课程视频
- 从视频库中选择课程视频，已置顶视频会禁选并用颜色区分
- 填写作业备注
- 一次「保存设置」可以同时提交课程视频和作业备注
- 取消正在置顶的课程视频
- 删除历史操作记录（软删除，需要填写原因）

每次「保存设置」后端会生成一个 `operation_id`，同一次操作里的视频记录和作业备注记录共享这个 ID。历史操作区按 `operation_id` 聚合显示为以下三种情况之一：

1. 老师 admin 给学员 demo 编辑了 N 个主页置顶课程视频，并填写作业备注：…
2. 老师 admin 单独修改了作业备注：…
3. 老师 admin 单独编辑了 N 个主页置顶课程视频：…

业务规则：

- 同一个学员最多同时存在 5 个主页置顶课程视频
- 已经置顶的视频不会重复置顶，前端选择区会禁选
- 取消置顶只做软删除，历史记录仍可查看
- 删除历史记录需要填写原因
- 老师只能编辑自己班级学员的主页课程设置

### 8.9 学员登录和首页

学员使用账号密码登录：

```txt
POST /api/user/login    登录，设置 HttpOnly Cookie
GET  /api/user/me       检查当前学员登录状态
POST /api/user/logout   退出登录，清除 Cookie
GET  /api/user/assignments/today  获取今日作业
```

登录后首页显示：

- 今日的作业：老师设置的主页置顶课程视频 + 作业备注
- 视频列表：全部视频列表，支持搜索和日期筛选

### 8.10 Cookie 策略

登录 Cookie 设置原则：

- `httpOnly: true`，避免前端 JavaScript 读取 token
- `sameSite: 'lax'`，降低 CSRF 风险
- `secure` 根据 `FRONTEND_URL` 协议自动判断，HTTPS 时启用，HTTP 时关闭
- 可通过环境变量 `COOKIE_SECURE=true/false` 强制覆盖
- token 有过期时间

这样生产环境用 `http://IP:3001` 临时访问时也不会因为 Secure Cookie 被浏览器拒绝而导致登录无反应。

### 8.11 游客模式

登录页左上角提供"先不登录使用游客模式访问"入口。点击后前端会在 `localStorage` 中标记游客状态，并直接进入首页。

游客模式特点：

- 无需账号密码即可访问
- 可以浏览、搜索、播放公开视频
- 首页不显示"今日的作业"、"学生主页置顶的课程视频"和"作业备注"
- 顶部导航显示"回到首页"和"去登录"，点击"去登录"会清除游客标记并回到登录页
- 游客身份不是后端认证状态，不能访问任何需要登录的接口

相关文件：

- [frontend/lib/guest.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/guest.js)：游客模式读写封装
- [frontend/components/SiteHeader.js](file:///c:/Users/user/Desktop/播放器/frontend/components/SiteHeader.js)：游客入口和退出按钮
- [frontend/app/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/page.js)：游客首页逻辑
- [frontend/app/videos/[id]/page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/videos/[id]/page.js)：游客播放页逻辑

### 8.12 封面统一 16:9

所有视频封面显示统一使用 16:9 比例，相关 CSS 类包括：

- `.cover-wrap`：视频列表卡片封面
- `.operation-video-thumb`：操作记录小缩略图
- `.player`：视频播放器

## 9. 当前部署上下文

当前服务器部署目标：腾讯云 CVM + Docker Compose + PostgreSQL 容器 + 腾讯云 COS。

服务器已使用过的端口规划：

| 服务 | 容器端口 | 服务器端口 | 说明 |
|---|---:|---:|---|
| 前端 Next | 3001 | 3001 | 浏览器访问页面 |
| 后端 API | 3000 | 3002 | 浏览器请求 API |
| PostgreSQL | 5432 | 15432 | 避免和宿主机 5432 冲突 |

对象文件不通过服务器 9000 端口访问，而是通过腾讯云 COS 公开地址访问。

腾讯云安全组至少需要放行：

```txt
3001
3002
```

如果后续接入 Nginx、域名和 HTTPS，可再把前端和后端挂到 80/443。

## 10. Git 和提交注意事项

`.gitignore` 当前应排除：

```txt
node_modules
dist
.next
.env
uploads/temp/*
```

提交到 GitHub 前要确认不要提交：

- `.env`
- `node_modules`
- `.next`
- 真实密钥
- 大体积临时上传文件

可以提交：

- `.env.example`
- `docker-compose.yml`
- 前后端源码
- Dockerfile
- 学习笔记

## 11. 服务器更新代码流程

本地修改并推送后，服务器执行：

```bash
cd ~/player
git pull
```

如果 `.env` 已存在，一般不要覆盖，只检查内容：

```bash
cat .env
```

然后重建并启动：

```bash
docker compose -p video_player --env-file .env down
docker compose -p video_player --env-file .env up -d --build
```

验证：

```bash
curl http://localhost:3002/api/health
curl -I http://localhost:3001
```

## 12. 当前已实现：角色、班级、学生主页课程系统

项目已拆成学员前台和老师/教导主任后台。

### 12.1 页面规划

```txt
/                              学员首页；游客模式下只显示视频列表和搜索
/login                         统一登录页，支持学员/老师/教导主任；左上角可进入游客模式
/admin                         老师/教导主任后台，按角色显示不同内容
/admin/login                   老师/教导主任登录页
/admin/upload                  独立上传课程视频页，支持封面/标题/简介预览和前置知识点选择
/admin/users                   学员管理；老师只看本班，教导主任看全部
/admin/users/[id]/assignments  编辑指定学员主页置顶课程视频、作业备注、查看历史操作
/admin/classes                 班级管理，仅教导主任可操作
/admin/admins                  老师/教导主任账号管理，仅教导主任可操作
/videos/[id]                   视频播放页，公开访问，显示资料附件和前置知识点
```

### 12.2 账号体系

默认测试账号：

```txt
教导主任：admin        / 123456
老师：    teacher_a    / 123456（负责一班）
老师：    teacher_b    / 123456（负责二班）
学员：    student_a1   / 123456（一班）
学员：    student_a2   / 123456（一班）
学员：    student_a3   / 123456（一班）
学员：    student_b1   / 123456（二班）
学员：    student_b2   / 123456（二班）
学员：    student_b3   / 123456（二班）
```

账号由后端启动时写入 PostgreSQL。数据库中不保存明文密码，均保存 bcrypt hash。

### 12.3 鉴权方案

学员使用独立 HttpOnly Cookie，老师和教导主任共用另一套 HttpOnly Cookie：

学员：

```txt
POST /api/user/login    登录，设置 HttpOnly Cookie
GET  /api/user/me       检查当前学员登录状态
POST /api/user/logout   退出登录，清除 Cookie
```

老师 / 教导主任：

```txt
POST /api/admin/login    登录，设置 HttpOnly Cookie
GET  /api/admin/me       检查当前登录状态，返回 role
POST /api/admin/logout   退出登录，清除 Cookie
```

Cookie 设置原则：

- `httpOnly: true`
- `sameSite: 'lax'`
- `secure` 根据 `FRONTEND_URL` 自动判断或 `COOKIE_SECURE` 强制覆盖
- token 有过期时间

后端必须保护管理员接口，不能只靠前端隐藏按钮。

### 12.4 权限边界

公开接口：

```txt
GET /api/videos
GET /api/videos/:id
```

学员接口（需要 user_token Cookie）：

```txt
GET  /api/user/me
POST /api/user/logout
GET  /api/user/assignments/today
```

老师和教导主任共有接口（需要 admin_token Cookie）：

```txt
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
GET  /api/admin/users
POST /api/admin/users
POST /api/admin/users/:userId/assignments
PATCH /api/admin/assignments/:id/cancel
PATCH /api/admin/assignments/:id/delete
PATCH /api/admin/operations/:operationId/delete
POST /api/videos/multipart/create
POST /api/videos/multipart/part-url
POST /api/videos/multipart/complete
POST /api/videos/multipart/abort
POST /api/videos/complete
```

仅教导主任可用：

```txt
GET    /api/admin/classes
POST   /api/admin/classes
PATCH  /api/admin/classes/:id
DELETE /api/admin/classes/:id
GET    /api/admin/admins
POST   /api/admin/admins
POST   /api/admin/admins/:id/reset-password
DELETE /api/admin/admins/:id
PATCH  /api/admin/users/:id/class
DELETE /api/videos/:id
```

上传仍然保持前端直传腾讯云 COS：

```txt
老师/教导主任浏览器 -> 后端获取预签名分片 URL -> 浏览器分片 PUT 到 COS -> 后端 Complete Multipart -> 后端写数据库和前置知识关系
```

文件内容不经过后端中转。

### 12.5 搜索和日期筛选

视频列表接口支持 query 参数：

```txt
GET /api/videos?keyword=关键词&startDate=2026-01-01&endDate=2026-01-31
```

筛选规则：

- `keyword` 同时匹配标题和简介
- `startDate` 按 `created_at >= startDate`
- `endDate` 包含结束日期当天
- 前后端都做基础边界校验，最终以后端校验为准

## 13. 后续建议任务

建议按这个顺序继续：

1. 为服务器配置域名
2. 使用 Nginx 反向代理前端和后端
3. 配置 HTTPS，并把 `FRONTEND_URL` / `NEXT_PUBLIC_API_BASE_URL` 改为 https://域名
4. 按实际域名收紧 COS CORS 配置
5. 增加分页、编辑视频信息等功能
6. 增加学生主页置顶课程有效期、用户观看进度等

## 14. 新对话接手提示

如果后续开新对话，可以先让助手阅读：

1. [README.md](file:///c:/Users/user/Desktop/播放器/README.md)
2. [memory/README.md](file:///c:/Users/user/Desktop/播放器/memory/README.md)
3. [memory/project-study-notes.md](file:///c:/Users/user/Desktop/播放器/memory/project-study-notes.md)
4. 如果继续部署，再重点看本 README 的“服务器部署流程”和“当前部署上下文”。

一句话交接：

```txt
这是一个 Next.js + Express + PostgreSQL + 腾讯云 COS / S3 兼容对象存储的视频播放器教学项目；当前包含学员/老师/教导主任三角色、班级管理、登录角色严格校验、独立课程视频上传页、封面标题简介预览、附件上传、课程前置知识点、学生主页置顶课程视频和作业备注、操作记录按 operation 聚合、游客模式浏览公开视频；admin 是默认教导主任且不带班，老师至少保留一个；本地 Docker 试用使用根目录 .env.local，服务器部署使用根目录 .env，上传采用后端创建 COS Multipart 任务、浏览器分片直传、后端合并分片、完成后后端入库的流程。
```
