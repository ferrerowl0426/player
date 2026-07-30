# Docker 部署调试复盘：数据卷、上传失败、详情页 fetch failed

本文记录本项目第一次把前后端加入 Docker Compose 后，遇到的几个典型问题和排查过程。

## 1. 背景

项目原来只用 Docker Compose 启动：

```txt
PostgreSQL
MinIO
create-bucket 一次性任务
```

后来为了准备部署到腾讯云服务器，新增了：

```txt
backend Express 容器
frontend Next.js 容器
```

目标端口规划：

| 服务 | 容器端口 | 宿主机端口 |
|---|---:|---:|
| frontend | 3001 | 3001 |
| backend | 3000 | 3002 |
| postgres | 5432 | 15432 |
| minio | 9000 / 9001 | 9000 / 9001 |

## 2. 问题一：容器名冲突

### 2.1 现象

执行：

```powershell
docker compose -p video-player up -d
```

报错：

```txt
Conflict. The container name "/video_player_minio" is already in use
```

### 2.2 原因

之前已经有旧容器：

```txt
video_player_minio
video_player_postgres
video_player_create_bucket
```

新 compose 也配置了相同的 `container_name`，所以 Docker 不允许创建同名容器。

`--remove-orphans` 没有解决，因为旧容器不属于当前 `video-player` compose 项目。

### 2.3 处理方式

删除旧容器，但不删除数据卷：

```powershell
docker rm -f video_player_minio video_player_postgres video_player_create_bucket
docker compose -p video-player up -d
```

注意：

```txt
不要执行 docker compose down -v
```

因为 `-v` 会删除数据卷。

## 3. 问题二：之前上传的数据“不见了”

### 3.1 现象

容器启动成功后，页面能打开，但原来上传过的视频列表没了。

### 3.2 排查

查看 Docker 数据卷：

```powershell
docker volume ls
```

发现有两套卷：

```txt
旧数据卷：video_player_postgres_data、video_player_minio_data
新数据卷：video-player_postgres_data、video-player_minio_data
```

当前容器使用的是新卷：

```txt
video-player_postgres_data
video-player_minio_data
```

所以数据库和 MinIO 都是空的。

### 3.3 根本原因

Docker Compose 默认会根据项目名生成数据卷名称。

这次命令使用了：

```powershell
docker compose -p video-player up -d
```

项目名是：

```txt
video-player
```

所以生成的新数据卷前缀也是：

```txt
video-player_
```

而旧数据卷是之前项目名生成的：

```txt
video_player_
```

中划线和下划线不同，导致挂载到了不同数据卷。

### 3.4 修复方式

在 `docker-compose.yml` 中固定使用旧数据卷，并声明为外部卷：

```yaml
volumes:
  postgres_data:
    external: true
    name: video_player_postgres_data
  minio_data:
    external: true
    name: video_player_minio_data
```

这样以后即使 compose 项目名变化，也会继续使用原来的数据卷。

### 3.5 学到的知识点

Docker Compose 数据卷名字和项目名有关。

如果不显式指定：

```yaml
volumes:
  postgres_data:
```

实际创建出来的卷可能是：

```txt
项目名_postgres_data
```

如果想固定使用已有卷，要写：

```yaml
external: true
name: 真实卷名
```

## 4. 问题三：上传失败

### 4.1 现象

页面列表恢复后，上传视频失败。

### 4.2 原因

后端使用 multer 临时保存上传文件。

相关代码：

```js
callback(null, path.resolve('uploads/temp'));
```

在本地开发时，这个目录可能已经存在。

但 Docker 镜像里没有自动创建：

```txt
/app/uploads/temp
```

所以 multer 写临时文件时可能失败。

### 4.3 修复方式

在后端 Dockerfile 中创建临时目录：

```dockerfile
RUN mkdir -p uploads/temp
```

### 4.4 学到的知识点

容器环境是干净的。

