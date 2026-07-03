# Node.js 全栈视频播放器学习项目交接文档

这是一个用于教学和练习的前后端分离视频播放器项目。当前文档既是项目 README，也是后续新对话继续接手时的交接说明。

## 1. 项目当前定位

项目目标不是做复杂业务，而是通过一个完整的视频上传和播放项目，练习全栈开发链路：

```txt
Next.js 前端页面 -> Express 后端 API -> PostgreSQL 数据库 -> 腾讯云 COS / S3 兼容对象存储
```

核心功能：

- 上传视频、标题、介绍、封面图
- 首页卡片形式展示视频列表
- 点击视频进入播放页
- 删除视频
- 删除时同步删除数据库记录和存储桶文件
- 使用清理脚本排查和删除孤儿文件
- 后端提供 REST API，后续可继续接入小程序或其他客户端

当前上传方式：

```txt
浏览器 -> 后端 Express -> 腾讯云 COS
```

也就是说，前端不再直传 COS，而是把 `FormData` 提交给后端，由后端上传到对象存储并保存数据库记录。

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
- multer
- pg
- dotenv
- AWS S3 SDK
- uuid

Docker 部署时后端 API 对外端口：

```txt
http://服务器IP:3002
```

容器内部后端端口：

```txt
3000
```

### 数据库和存储

- PostgreSQL：保存视频元数据
- 腾讯云 COS：保存视频文件和封面图片
- AWS S3 SDK：后端通过 S3 兼容协议上传、删除、列出对象

数据库只保存文件 URL，不保存文件本体。

### Docker

当前 [docker-compose.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.yml) 负责启动：

- PostgreSQL
- Express 后端
- Next.js 前端

当前版本已经移除 MinIO 服务。服务器部署时只需要配置根目录 `.env`，填写服务器地址和腾讯云 COS 密钥即可。

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
├── docker-compose.yml       # PostgreSQL + 后端 + 前端容器配置
├── package.json             # 根目录快捷命令
├── package-lock.json
├── .gitignore
└── README.md
```

## 4. 关键文件说明

### 后端关键文件

| 文件 | 作用 |
|---|---|
| [config.js](file:///c:/Users/user/Desktop/播放器/backend/src/config.js) | 读取环境变量，集中管理端口、数据库、S3/COS 配置 |
| [server.js](file:///c:/Users/user/Desktop/播放器/backend/src/server.js) | Express 服务入口，配置 CORS、JSON、健康检查和视频路由 |
| [db.js](file:///c:/Users/user/Desktop/播放器/backend/src/db.js) | PostgreSQL 连接池 |
| [storage.js](file:///c:/Users/user/Desktop/播放器/backend/src/storage.js) | 上传、删除、列出 S3/COS 对象 |
| [upload.js](file:///c:/Users/user/Desktop/播放器/backend/src/upload.js) | multer 上传配置、文件大小、MIME 和扩展名限制 |
| [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js) | 视频列表、详情、上传、删除 API |
| [clean-orphan-objects.js](file:///c:/Users/user/Desktop/播放器/backend/scripts/clean-orphan-objects.js) | 清理存储桶孤儿文件脚本 |

### 前端关键文件

| 文件 | 作用 |
|---|---|
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/page.js) | 首页，包含上传表单和视频列表 |
| [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/videos/[id]/page.js) | 视频详情播放页 |
| [VideoPlayer.js](file:///c:/Users/user/Desktop/播放器/frontend/components/VideoPlayer.js) | 客户端视频播放器组件，处理播放清理和避免叠音 |
| [api.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/api.js) | 前端请求后端 API 的封装 |
| [globals.css](file:///c:/Users/user/Desktop/播放器/frontend/app/globals.css) | 全局样式 |

### 数据库文件

| 文件 | 作用 |
|---|---|
| [schema.sql](file:///c:/Users/user/Desktop/播放器/database/schema.sql) | 创建 `videos` 表和 `created_at` 索引 |

`videos` 表保存：

- `id`
- `title`
- `description`
- `video_url`
- `cover_url`
- `created_at`

注意：视频文件和封面图片不进数据库，只保存到对象存储桶。

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

S3_ENDPOINT=https://cos.ap-nanjing.myqcloud.com
S3_REGION=ap-nanjing
S3_BUCKET=你的存储桶名称
S3_ACCESS_KEY_ID=你的SecretId
S3_SECRET_ACCESS_KEY=你的SecretKey
S3_FORCE_PATH_STYLE=false
PUBLIC_BUCKET_BASE_URL=https://你的存储桶名称.cos.ap-nanjing.myqcloud.com
```

