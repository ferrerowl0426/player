# Node.js 全栈视频播放器学习项目交接文档

这是一个用于教学和练习的前后端分离视频播放器项目。当前文档既是项目 README，也是后续新对话继续接手时的交接说明。

## 1. 项目当前定位

项目目标不是做复杂业务，而是通过一个完整的视频上传和播放项目，练习全栈开发链路：

```txt
Next.js 前端页面 -> Express 后端 API -> PostgreSQL 数据库 -> MinIO / S3 兼容对象存储
```

核心功能：

- 上传视频、标题、介绍、封面图
- 首页卡片形式展示视频列表
- 点击视频进入播放页
- 删除视频
- 删除时同步删除数据库记录和存储桶文件
- 使用清理脚本排查和删除孤儿文件
- 后端提供 REST API，后续可继续接入小程序或云对象存储

## 2. 当前技术栈

### 前端

- Next.js App Router
- React
- JavaScript
- CSS
- HTML `video`

前端默认端口：

```txt
http://localhost:3001
```

### 后端

- Node.js
- Express
- multer
- pg
- dotenv
- AWS S3 SDK
- uuid

后端默认端口：

```txt
http://localhost:3000
```

### 数据库和存储

- PostgreSQL：保存视频元数据
- MinIO：本地 S3 兼容对象存储，用于保存视频和封面
- 后续计划：可把 MinIO 替换或迁移到腾讯云 COS

### Docker

当前 [docker-compose.yml](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/docker-compose.yml) 负责启动：

- PostgreSQL
- MinIO
- 创建 MinIO bucket 的一次性任务

目前还没有把前端、后端加入 Docker Compose，也还没有 Dockerfile。后续腾讯云部署会继续补充。

## 3. 项目目录结构

```txt
播放器/
├── backend/                 # Express 后端 API
│   ├── scripts/             # 后端脚本，例如孤儿文件清理
│   ├── src/                 # 后端源码
│   ├── .env.example         # 后端环境变量示例
│   ├── package.json
│   └── package-lock.json
├── database/                # PostgreSQL 初始化 SQL
│   └── schema.sql
├── frontend/                # Next.js 前端
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── next.config.js
│   ├── package.json
│   └── package-lock.json
├── memory/                  # 项目长期记忆和学习复盘
├── docker-compose.yml       # PostgreSQL + MinIO 本地容器配置
├── package.json             # 根目录快捷命令
├── package-lock.json
├── .gitignore
└── README.md
```

## 4. 关键文件说明

### 后端关键文件

| 文件 | 作用 |
|---|---|
| [config.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/config.js) | 读取 `.env`，集中管理端口、数据库、S3 配置 |
| [server.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/server.js) | Express 服务入口，配置 CORS、JSON、健康检查和视频路由 |
| [db.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/db.js) | PostgreSQL 连接池 |
| [storage.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/storage.js) | 上传、删除、列出 S3 / MinIO 对象 |
| [upload.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/upload.js) | multer 上传配置、文件大小、MIME 和扩展名限制 |
| [videos.routes.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/src/videos.routes.js) | 视频列表、详情、上传、删除 API |
| [clean-orphan-objects.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/backend/scripts/clean-orphan-objects.js) | 清理存储桶孤儿文件脚本 |

### 前端关键文件

| 文件 | 作用 |
|---|---|
| [page.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/frontend/app/page.js) | 首页，包含上传表单和视频列表 |
| [page.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/frontend/app/videos/%5Bid%5D/page.js) | 视频详情播放页 |
| [VideoPlayer.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/frontend/components/VideoPlayer.js) | 客户端视频播放器组件，处理播放清理和避免叠音 |
| [api.js](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/frontend/lib/api.js) | 前端请求后端 API 的封装 |
| [globals.css](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/frontend/app/globals.css) | 全局样式 |

### 数据库文件

| 文件 | 作用 |
|---|---|
| [schema.sql](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/database/schema.sql) | 创建 `videos` 表和 `created_at` 索引 |

`videos` 表保存：

- `id`
- `title`
- `description`
- `video_url`
- `cover_url`
- `created_at`

注意：视频文件和封面图片不进数据库，只保存到对象存储桶。

## 5. memory 目录说明

[memory](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory) 是本项目的长期记忆目录，用于防止开新对话后上下文丢失。

已有文档：

| 文件 | 内容 |
|---|---|
| [README.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/README.md) | memory 目录索引 |
| [project-study-notes.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/project-study-notes.md) | 项目定位、技术栈、文件职责、数据流、学习重点 |
| [bug-video-audio-overlap.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/bug-video-audio-overlap.md) | 播放页返回首页后视频叠音 Bug 复盘 |
| [validation-notes.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/validation-notes.md) | 上传表单前后端边界校验学习记录 |
| [storage-sync-notes.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/storage-sync-notes.md) | 数据库和存储桶同步、孤儿文件、清理脚本学习记录 |

后续如果继续做 Docker、腾讯云 COS、服务器部署，也建议在 `memory/` 里继续新增部署记录。

## 6. 本地启动流程

### 6.1 安装依赖

```bash
npm install
npm run install:all
```

### 6.2 启动 PostgreSQL 和 MinIO

需要先安装 Docker Desktop，然后在项目根目录执行：

```bash
docker compose up -d
```

MinIO 控制台：

```txt
http://localhost:9001
```

默认账号密码：

```txt
账号：minioadmin
密码：minioadmin
```

`docker-compose.yml` 会自动创建公开可读的 `videos` bucket。

### 6.3 创建数据库表