本地存在的临时目录、缓存目录，不一定会出现在 Docker 镜像中。

如果代码依赖某个目录存在，要么：

```txt
1. Dockerfile 构建时创建
2. 应用启动时创建
3. docker-compose 挂载 volume
```

本项目当前使用 Dockerfile 创建。

## 5. 问题四：播放详情页 server-side exception

### 5.1 现象

首页视频列表显示正常。

点击视频进入详情页后，页面显示：

```txt
Application error: a server-side exception has occurred while loading localhost
Digest: 211205327
```

### 5.2 排查

查看前端容器日志：

```powershell
docker logs --tail 120 video_player_frontend
```

看到错误：

```txt
ReferenceError: Link is not defined
```

### 5.3 原因

播放页正常分支已经使用普通 `<a>` 返回首页：

```jsx
<a className="back-link" href="/">← 返回首页</a>
```

但异常分支里还残留：

```jsx
<Link className="back-link" href="/">← 返回首页</Link>
```

并且文件里没有导入 `Link`。

所以一旦进入 catch 分支，Next.js 服务端渲染就会报：

```txt
Link is not defined
```

### 5.4 修复方式

把异常分支也改成普通 `<a>`：

```jsx
<a className="back-link" href="/">← 返回首页</a>
```

### 5.5 学到的知识点

Next.js 生产模式下，服务端渲染错误会显示 digest。

页面上不一定直接显示真实错误，要看容器日志：

```powershell
docker logs 容器名
```

## 6. 问题五：详情页显示 fetch failed

### 6.1 现象

修复 `Link is not defined` 后，详情页不再显示 server-side exception，但页面显示：

```txt
fetch failed
```

### 6.2 为什么首页正常，详情页失败

首页是客户端组件：

```js
'use client';
```

首页里的请求发生在浏览器中。

浏览器访问后端时，可以使用：

```txt
http://localhost:3002/api
```

因为 `localhost` 是用户电脑，`3002` 映射到了后端容器。

但详情页是服务端渲染页面，请求发生在前端容器内部。

在前端容器内部：

```txt
localhost
```

指的是前端容器自己，不是宿主机，也不是后端容器。

所以前端容器请求：

```txt
http://localhost:3002/api
```

会失败。

### 6.3 Docker 容器之间应该怎么访问

在同一个 Docker Compose 网络里，容器之间可以用服务名访问。

后端服务名是：

```yaml
backend:
```

后端容器内端口是：

```txt
3000
```

所以前端容器内部访问后端应使用：

```txt
http://backend:3000/api
```

### 6.4 修复方式

前端 API 封装区分两种地址：

```js
const BROWSER_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
const SERVER_API_BASE_URL = process.env.SERVER_API_BASE_URL || BROWSER_API_BASE_URL;

function getApiBaseUrl() {
  return typeof window === 'undefined' ? SERVER_API_BASE_URL : BROWSER_API_BASE_URL;
}
```

然后请求统一使用：

```js
fetch(`${getApiBaseUrl()}/videos`)
```

Compose 里给前端容器配置：

```yaml
frontend:
  environment:
    SERVER_API_BASE_URL: http://backend:3000/api
```

构建参数仍然给浏览器使用：

```yaml
args:
  NEXT_PUBLIC_API_BASE_URL: http://localhost:3002/api
```

### 6.5 学到的知识点

同一个 URL 在不同环境下含义不同。

| 运行位置 | `localhost` 指向谁 |
|---|---|
| 浏览器 | 用户电脑 / 服务器宿主机 |
| 前端容器 | 前端容器自己 |
| 后端容器 | 后端容器自己 |

所以 Docker 部署 Next.js 时，要特别注意：

```txt
浏览器请求地址
服务端渲染请求地址
```

它们可能不是同一个。

## 7. 最终相关修改

### 7.1 backend Dockerfile

创建上传临时目录：