说明：

- `FRONTEND_URL`：后端 CORS 允许的前端地址
- `NEXT_PUBLIC_API_BASE_URL`：浏览器访问后端 API 的地址，会在前端镜像构建时写入前端包
- `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET`：腾讯云 COS 的 S3 兼容配置
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`：腾讯云访问密钥，不要提交到 Git
- `S3_FORCE_PATH_STYLE=false`：腾讯云 COS 使用虚拟主机风格访问
- `PUBLIC_BUCKET_BASE_URL`：浏览器访问视频和封面时使用的公开 COS 地址

### 6.3 启动或重建容器

```bash
docker compose down
docker compose up -d --build
```

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
```

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
POST http://服务器公网IP:3002/api/videos
```

不应再看到：

```txt
upload-url
videos/complete
.mp4?...签名参数
```

## 7. 本地开发说明

本地主要用于代码开发和提交，不要求一定完整跑通腾讯云 COS。

如果本地也要启动 Docker 版本，需要在根目录创建 `.env`，并填写可用的 COS 配置：

```bash
cp .env.example .env
```

然后按需修改：

```env
FRONTEND_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3002/api
```

再启动：

```bash
docker compose up -d --build
```

如果只做代码开发，可分别安装依赖：

```bash
npm install
npm run install:all
```

再按项目脚本启动开发服务。

## 8. 当前已实现的重要逻辑

### 8.1 上传校验

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

### 8.2 上传数据流

当前上传流程：

```txt
1. 前端校验表单
2. 前端把 FormData POST 到 /api/videos
3. 后端 multer 接收视频和封面到临时目录
4. 后端上传视频到 COS 的 videos/ 前缀
5. 后端上传封面到 COS 的 covers/ 前缀
6. 后端把 video_url / cover_url 保存到 PostgreSQL
7. 前端刷新列表
```

这个方案比浏览器直传慢，因为文件会经过服务器中转，但部署和权限配置更简单。

### 8.3 视频播放叠音修复

之前出现过：从视频播放页返回首页后，声音还在播放，甚至出现叠音。

最终处理：

- 播放页使用 `VideoPlayer` 客户端组件
- 返回首页使用普通 `<a href="/">`，不用 Next.js `<Link>`
- `VideoPlayer` 卸载时只做温和清理：移除监听、暂停视频
- 不再在 cleanup 中强行 `removeAttribute('src')` 和 `load()`，避免破坏进度条状态

详见：[bug-video-audio-overlap.md](file:///c:/Users/user/Desktop/播放器/memory/bug-video-audio-overlap.md)

### 8.4 数据库和存储桶同步

项目中：

```txt
PostgreSQL 保存“文件在哪里”
腾讯云 COS 保存“文件本体”
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

详见：[storage-sync-notes.md](file:///c:/Users/user/Desktop/播放器/memory/storage-sync-notes.md)

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
docker compose down
docker compose up -d --build
```

验证：

```bash
curl http://localhost:3002/api/health
curl -I http://localhost:3001
```

## 12. 后续建议任务

建议按这个顺序继续：

1. 为服务器配置域名
2. 使用 Nginx 反向代理前端和后端
3. 配置 HTTPS
4. 优化大文件上传体验，例如进度条、上传中提示、超时提示
5. 如需提升上传速度，再重新研究浏览器直传 COS，并正确配置 COS CORS
6. 增加鉴权，避免任何人都能上传或删除视频
7. 增加分页、搜索、编辑视频信息等功能

## 13. 新对话接手提示

如果后续开新对话，可以先让助手阅读：

1. [README.md](file:///c:/Users/user/Desktop/播放器/README.md)
2. [memory/README.md](file:///c:/Users/user/Desktop/播放器/memory/README.md)
3. [project-study-notes.md](file:///c:/Users/user/Desktop/播放器/memory/project-study-notes.md)
4. 如果继续部署，再重点看本 README 的“服务器部署流程”和“当前部署上下文”。

一句话交接：

```txt
这是一个 Next.js + Express + PostgreSQL + 腾讯云 COS 的视频播放器教学项目；当前部署方式是服务器 git pull 后填写根目录 .env，再用 docker compose up -d --build 启动，上传采用后端中转到 COS，不走浏览器直传。
```
