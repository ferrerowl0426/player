# 播放器项目学习记忆文档

这个文档用来记录当前 Node.js 全栈播放器项目的技术栈、文件架构，以及每个部分适合重点练习的知识点。

## 1. 项目定位

这是一个前后端分离的视频播放器学习项目。

核心功能包括：

- 用户上传视频
- 上传时填写标题、介绍、封面图片
- 首页以卡片形式展示视频
- 点击视频进入播放页
- 删除已上传视频
- 后端提供 REST API，方便以后接入小程序
- PostgreSQL 保存视频元数据
- MinIO / S3 兼容存储桶保存视频和封面文件

项目重点不是做复杂业务，而是练习完整的全栈链路：

```txt
前端页面 -> 后端 API -> PostgreSQL 数据库 -> 对象存储桶
```

## 2. 技术栈

### 2.1 前端技术

前端 Next.js 固定使用：

```txt
http://localhost:3001
```

后端 Express 固定使用：

```txt
http://localhost:3000
```

这样可以避免 Next.js 和 Express 同时抢占 `3000` 端口。

使用技术：

- Next.js
- React
- JavaScript
- HTML
- CSS

相关文件：

```txt
frontend/
├── app/
│   ├── globals.css
│   ├── layout.js
│   ├── page.js
│   └── videos/
│       └── [id]/
│           └── page.js
├── lib/
│   └── api.js
├── next.config.js
└── package.json
```

重点练习：

- Next.js App Router 基础结构
- React 组件写法
- JSX 语法
- `useState` 管理页面状态
- `useEffect` 进入页面后加载数据
- `FormData` 上传文件
- `fetch` 请求后端 API
- Next.js 动态路由，例如 `/videos/[id]`
- Next.js 全局布局 `layout.js`
- CSS Grid 卡片布局
- HTML `video` 播放器基础用法
- React 组件卸载时暂停媒体播放
- Next.js `<Link>` 和普通 `<a href>` 的区别
- 视频播放页返回首页时的媒体资源释放问题
- 上传表单边界校验：标题长度、介绍长度、文件大小、文件格式
- 前端校验和后端校验的职责区别
- `null` / `undefined` / `NaN` 字符串这类无意义输入处理
- 数据库记录和存储桶文件的一致性问题
- 孤儿文件的概念和清理脚本写法
- 删除跨系统资源时的操作顺序
- 响应式页面布局
- 前后端分离时如何调用 Express API

### 2.2 后端技术

后端目录：`backend/`

使用技术：

- Node.js
- Express
- multer
- pg
- dotenv
- AWS S3 SDK
- uuid
- nodemon

相关文件：

```txt
backend/
├── .env
├── .env.example
├── package.json
└── src/
    ├── config.js
    ├── db.js
    ├── server.js
    ├── storage.js
    ├── upload.js
    └── videos.routes.js
```

重点练习：

- Express 创建 HTTP 服务
- REST API 设计
- 中间件的使用
- 文件上传处理
- 数据库连接池
- 环境变量配置
- 对象存储桶上传和删除
- 后端错误处理
- 前后端跨域 CORS

### 2.3 数据库技术

数据库目录：`database/`

使用技术：

- PostgreSQL
- SQL 建表语句
- 索引

相关文件：

```txt
database/
└── schema.sql
```

重点练习：

- 表结构设计
- 主键 `id`
- 字符串字段和文本字段
- 时间字段 `created_at`
- 用数据库保存文件 URL，而不是保存文件本身
- 用索引优化按创建时间排序的查询

### 2.4 存储桶技术

本地学习使用：

- MinIO

后续云服务可替换为：

- 腾讯云 COS
- 阿里云 OSS
- AWS S3

项目使用 AWS S3 SDK 操作对象存储，因为 MinIO 兼容 S3 协议。

重点练习：

- 什么是对象存储
- 什么是 bucket
- 视频和图片为什么不直接存数据库
- 上传文件到存储桶
- 删除存储桶里的文件
- 数据库保存文件访问 URL
- 本地 MinIO 和云厂商 COS/OSS 的关系

### 2.5 Docker 技术

相关文件：

```txt
docker-compose.yml
```

项目里 Docker 负责启动：

- PostgreSQL
- MinIO
- 自动创建 MinIO bucket 的一次性任务

重点练习：

- Docker Compose 管理多个服务
- `services` 的含义
- `image` 镜像的含义
- `container_name` 容器名称
- `ports` 端口映射
- `volumes` 数据持久化
- 容器之间通过服务名通信
- 本地端口冲突如何处理

当前项目中 PostgreSQL 映射端口是：

```txt
宿主机 15432 -> 容器 5432
```

这样可以避免和电脑上已有的 PostgreSQL `5432` 端口冲突。