```dockerfile
RUN mkdir -p uploads/temp
```

### 7.2 docker-compose.yml

使用旧数据卷：

```yaml
volumes:
  postgres_data:
    external: true
    name: video_player_postgres_data
  minio_data:
    external: true
    name: video_player_minio_data
```

给前端容器配置服务端 API 地址：

```yaml
frontend:
  environment:
    SERVER_API_BASE_URL: http://backend:3000/api
```

### 7.3 frontend/lib/api.js

区分浏览器请求和服务端请求：

```js
function getApiBaseUrl() {
  return typeof window === 'undefined' ? SERVER_API_BASE_URL : BROWSER_API_BASE_URL;
}
```

### 7.4 frontend/app/videos/[id]/page.js

异常分支里的 `Link` 改为普通 `a`。

## 8. 问题六：配置和初始化入口重复维护

### 8.1 现象

这次继续检查时发现几类重复维护问题：

```txt
1. schema.sql 和 db.js 都维护管理员表结构和默认密码 hash
2. config.js 维护 JWT 有效期，auth.js 又单独维护 Cookie maxAge
3. 首页和管理员页重复维护视频列表加载、搜索、重置逻辑
4. api.js 里分片 PUT 和封面 PUT 有两套 XMLHttpRequest 错误处理
5. videos.routes.js 里创建上传和完成上传重复校验标题、简介
```

### 8.2 管理员表初始化为什么要单一入口

