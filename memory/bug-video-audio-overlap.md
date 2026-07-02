# Bug 复盘：播放页返回首页后视频叠音

## 1. 问题现象

在 Next.js 前端播放视频时，出现过两个相关问题：

1. 点击视频进入播放页后，视频可以播放。
2. 在播放过程中点击“返回首页”，页面回到首页后，视频声音仍然继续播放。
3. 拖动视频进度条后，出现多个相同视频声音叠加的问题。
4. 中间一次修复后，又出现了进度条无法拖动的问题。

这个问题属于：

```txt
前端页面路由切换 + HTML video 媒体资源释放 + React 组件生命周期
```

## 2. 相关文件

主要相关文件：

```txt
frontend/app/videos/[id]/page.js
frontend/components/VideoPlayer.js
```

其中：

- `frontend/app/videos/[id]/page.js` 是视频详情页。
- `frontend/components/VideoPlayer.js` 是后来抽出来的客户端播放器组件。

## 3. 根本原因

### 3.1 第一个问题：播放器组件没有真正用上

一开始虽然创建了 `VideoPlayer` 组件，但播放页里实际渲染的仍然是原生：

```jsx
<video className="player" src={video.video_url} poster={video.cover_url} controls autoPlay />
```

所以 `VideoPlayer` 里的暂停和释放逻辑根本没有执行。

修复方式是把播放页改成：

```jsx
<VideoPlayer src={video.video_url} poster={video.cover_url} />
```

### 3.2 第二个问题：清理逻辑太激进

曾经尝试在组件卸载时执行：

```js
videoElement.pause();
videoElement.removeAttribute('src');
videoElement.load();
```

这个思路本来是想彻底释放视频资源。

但是在 React / Next.js 开发模式下，组件可能会出现：

```txt
挂载 -> 清理 -> 再挂载
```

这种检查流程。

如果在这个过程中强行清空 `src` 并调用 `load()`，会破坏当前视频元素的媒体状态，导致：

```txt
进度条无法拖动
媒体状态异常
```

所以最终不再在普通 cleanup 中清空当前视频地址。

### 3.3 第三个问题：客户端路由可能保留媒体状态

Next.js 的 `<Link>` 是客户端路由跳转。

它的特点是：

```txt
不完整刷新整个页面
只切换当前 React 页面内容
```

这通常是优点，但视频播放这种媒体资源有时会残留浏览器内部播放状态。

所以最终把返回首页从：

```jsx
<Link href="/">返回首页</Link>
```

改成：

```jsx
<a href="/">返回首页</a>
```

这样返回首页会触发普通页面跳转，浏览器会更彻底地释放当前播放页的视频资源。

## 4. 最终修复方案

### 4.1 播放页使用 VideoPlayer 组件

在 `frontend/app/videos/[id]/page.js` 中：

```jsx
<VideoPlayer src={video.video_url} poster={video.cover_url} />
```

### 4.2 返回首页使用普通 a 标签

在播放页中：

```jsx
<a className="back-link" href="/">← 返回首页</a>
```

不用 Next.js 的 `<Link>`。

### 4.3 播放器组件只做温和清理

在 `frontend/components/VideoPlayer.js` 中：

```js
return () => {
  if (!videoElement) {
    return;
  }

  videoElement.removeEventListener('play', handlePlay);
  videoElement.pause();
};
```

注意这里没有再执行：

```js
removeAttribute('src')
load()
```

避免破坏当前视频的进度条和媒体状态。

### 4.4 保证同一时间只播放一个 video

在播放当前视频时，暂停页面上其他 video：

```js
document.querySelectorAll('video').forEach((otherVideo) => {
  if (otherVideo !== videoElement) {
    otherVideo.pause();
  }
});
```

## 5. 学到的知识点

### 5.1 HTML video 不是普通 DOM

`video` 元素背后有浏览器媒体解码、缓冲、播放状态。

所以它不仅仅是一个普通标签。

随便修改 `src` 或调用 `load()`，可能会影响：

```txt
播放状态
进度条状态
缓冲状态
音频输出
```

### 5.2 React cleanup 不一定只代表“真正离开页面”

`useEffect` 的 cleanup 可能发生在：

```txt
组件卸载
依赖变化
开发模式重复挂载检查
```

所以 cleanup 里不要随便做太破坏性的操作。

### 5.3 Next.js Link 和 a 标签的区别

`<Link>`：

```txt
客户端路由跳转
速度快
不会完整刷新页面
适合普通页面切换
```

`<a href>`：

```txt
浏览器普通跳转
会完整重新加载页面
更容易释放视频、音频这类浏览器资源
```

对于视频播放页，“返回首页”使用普通 `<a>` 更稳。

### 5.4 调试 Bug 要先看证据

这次问题不是一次猜中修复的。

中间通过日志确认了：

```txt
VideoPlayer mounted 后马上 cleanup
```

这说明 React / Next.js 开发模式的生命周期行为会影响播放器逻辑。

## 6. 最终验证结果

用户复测后确认：

```txt
返回首页后不再继续播放声音
拖动进度条不再出现叠音
进度条可以正常拖动
```

## 7. 以后遇到类似问题时的处理思路

如果以后再遇到视频、音频、地图、编辑器这类复杂浏览器资源问题，可以按这个顺序排查：

```txt
1. 确认组件是否真的被使用
2. 确认页面上是否有多个实例
3. 确认 useEffect cleanup 是否执行
4. 确认 cleanup 是否过度破坏资源
5. 确认路由切换方式是否保留了旧资源
6. 必要时用普通 a 标签触发完整页面跳转
```