## 3. 文件架构说明

### 3.1 根目录

```txt
播放器/
├── backend/
├── database/
├── frontend/
├── memory/
├── docker-compose.yml
├── package.json
├── README.md
└── .gitignore
```

各目录职责：

| 路径 | 职责 |
|---|---|
| `backend/` | 后端 API 服务 |
| `frontend/` | 前端页面 |
| `database/` | 数据库初始化 SQL |
| `memory/` | 学习笔记和项目记忆文档 |
| `docker-compose.yml` | 本地 PostgreSQL 和 MinIO 服务配置 |
| `README.md` | 项目启动说明 |
| `.gitignore` | Git 忽略规则 |

### 3.2 后端 src 目录

```txt
backend/src/
├── config.js
├── db.js
├── server.js
├── storage.js
├── upload.js
└── videos.routes.js
```

#### config.js

作用：读取 `.env` 环境变量，并整理成统一的配置对象。

重点练习：

- `dotenv` 的使用
- 环境变量和代码分离
- 为什么密码、密钥不能写死在代码里
- 使用绝对路径读取 `.env`，避免启动目录不同导致配置读取失败

#### db.js

作用：创建 PostgreSQL 连接池。

重点练习：

- `pg.Pool` 的使用
- 数据库连接池概念
- 后端如何连接 PostgreSQL

#### server.js

作用：创建 Express 应用，注册中间件和路由。

重点练习：

- Express 服务启动
- CORS 跨域配置
- JSON 请求体解析
- 路由挂载
- 统一错误处理

#### upload.js

作用：配置 `multer`，处理前端上传的视频文件和封面图片。

重点练习：

- `multipart/form-data`
- 文件上传中间件
- 文件类型校验
- 文件大小限制
- 临时文件保存目录

#### storage.js

作用：封装存储桶上传、删除、URL 和 key 转换逻辑。

重点练习：

- S3 Client 初始化
- `PutObjectCommand` 上传对象
- `DeleteObjectCommand` 删除对象
- bucket、key、public URL 的区别
- MinIO 和腾讯云 COS 的迁移思路

#### videos.routes.js

作用：实现视频相关 API。

当前接口：

```txt
GET    /api/videos      获取视频列表
GET    /api/videos/:id  获取视频详情
POST   /api/videos      上传视频
DELETE /api/videos/:id  删除视频
```

重点练习：

- RESTful API 设计
- 查询数据库
- 插入数据库
- 删除数据库记录
- 上传文件到存储桶
- 删除存储桶文件
- 接口错误返回
- 前端和小程序都可以复用同一套 API

### 3.3 前端目录

```txt
frontend/
├── app/
│   ├── globals.css
│   ├── layout.js
│   ├── page.js
│   └── videos/
│       └── [id]/
│           └── page.js
├── lib/
│   └── api.js
├── next.config.js
└── package.json
```

#### app/layout.js

作用：定义整个 Next.js 前端的根布局。

主要功能：

- 设置页面 HTML 语言
- 设置全站标题和描述
- 渲染顶部导航栏
- 通过 `{children}` 显示不同页面内容

重点练习：

- Next.js App Router 的布局机制
- 全站公共结构如何抽取
- `metadata` 设置页面基础信息

#### app/page.js

作用：首页页面组件。

主要功能：

- 渲染上传表单
- 获取视频列表
- 渲染视频卡片
- 删除视频
- 刷新视频列表

重点练习：

- React 函数组件
- `'use client'` 客户端组件
- `useState` 保存状态
- `useEffect` 页面加载后请求数据
- 表单提交事件
- `FormData` 上传文件
- 点击按钮触发删除操作

#### app/videos/[id]/page.js

作用：视频详情播放页。

主要功能：

- 根据 URL 里的 `id` 获取视频详情
- 使用 `components/VideoPlayer.js` 播放视频
- 离开播放页时自动暂停并释放视频资源
- 显示标题、发布时间和介绍

重点练习：

- Next.js 动态路由
- `params` 路由参数
- 服务端组件请求后端接口
- 详情页渲染

#### lib/api.js

作用：集中封装前端请求后端 API 的函数。

当前函数：

```txt
fetchVideos()      获取视频列表
fetchVideoById()   获取单个视频详情
uploadVideo()      上传视频
deleteVideo()      删除视频
```

重点练习：

- `fetch` 基础用法
- GET / POST / DELETE 请求
- `FormData` 上传文件
- 前端统一处理接口错误
- API 地址集中管理
- 使用 `NEXT_PUBLIC_API_BASE_URL` 配置前端接口地址

#### app/globals.css

作用：传统 CSS 页面样式。

重点练习：