[database/schema.sql](file:///c:/Users/user/Desktop/播放器/database/schema.sql) 只应该负责数据库基础表结构，例如 `videos` 表和索引。

管理员表和默认管理员账号更适合由后端启动时统一初始化。

原因是 Docker 命名卷已经存在时，`/docker-entrypoint-initdb.d/schema.sql` 不会再次执行。

如果旧环境没有 `admins` 表，只改 `schema.sql` 不一定生效。

所以当前统一为：

```txt
后端启动 -> ensureAdminSchema() -> 创建 admins 表 -> 初始化 admin 账号
```

这样旧环境升级、新环境初始化都走同一个入口。

### 8.3 登录有效期为什么统一用秒

[config.js](file:///c:/Users/user/Desktop/播放器/backend/src/config.js#L17-L21) 中统一维护：

```js
tokenExpiresInSeconds: 7 * 24 * 60 * 60
```

[auth.js](file:///c:/Users/user/Desktop/播放器/backend/src/auth.js#L4-L26) 中 JWT 和 Cookie 都使用这个值：

```txt
JWT expiresIn：秒
Cookie maxAge：秒 * 1000 转成毫秒
```

这样避免一边是 `7d`、另一边是 `7 * 24 * 60 * 60 * 1000`，以后修改登录有效期时漏改其中一处。

### 8.4 前后端重复逻辑处理

前端视频列表加载逻辑抽到 [useVideoList.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/useVideoList.js)：

```txt
列表状态
筛选条件
加载视频
搜索
重置
日期范围校验
```

首页 [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/page.js) 和管理员页 [page.js](file:///c:/Users/user/Desktop/播放器/frontend/app/admin/page.js) 共用它。

上传 PUT 进度和错误处理抽到 [api.js](file:///c:/Users/user/Desktop/播放器/frontend/lib/api.js#L41-L75) 的统一函数，避免分片上传和封面上传各维护一套 `XMLHttpRequest` 成功/失败逻辑。

后端标题、简介校验抽到 [videos.routes.js](file:///c:/Users/user/Desktop/播放器/backend/src/videos.routes.js#L42-L71) 的 `validateVideoText`，创建上传和完成入库都复用。

### 8.5 学到的知识点

重复维护最容易出现在：

```txt
配置值
初始化脚本
前后台相似页面
同类请求封装
接口的前置校验
```

原则：

```txt
一个事实只保留一个维护入口。
配置值统一放 config。
启动初始化优先放后端入口，避免依赖一次性 SQL。
相同交互流程优先抽 hook。
相同底层请求优先抽小函数。
```

## 9. 问题七：生产容器没有设置 NODE_ENV

### 9.1 现象

后端管理员登录 Cookie 的配置在 [auth.js](file:///c:/Users/user/Desktop/播放器/backend/src/auth.js#L19-L26) 中：

```js
secure: config.isProduction
```

而 `config.isProduction` 来自 [config.js](file:///c:/Users/user/Desktop/播放器/backend/src/config.js#L12-L17)：

```js
isProduction: process.env.NODE_ENV === 'production'
```

如果 Docker Compose 没有给后端容器设置 `NODE_ENV=production`，那么生产服务器上 `config.isProduction` 仍然是 `false`。

结果是生产环境管理员 Cookie 不会带 `Secure` 属性。

### 9.2 根本原因

Docker 容器不会自动等于 Node.js 生产环境。

即使使用 Docker 部署，只要没有显式设置：

```yaml
environment:
  NODE_ENV: production
```

Node.js 进程里的：

```js
process.env.NODE_ENV
```

就可能是 `undefined`。

所以代码里的生产判断不会生效。

### 9.3 修复方式

在生产 [docker-compose.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.yml#L23-L36) 的后端环境变量中加入：

```yaml
backend:
  environment:
    NODE_ENV: production
```

同时，本地 Docker 调试使用 HTTP，如果也继承 `production`，管理员登录 Cookie 会变成 `Secure` Cookie。

浏览器在普通 HTTP 页面下不会保存或发送 `Secure` Cookie，可能导致本地登录失败。

所以在本地叠加配置 [docker-compose.local.yml](file:///c:/Users/user/Desktop/播放器/docker-compose.local.yml#L33-L39) 中覆盖为：

```yaml
backend:
  environment:
    NODE_ENV: development
```

最终效果：

```txt
生产 docker-compose.yml：NODE_ENV=production，Cookie secure=true
本地 docker-compose.local.yml：NODE_ENV=development，Cookie secure=false
```

### 9.4 学到的知识点

环境判断必须由部署配置明确提供，不能因为“用了 Docker”就默认以为是生产环境。

记住：

```txt
Docker 是运行方式，不等于 NODE_ENV=production。
生产安全开关必须在 Compose / 环境变量里显式打开。
本地 HTTP 调试要避免 Secure Cookie，否则登录状态可能无法保持。
```

## 10. 调试命令记录

查看容器：

```powershell
docker compose -p video-player ps
```

查看前端日志：

```powershell
docker logs --tail 120 video_player_frontend
```

查看后端日志：

```powershell
docker logs --tail 120 video_player_backend
```

查看数据卷：

```powershell
docker volume ls
```

查看数据库记录数：

```powershell
docker exec video_player_postgres psql -U postgres -d video_player -c "select count(*) from videos;"
```

测试前端容器内部能否访问后端：

```powershell
docker exec video_player_frontend node -e "fetch('http://backend:3000/api/health').then(r=>r.text()).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
```

重建并启动前端：

```powershell
docker compose -p video-player up -d --build frontend
```

## 11. 重要总结

这次 Docker 调试最重要的经验：

```txt
1. 容器名冲突，不等于数据丢失。
2. 删除容器不等于删除数据卷。
3. Compose 项目名会影响默认数据卷名称。
4. 容器里没有本地开发环境中“刚好存在”的目录。
5. Next.js 页面有客户端请求，也有服务端请求。
6. Docker 容器内部访问服务，不要用宿主机 localhost，要用 Compose 服务名。
7. 生产环境错误要看容器日志，页面上的 digest 只是错误编号。
8. Docker 部署不等于 NODE_ENV=production，生产环境变量必须显式配置。
```

一句话记忆：

```txt
浏览器访问宿主机端口，容器访问 Compose 服务名；数据要看 volume，不要只看容器。
```
