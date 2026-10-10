# 线上登录 CORS 跨域错误调试记录

## 1. 现象

线上访问前端：

```txt
http://150.158.122.193:3001/
```

在登录页输入教导主任账号后，请求后端接口失败，页面显示：

```txt
Failed to fetch
```

浏览器控制台报错：

```txt
Access to fetch at 'http://150.158.122.193:3002/api/admin/login'
from origin 'http://150.158.122.193:3001' has been blocked by CORS policy

The 'Access-Control-Allow-Origin' header has a value 'http://localhost:3001'
that is not equal to the supplied origin.
```

## 2. 这是什么 Bug

这是后端 CORS 白名单配置错误。

浏览器页面实际来源是：

```txt
http://150.158.122.193:3001
```

但后端允许跨域的来源仍然是默认值：

```txt
http://localhost:3001
```

所以浏览器认为：

```txt
当前网页来源 != 后端允许来源
```

于是拦截了登录请求，前端只能拿到 `Failed to fetch`。

## 3. 根本原因

后端 CORS 使用的是 `FRONTEND_URL` 环境变量：

```js
cors({
  origin: config.frontendUrl,
  credentials: true
})
```

而 `config.frontendUrl` 来自：

```js
frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001'
```

服务器上的 `.env.local` 缺少或没有正确设置：

```env
FRONTEND_URL=http://150.158.122.193:3001
```

因此后端退回默认值 `http://localhost:3001`，导致线上跨域失败。

## 4. 修复方式

在服务器 `/root/player/.env.local` 中补充线上前端地址：

```env
FRONTEND_URL=http://150.158.122.193:3001
COOKIE_SECURE=false
NEXT_PUBLIC_API_BASE_URL=http://150.158.122.193:3002/api
SERVER_API_BASE_URL=http://backend:3000/api
```

完整重启：

```bash
cd /root/player

docker compose --env-file .env.local down --remove-orphans
docker rm -f video_player_backend video_player_frontend 2>/dev/null || true
docker compose --env-file .env.local up -d --build
```

## 5. 为什么要重新 build

`NEXT_PUBLIC_API_BASE_URL` 是 Next.js 前端构建时写进浏览器包里的变量。

如果只改 `.env.local`，但不重新构建前端镜像，浏览器里的旧 JS 仍可能继续请求旧地址。

所以修改这些变量后，需要执行：

```bash
docker compose --env-file .env.local up -d --build
```

## 6. 如何验证

后端健康检查：

```bash
curl http://150.158.122.193:3002/api/health
```

浏览器打开：

```txt
http://150.158.122.193:3001/login
```

如果控制台不再出现：

```txt
Access-Control-Allow-Origin header has a value 'http://localhost:3001'
```

说明 CORS 配置已经生效。

## 7. 学到的知识点

1. CORS 的 `Access-Control-Allow-Origin` 必须和浏览器页面来源完全一致。
2. `localhost` 在本地开发可用，但线上浏览器访问时不能代表服务器公网 IP。
3. 后端运行时变量 `FRONTEND_URL` 决定 CORS 允许来源。
4. 前端 `NEXT_PUBLIC_*` 变量会在构建时固化，改完需要重新 build。
5. HTTP 临时部署时 `COOKIE_SECURE=false`，否则浏览器不会保存 Secure Cookie。