- 页面整体布局
- 表单样式
- 视频卡片样式
- CSS Grid
- hover 效果
- 响应式媒体查询
- 不使用 Tailwind 时如何组织 CSS

## 4. 数据流说明

### 4.1 上传视频流程

```txt
1. 用户在前端填写标题、介绍
2. 用户选择视频文件和封面图片
3. 前端使用 FormData 提交到 POST /api/videos
4. 后端 multer 接收临时文件
5. 后端上传视频到存储桶 videos/ 目录
6. 后端上传封面到存储桶 covers/ 目录
7. 后端把标题、介绍、视频 URL、封面 URL 保存到 PostgreSQL
8. 后端返回新视频数据
9. 前端刷新视频列表
```

重点练习：

- 文件上传完整链路
- 临时文件和对象存储的区别
- 数据库只保存元数据

### 4.2 首页加载流程

```txt
1. 前端进入首页
2. 调用 GET /api/videos
3. 后端从 PostgreSQL 查询视频列表
4. 按 created_at 倒序返回
5. 前端渲染视频卡片
```

重点练习：

- 前端列表渲染
- 后端查询接口
- SQL 排序

### 4.3 播放视频流程

```txt
1. 用户点击视频卡片
2. 前端 hash 变成 #/video/:id
3. 前端调用 GET /api/videos/:id
4. 后端返回视频详情
5. 前端用 video 标签播放视频 URL
```

重点练习：

- Next.js 动态路由参数
- 详情接口
- HTML5 video 标签

### 4.4 删除视频流程

```txt
1. 用户点击删除视频
2. 前端弹出确认框
3. 前端调用 DELETE /api/videos/:id
4. 后端从数据库删除记录并拿到 video_url、cover_url
5. 后端根据 URL 还原存储桶 key
6. 后端删除存储桶里的视频和封面
7. 前端刷新视频列表
```

重点练习：

- DELETE 接口
- 删除数据库记录
- 删除对象存储文件
- 前端危险操作二次确认

## 5. 当前项目重点知识点清单

### 前后端分离

练习目标：

- 前端只负责页面和交互
- 后端只负责 API、数据库、文件存储
- 前端通过 HTTP 请求访问后端
- 后端接口以后可以给小程序复用

### REST API

练习目标：

- `GET` 用来查询
- `POST` 用来创建
- `DELETE` 用来删除
- API 返回 JSON
- 错误时返回合适的状态码和 message

### PostgreSQL

练习目标：

- 建表
- 插入数据
- 查询列表
- 查询详情
- 删除记录
- 使用连接池
- 理解数据库只保存文件 URL

### 对象存储

练习目标：

- 文件不放数据库
- 视频和封面上传到 bucket
- 数据库保存 URL
- 删除视频时同步删除对象文件
- 本地 MinIO 和云 COS 的配置差异

### Docker

练习目标：

- 用 Docker 启动开发依赖
- 理解容器、镜像、数据卷、端口映射
- 解决端口冲突
- 用 Docker Compose 管理 PostgreSQL 和 MinIO

### 原生前端

练习目标：

- 不使用 Tailwind
- 使用传统 HTML + CSS + JS
- 手写页面结构
- 手写样式
- 手写请求逻辑
- 理解浏览器和后端如何交互

## 6. 常用命令

### 安装依赖

```bash
npm install
npm run install:all
```

### 启动 Docker 服务

```bash
docker compose -p video_player up -d
```

### 查看 Docker 服务

```bash
docker compose -p video_player ps
```

### 启动后端

```bash
npm run dev --prefix backend
```

### 启动前端

```bash
npm run dev --prefix frontend
```

### 构建前端

```bash
npm run build --prefix frontend
```

### 检查后端语法

```bash
node --check backend/src/server.js
node --check backend/src/videos.routes.js
node --check backend/src/storage.js
```

## 7. 后续可以继续练习的方向

### 用户系统

可以练习：

- 注册
- 登录
- JWT
- 密码加密
- 只有作者可以删除自己的视频

### 评论系统

可以练习：

- 评论表设计
- 视频和评论的一对多关系
- 分页查询

### 分页和搜索

可以练习：

- `limit` / `offset`
- 按标题搜索
- 按时间排序
- 首页分页加载

### 腾讯云 COS

可以练习：

- 用腾讯云 COS 替换 MinIO
- 配置 `SecretId` / `SecretKey`
- 配置 bucket 权限
- 配置 CDN 加速域名

### 全 Docker 部署

可以练习：

- 后端 Dockerfile
- 前端 Dockerfile
- Nginx 托管前端
- docker-compose 管理完整项目

### 小程序接入

可以练习：

- 小程序调用同一套后端 API
- 小程序上传文件
- 小程序播放视频
- 前后端分离接口复用