如果电脑安装了 `psql`：

```bash
npm run db:init
```

或者手动连接数据库后执行：

```txt
database/schema.sql
```

本地数据库连接信息：

```txt
Host: localhost
Port: 15432
User: postgres
Password: postgres
Database: video_player
```

注意：Compose 中 PostgreSQL 是：

```txt
宿主机 15432 -> 容器 5432
```

这样是为了避免和本机已有 PostgreSQL 的 `5432` 冲突。

### 6.4 配置后端环境变量

复制：

```txt
backend/.env.example -> backend/.env
```

本地默认配置通常不用改。

关键配置示例：

```txt
PORT=3000
FRONTEND_URL=http://localhost:3001
DATABASE_URL=postgresql://postgres:postgres@localhost:15432/video_player
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=videos
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
PUBLIC_BUCKET_BASE_URL=http://localhost:9000/videos
```

### 6.5 启动前后端

```bash
npm run dev
```

访问：

```txt
前端：http://localhost:3001
后端健康检查：http://localhost:3000/api/health
视频接口：http://localhost:3000/api/videos
```

## 7. 当前已实现的重要逻辑

### 7.1 上传校验

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

原则：

```txt
前端校验是为了体验，后端校验才是真正安全。
```

### 7.2 视频播放叠音修复

之前出现过：从视频播放页返回首页后，声音还在播放，甚至出现叠音。

最终处理：

- 播放页使用 `VideoPlayer` 客户端组件
- 返回首页使用普通 `<a href="/">`，不用 Next.js `<Link>`
- `VideoPlayer` 卸载时只做温和清理：移除监听、暂停视频
- 不再在 cleanup 中强行 `removeAttribute('src')` 和 `load()`，避免破坏进度条状态

详见：[bug-video-audio-overlap.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/bug-video-audio-overlap.md)

### 7.3 数据库和存储桶同步

项目中：

```txt
PostgreSQL 保存“文件在哪里”
MinIO / S3 保存“文件本体”
```

删除视频时要维护两边一致性。

当前思路：

```txt
1. 先查询数据库记录
2. 根据 video_url / cover_url 删除存储桶对象
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

详见：[storage-sync-notes.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/storage-sync-notes.md)

## 8. 当前部署上下文

当前正在准备把项目部署到腾讯云服务器。

服务器已确认信息：

```txt
系统：Ubuntu 24.04.4 LTS
Docker：已安装，版本 29.4.1
Docker Compose：已安装，版本 v5.1.3
已有旧项目：PM2 运行 learn-next-pg-todo
旧项目端口：3000
Nginx 已占用：80、888
PostgreSQL 已占用：5432
MySQL 已占用：3306
SSH：22
宝塔面板可能占用：36999
```

已检查以下端口无输出，说明暂时空闲：

```txt
3001
3002
9000
9001
15432
```

建议服务器 Docker 部署端口规划：

| 服务 | 容器端口 | 服务器端口 | 说明 |
|---|---:|---:|---|
| 旧 PM2 项目 | 3000 | 3000 | 保持不动 |
| 新项目前端 Next | 3001 | 3001 | 先直接测试访问 |
| 新项目后端 API | 3000 或 3002 | 3002 | 建议对外映射 3002，避免冲突 |
| 新项目 PostgreSQL | 5432 | 15432 | 避免服务器已有 5432 |
| MinIO API | 9000 | 9000 | 临时对象存储 |
| MinIO 控制台 | 9001 | 9001 | 管理存储桶 |

当前建议部署路线：

```txt
本地项目 -> GitHub -> 腾讯云服务器 git clone -> 服务器 docker compose build/up
```

暂时不需要 DockerHub。DockerHub 后续适合 CI/CD 或镜像分发，现在学习阶段先让服务器直接构建镜像更简单。

腾讯云 COS 已申请，但暂时未接入服务器。当前仍以 MinIO 作为学习用对象存储。

## 9. Git 和提交注意事项

`.gitignore` 当前已排除：

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

当前计划是先初始化 Git，然后推送到 GitHub，再在腾讯云服务器拉取代码。

## 10. 后续建议任务

建议按这个顺序继续：

1. 初始化 Git，并确认 `git status` 没有敏感文件
2. 创建 GitHub 仓库并推送代码
3. 为 `backend/` 添加 Dockerfile
4. 为 `frontend/` 添加 Dockerfile
5. 扩展 `docker-compose.yml`，加入 frontend 和 backend 服务
6. 在服务器上 `git clone` 项目
7. 在服务器配置生产环境 `.env`
8. 执行 `docker compose build`
9. 执行 `docker compose up -d`
10. 初始化数据库表
11. 测试前端、后端、上传、播放、删除
12. 再考虑 Nginx 域名转发、HTTPS、腾讯云 COS 接入

## 11. 新对话接手提示

如果后续开新对话，可以先让助手阅读：

1. [README.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/README.md)
2. [memory/README.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/README.md)
3. [project-study-notes.md](file:///c:/Users/user/Desktop/%E6%92%AD%E6%94%BE%E5%99%A8/memory/project-study-notes.md)
4. 如果继续部署，再重点看本 README 的“当前部署上下文”和“后续建议任务”。

一句话交接：

```txt
这是一个 Next.js + Express + PostgreSQL + MinIO 的视频播放器教学项目，目前本地功能已实现，正在准备通过 GitHub 把代码拉到腾讯云服务器，并补充 Dockerfile / docker-compose 完成 Docker 部署；服务器已有 PM2 旧项目占用 3000，部署时不要影响旧项目。
```
