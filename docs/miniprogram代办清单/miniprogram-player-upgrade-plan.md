# 小程序播放器进度条与全屏体验改造计划

> 后续播放器相关工作均以本文为基线。  
> 范围：微信小程序端视频播放控制条、进度条、全屏体验、音频附件播放稳定性。  
> 约束：优先只改 `miniprogram/` 播放相关文件；不修改 `web/`；不破坏已校对的棕色系 UI。

## 1. 背景

当前小程序播放相关页面已经完成视觉校对，但播放器控制体验仍需要增强：

- 视频进度条需要参考成熟小程序播放器组件进行升级。
- 需要基础时间显示、播放/暂停、倍速、清晰度、全屏/退出全屏能力。
- 小窗、横屏全屏、竖屏全屏都需要获得稳定且清晰的播放体验。
- 部分手机全屏视频后无法退出全屏，需要专项排查并加入兜底。
- 音频附件进入播放页后，iPhone 上可能没有声音，需要专项排查。

## 2. 总目标

完成后应达到：

- 小窗模式控制条可用且不遮挡主要内容。
- 横屏全屏模式适合沉浸式视频播放。
- 竖屏全屏模式适合手机竖持观看。
- 当前时间 / 总时长显示正确。
- 进度条可展示、可拖动、可跳转。
- 播放 / 暂停稳定。
- 倍速切换可用。
- 清晰度切换有 UI 和数据结构支持。
- 全屏后有明确退出按钮。
- 部分机型无法退出全屏的问题有事件同步和兜底处理。
- iPhone 音频附件进入播放页后，用户点击播放能正常出声。

## 3. GitHub 调研标准

第一阶段优先调研微信小程序原生生态里的播放器或自定义控制条组件，而不是 H5 Web 播放器。

筛选标准：

1. 支持微信小程序 `<video>` 或原生小程序环境。
2. 支持自定义控制条或可参考其控制层结构。
3. 有进度条拖动。
4. 有当前时间 / 总时长。
5. 有播放 / 暂停。
6. 有倍速能力或可扩展倍速。
7. 有清晰度切换能力或可扩展清晰度菜单。
8. 有全屏 / 退出全屏能力。
9. 代码结构清晰，适合作为蓝本。
10. issue 或文档中最好有小程序兼容性讨论。

重点搜索关键词：

```text
wechat miniprogram video player custom controls
微信小程序 video 自定义控制条
微信小程序 播放器 进度条 倍速 全屏
miniprogram video player fullscreen bug ios
```

## 4. 组件使用原则

不直接整包照搬第三方组件。

原因：

- 当前小程序 UI 已按设计稿反复校对。
- 现有页面包含业务逻辑：分 P、附件、前置知识点、课程/知识点详情等。
- 第三方组件大多不适配当前棕色视觉体系。
- 小窗、横屏全屏、竖屏全屏需要结合当前页面结构单独适配。

采用策略：

```text
参考成熟组件的控制条状态机和交互结构
+
保留当前项目 UI 规范
+
重写适合本项目的小程序播放器控制层
```

## 5. 视频控制条目标功能

需要支持：

- 当前播放时间。
- 总时长。
- 进度条展示。
- 拖动进度。
- 播放 / 暂停。
- 倍速切换。
- 清晰度切换。
- 放大全屏。
- 回归小屏。
- 小窗控制条。
- 横屏全屏控制条。
- 竖屏全屏控制条。

## 6. 建议状态模型

```js
{
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  progressPercent: 0,
  isDragging: false,
  dragTime: 0,

  playbackRate: 1,
  playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],

  quality: 'auto',
  qualityList: [
    { label: '自动', value: 'auto' },
    { label: '高清', value: 'hd' },
    { label: '标清', value: 'sd' }
  ],

  isFullscreen: false,
  fullscreenDirection: 'none',
  controlsVisible: true
}
```

## 7. 小窗模式方案

小窗模式保持轻量：

- 视频区域底部显示轻量控制条。
- 左侧播放 / 暂停。
- 中间进度条。
- 右侧当前时间 / 总时长。
- 倍速、清晰度可放在更多菜单或视频下方。
- 右侧保留全屏按钮。

验收：

- 不遮挡标题和正文区域。
- 不影响播放详情页整体排版。
- 触摸区域足够大，避免误触。

## 8. 横屏全屏方案

横屏全屏重点是沉浸式播放：

- 控制条浮在视频底部。
- 时间、进度条、播放、倍速、清晰度、退出全屏位于同一控制层。
- 控制条支持自动隐藏。
- 点击视频显示 / 隐藏控制条。
- 使用 `videoContext.requestFullScreen({ direction: 90 })` 进入横屏。
- 监听 `bindfullscreenchange` 同步状态。

验收：

- 横屏全屏后控制条可见且可操作。
- 退出全屏按钮可用。
- 退出后页面状态恢复小窗。

## 9. 竖屏全屏方案

竖屏全屏重点是手机竖持体验：

- 使用 `videoContext.requestFullScreen({ direction: 0 })` 或当前机型支持方式。
- 控制条仍位于底部。
- 按钮尺寸略大，避免误触。
- 退出全屏按钮明显。
- 不强制旋转内容。
- 注意安全区域适配。

验收：

- 竖屏全屏不发生布局错位。
- 退出全屏后不残留遮罩。
- 控制条在竖屏全屏下仍可触达。

## 10. 全屏无法退出 Bug 排查方案

问题：部分手机型号视频全屏后无法退出全屏。

### 10.1 原生 controls 与自定义 controls 冲突

排查：

- 当前 `<video>` 是否启用了原生 controls。
- 自定义按钮是否盖住原生退出按钮。
- 全屏遮罩是否吞掉点击事件。
- 是否需要调整 `pointer-events`。

### 10.2 `exitFullScreen` 调用对象不一致

要求：

```js
this.videoContext = wx.createVideoContext('video-player', this)
this.videoContext.exitFullScreen()
```

排查：

- video id 是否唯一。
- context 是否在正确页面/组件作用域创建。
- 页面重渲染后 context 是否失效。
- 是否需要在 `onReady` 或状态变化后重新绑定。

### 10.3 `bindfullscreenchange` 状态未同步

原则：

- 以事件 `detail.fullScreen` 为准。
- 不只依赖本地 `isFullscreen`。
- 退出失败时要有兜底重置 UI 状态。

建议：

```js
handleFullscreenChange(event) {
  const fullScreen = Boolean(event.detail.fullScreen)
  this.setData({
    isFullscreen: fullScreen,
    fullscreenDirection: fullScreen ? this.data.fullscreenDirection : 'none',
    controlsVisible: true
  })
}
```

### 10.4 iOS / Android 差异

排查：

- `requestFullScreen({ direction })` 在 iOS 上的兼容表现。
- Android 横屏退出事件是否延迟。
- 自定义退出按钮是否需要兜底重置状态。

兜底示例：

```js
exitFullscreen() {
  if (this.videoContext) {
    this.videoContext.exitFullScreen()
  }

  setTimeout(() => {
    if (this.data.isFullscreen) {
      this.setData({
        isFullscreen: false,
        fullscreenDirection: 'none',
        controlsVisible: true
      })
    }
  }, 500)
}
```

## 11. iPhone 音频附件无声 Bug 排查方案

问题：音频附件点击进入播放页面播放时，苹果手机可能没有声音。

### 11.1 iOS 自动播放限制

iOS 对非用户手势触发的音频播放限制更严格。

风险代码：

```js
onLoad() {
  audio.play()
}
```

解决方向：

- 不在页面加载时强制自动播放。
- 进入音频页后显示播放按钮。
- 用户点击播放按钮后再调用 `audio.play()`。
- 不依赖不稳定的自动播放链路。

### 11.2 静音键影响

播放前设置：

```js
wx.setInnerAudioOption({
  obeyMuteSwitch: false
})
```

要求：

- 在播放前设置。
- 加 `success/fail` 处理。
- 兼容基础库差异。

### 11.3 音频 URL 要求

iOS 对音频资源更严格：

- 必须使用 HTTPS。
- URL 不能有未编码中文或空格。
- 服务端最好支持 Range 请求。
- `Content-Type` 要正确，例如 `audio/mpeg`。
- COS 临时链接不能过期。
- 避免过多 302 跳转。

### 11.4 Audio 实例生命周期

排查：

- audio 实例是否只在音频播放页创建。
- `onUnload` 是否 destroy。
- src 设置后是否等待合适时机再允许播放。
- 是否监听 `onError` 并展示错误。

建议补齐事件：

```js
audio.onCanplay()
audio.onPlay()
audio.onPause()
audio.onTimeUpdate()
audio.onEnded()
audio.onError()
audio.onWaiting()
```

## 12. 实施阶段

### 第一阶段：组件与资料调研

产出：

- 选出 1-2 个小程序播放器组件作为蓝本。
- 记录可借鉴点。
- 记录不采用点。
- 记录与当前项目的适配策略。

### 第二阶段：读取现有播放相关文件

只读取：

```text
miniprogram/pages/track-detail/
miniprogram/pages/knowledge-detail/
miniprogram/pages/audio-player/
miniprogram/utils/
```

### 第三阶段：视频控制层改造

改造：

- WXML 控制条结构。
- WXSS 小窗 / 横屏全屏 / 竖屏全屏样式。
- JS 播放状态。
- 进度拖动。
- 倍速。
- 清晰度。
- 全屏进入 / 退出。

### 第四阶段：全屏 Bug 修复

加入：

- 统一 videoContext。
- `bindfullscreenchange`。
- 退出全屏兜底。
- 横屏 / 竖屏状态区分。
- 避免遮罩吞掉退出按钮事件。

### 第五阶段：音频 iPhone 无声修复

加入：

- 播放前 `wx.setInnerAudioOption({ obeyMuteSwitch: false })`。
- 禁止不稳定自动播放。
- 用户点击后播放。
- 完整错误监听。
- 音频 URL 合法性保护。
- iOS 失败提示。

### 第六阶段：验证

至少验证：

- JS 语法检查。
- JSON 配置检查。
- 页面路径不报错。
- 小窗播放 / 暂停 / 拖动。
- 横屏全屏进入 / 退出。
- 竖屏全屏进入 / 退出。
- 倍速切换。
- 清晰度切换。
- 音频附件进入播放页后点击播放有声音。
- iOS 静音键场景使用 `obeyMuteSwitch: false` 兜底。

## 13. 工作边界

必须遵守：

- 不修改 `web/`。
- 不破坏已经校对过的页面视觉。
- 不重新引入橘色角标、廉价渐变、开发提示文案。
- 不直接复制第三方组件整包到项目里。
- 所有改动应集中在播放相关页面和必要的工具函数。

## 14. 第一阶段调研记录

调研时间：2026-10-09

### 14.1 候选蓝本 A：腾讯视频小程序播放器插件

仓库：`https://github.com/tvfe/txv-miniprogram-plugin`

定位：腾讯视频小程序播放器 SDK / 插件。

可借鉴点：

- 提供播放器实例获取方式，支持 `play()`、`pause()`、`seek()`、`requestFullScreen()`、`exitFullScreen()` 等控制能力。
- 支持 `fullscreenchange`、`timeupdate`、`play`、`pause`、`ended`、`waiting`、`error`、`loadedmetadata` 等 video 同名事件映射。
- 支持清晰度设置：`setLevel('fhd')`，失败时可 catch，并可自动续播当前内容。
- 支持全屏方向 `direction`、手势控制、全屏亮度/音量手势、进度条手势、横屏自动全屏等属性。
- 支持多 slot：底部左侧、底部右侧、右上角、默认区域，可作为“全屏状态下控制栏插槽设计”的参考。
- 文档中明确了播放器层级：播放层、捕获层、错误层、返回按钮、toast 区域等，适合参考自定义控制层的 z-index 设计。

不直接采用原因：

- 该插件主要服务腾讯视频 vid 资源，文档注明仅支持腾讯视频已上架资源，不适合当前自有课程视频/COS 资源。
- 需要微信插件接入和权限申请，引入成本高。
- UI 风格不可直接匹配当前小程序已校对的棕色系设计。
- 当前项目需要和分 P、附件、前置知识点、课程详情等业务逻辑深度结合，不适合整体替换。

采用策略：

- 不接入插件。
- 借鉴其“播放器实例 + 事件同步 + 控制层插槽 + 清晰度切换 + 全屏层级”的设计思路。
- 在当前原生 `<video>` 基础上重写轻量控制层。

### 14.2 候选蓝本 B：原生 video 自定义 controls 实现

资料：微信小程序自定义 video 控制条相关实现文章与示例。

可借鉴点：

- 关闭原生控制条：`controls="{{false}}"`。
- 关闭原生全屏按钮：`show-fullscreen-btn="{{false}}"`。
- 使用自定义控制层承载播放、暂停、进度、时间、倍速、清晰度、全屏按钮。
- 用 `bindtimeupdate` 同步 `currentTime` 和 `duration`。
- 用 `slider` 或自绘进度条实现 seek。
- 用 `wx.createVideoContext('video-id', this)` 获取上下文并调用 `play()`、`pause()`、`seek()`、`requestFullScreen()`、`exitFullScreen()`。

不直接采用原因：

- 大多数示例只覆盖基础播放/暂停/进度，不覆盖横屏全屏、竖屏全屏、小窗三态体验。
- 示例 UI 普遍较粗糙，不符合当前设计稿要求。
- 示例通常缺少全屏退出 bug 兜底和 iOS/Android 兼容策略。

采用策略：

- 采用原生 `<video>` + 自定义控制层作为主路线。
- 结合腾讯视频插件的状态机与层级设计，补足全屏/清晰度/倍速/错误兜底。

### 14.3 官方能力依据：微信小程序 video 组件

官方文档重点：`https://developers.weixin.qq.com/miniprogram/dev/component/video.html`

与本项目相关的属性：

- `controls`：是否显示默认播放控件。
- `show-progress`：是否显示原生进度条。
- `show-fullscreen-btn`：是否显示原生全屏按钮。
- `show-play-btn`：是否显示底部播放按钮。
- `show-center-play-btn`：是否显示中间播放按钮。
- `enable-progress-gesture`：是否开启进度手势。
- `vslide-gesture`：非全屏音量/亮度手势。
- `vslide-gesture-in-fullscreen`：全屏音量/亮度手势。
- `object-fit`：视频填充方式，支持 `contain`、`fill`、`cover`。
- `direction`：全屏方向，支持 `0`、`90`、`-90`。
- `enable-play-gesture`：双击播放/暂停。
- `enable-auto-rotation`：横屏自动全屏。
- `show-screen-lock-button`：全屏锁屏按钮。
- `picture-in-picture-mode`：小窗模式。

与本项目相关的事件：

- `bindplay`：播放。
- `bindpause`：暂停。
- `bindended`：播放结束。
- `bindtimeupdate`：播放进度变化，`detail = { currentTime, duration }`，约 250ms 一次。
- `bindfullscreenchange`：进入/退出全屏，`detail = { fullScreen, direction }`，direction 为 `vertical` 或 `horizontal`。
- `bindloadedmetadata`：元数据加载完成，`detail = { width, height, duration }`。
- `bindwaiting`：缓冲。
- `binderror`：播放错误。
- `bindseekcomplete`：seek 完成，注意 iOS 单位为秒，Android 单位为毫秒。

实现注意：

- 自定义控制条时应关闭原生 controls 或至少避免原生 controls 与自定义遮罩冲突。
- 全屏状态必须以 `bindfullscreenchange.detail.fullScreen` 为准，不能只依赖本地按钮点击后的状态。
- `bindtimeupdate` 高频触发，后续实现时要避免过于频繁 `setData`，拖动中可暂停同步或做节流。
- 清晰度切换本质依赖后端提供多码率视频源；如果当前接口没有多清晰度 URL，前端先做 UI 与数据结构占位，默认仅“自动/原画”。
- 倍速应通过 `videoContext.playbackRate(rate)` 实现，并限制在微信支持的倍率集合内。

### 14.4 iPhone 音频无声资料结论

重点结论：

- iOS 真机无声最常见原因是 iPhone 物理静音开关，默认会影响 `InnerAudioContext`。
- 应使用 `wx.setInnerAudioOption({ obeyMuteSwitch: false })`，不要依赖废弃/不稳定的 `innerAudioContext.obeyMuteSwitch = false`。
- 建议在小程序启动或音频页播放前设置，至少要在 `audio.play()` 之前设置。
- iOS 对音频格式和 URL 更严格，优先使用 mp3/aac/m4a，避免 flac/ogg/ape/amr 等 iOS 不支持格式。
- 音频 URL 建议使用 HTTPS，避免未编码中文、空格，服务端应返回正确 `Content-Type` 并支持 Range。
- 页面内音频应使用 `wx.createInnerAudioContext()`，不需要后台播放时不要用 `BackgroundAudioManager`。
- `InnerAudioContext` 不会自动释放，离开音频页时必须 `destroy()`。

### 14.5 第一阶段结论

后续实现采用以下路线：

1. 以微信小程序原生 `<video>` 为播放核心。
2. 不直接引入第三方播放器插件。
3. 参考腾讯视频插件的控制能力、事件映射、清晰度切换和层级设计。
4. 使用自定义控制条承载时间、进度、播放/暂停、倍速、清晰度、全屏/退出全屏。
5. 小窗、横屏全屏、竖屏全屏分别设计控制条布局。
6. 全屏状态以 `bindfullscreenchange` 为准，并增加退出兜底。
7. 音频页修复优先级：`wx.setInnerAudioOption({ obeyMuteSwitch: false })`、用户点击触发播放、完整错误监听、销毁实例。

### 14.6 下一阶段输入

第二阶段开始前，需要读取并只读取以下范围：

```text
miniprogram/pages/track-detail/
miniprogram/pages/knowledge-detail/
miniprogram/pages/audio-player/
miniprogram/utils/
```

第二阶段目标：

- 梳理当前视频播放页和音频播放页已有状态。
- 确定控制条改造最小改动点。
- 列出具体要改的 WXML/WXSS/JS 文件。

## 15. 第二阶段现状核对记录

核对时间：2026-10-09

### 15.1 视频播放页实际文件

曲目播放详情页：

```text
miniprogram/pages/track-detail/index.wxml
miniprogram/pages/track-detail/index.wxss
miniprogram/pages/track-detail/index.js
```

知识点播放详情页：

```text
miniprogram/pages/knowledge-detail/index.wxml
miniprogram/pages/knowledge-detail/index.wxss
miniprogram/pages/knowledge-detail/index.js
```

注意：实际页面文件命名为 `index.*`，不是 `track-detail.wxml` / `knowledge-detail.wxml` 这类命名。

### 15.2 视频页已有能力

`track-detail` 和 `knowledge-detail` 均已使用原生 `<video>` + 自定义控制条。

已确认的 `<video>` 关键配置：

- `id="lessonVideo"`
- `controls="{{false}}"`
- `show-fullscreen-btn="{{false}}"`
- `show-play-btn="{{false}}"`
- `show-center-play-btn="{{false}}"`
- `direction="{{videoDirection}}"`
- `object-fit="{{videoObjectFit}}"`

已绑定的关键事件：

- `bindloadedmetadata="handleVideoLoadedMeta"`
- `bindplay="handleVideoPlay"`
- `bindpause="handleVideoPause"`
- `bindtimeupdate="handleVideoTimeUpdate"`
- `bindended="handleVideoEnded"`
- `bindfullscreenchange="handleFullscreenChange"`

已有控制能力：

- 播放 / 暂停；
- 当前时间 / 总时长；
- 自定义进度条；
- 进度拖动；
- 倍速切换；
- 清晰度切换入口；
- 全屏 / 退出全屏；
- 分 P 切换；
- 附件 PDF 预览、音频跳转播放、下载。

### 15.3 样式复用关系

`knowledge-detail/index.wxss` 通过导入方式复用曲目播放页样式：

```css
@import "../track-detail/index.wxss";
```

因此后续凡是修改视频控制条、进度条、全屏样式，应优先改 `track-detail/index.wxss`，再检查 `knowledge-detail` 是否需要补充页面私有样式。不要在两个页面复制两份相同 WXSS。

### 15.4 已发现的进度条问题

旧版进度条存在以下体验问题：

1. 控制条把播放按钮、进度条、时间、清晰度、倍速、全屏按钮挤在同一行，排版拥挤。
2. 交互热区和视觉轨道没有明确分层，用户必须点到很细的线附近才容易生效。
3. 全屏模式下进度条反而变细，滑块变小，违背全屏操作预期。
4. 拖动时没有独立时间气泡，用户不知道拖到了哪里。
5. 拖动释放后的视觉反馈过快消失，手感不自然。

### 15.5 第二阶段结论

不需要重写整个播放器。当前更合理的路线是：

```text
保留现有业务逻辑和事件命名
+
重写进度条结构与热区样式
+
补齐拖动时间气泡
+
后续继续增强全屏布局和音频 iOS 修复
```

## 16. 第三阶段第一轮：视频进度条改造记录

改造时间：2026-10-09

### 16.1 已改造文件

```text
miniprogram/pages/track-detail/index.wxml
miniprogram/pages/track-detail/index.wxss
miniprogram/pages/track-detail/index.js
miniprogram/pages/knowledge-detail/index.wxml
miniprogram/pages/knowledge-detail/index.js
```

说明：`knowledge-detail/index.wxss` 复用 `track-detail/index.wxss`，本轮未重复修改。

### 16.2 WXML 改造

视频进度条区域新增拖动时间气泡：

```xml
<cover-view wx:if="{{isSeeking}}" class="progress-bubble" style="left: {{progressDotPercent}}%;">
  {{seekTimeText}}
</cover-view>
```

滑块增加拖动激活态：

```xml
<cover-view class="progress-dot {{isSeeking ? 'active' : ''}}" style="left: {{progressDotPercent}}%;"></cover-view>
```

结构原则：

- `progress-zone`：控制条中的进度条区域；
- `progress-touch`：真正承担点击和拖动的大热区；
- `progress-track`：只负责视觉轨道；
- `progress-fill`：已播放进度；
- `progress-dot`：滑块；
- `progress-bubble`：拖动时间气泡。

### 16.3 WXSS 改造

`track-detail/index.wxss` 中已重写以下样式：

- `.video-controls`
- `.video-controls.compact`
- `.video-controls.full`
- `.progress-zone`
- `.progress-touch`
- `.progress-track`
- `.progress-fill`
- `.progress-dot`
- `.progress-dot.active`
- `.progress-bubble`

改造原则：

1. 控制条整体高度增加，避免按钮和进度条过度拥挤。
2. 进度条采用“大热区 + 小视觉轨道”的结构。
3. 小窗模式和全屏模式都保留足够触摸高度。
4. 全屏模式下进度条不再缩水，滑块也不再缩小。
5. 拖动时滑块放大，并显示时间气泡。

### 16.4 JS 改造

`track-detail/index.js` 和 `knowledge-detail/index.js` 均已同步：

新增状态：

```js
seekTimeText: '0:00'
```

同步点：

- 切换分 P 时重置 `seekTimeText`；
- `updateVideoProgress()` 中同步 `seekTimeText`；
- `previewSeekByTouch()` 中根据触点位置更新 `seekTimeText`；
- `commitSeek()` 释放后延迟约 180ms 隐藏气泡，避免视觉反馈瞬间消失。

拖动原则：

- `touchstart/touchmove` 只做预览；
- `touchend` 再真正 `seek()`；
- 拖动期间 `handleVideoTimeUpdate` 不覆盖用户拖动状态；
- 进度比例限制在 `0 ~ 100`。

### 16.5 已完成校验

已执行 JS 语法检查：

```text
node --check miniprogram/pages/track-detail/index.js
node --check miniprogram/pages/knowledge-detail/index.js
```

结果：均通过。

## 17. 下一步实施顺序

后续不要重复做已完成的进度条第一轮改造，应从以下任务继续。

### 17.1 优先级 P0：音频 iPhone 无声修复

目标文件：

```text
miniprogram/pages/audio-player/index.js
miniprogram/pages/audio-player/index.wxml
miniprogram/pages/audio-player/index.wxss
```

必须完成：

1. 播放前调用：

```js
wx.setInnerAudioOption({
  obeyMuteSwitch: false
})
```

2. 不依赖进入页面自动播放，播放动作必须由用户点击触发。
3. 补齐或确认以下事件监听：

```js
audio.onCanplay()
audio.onPlay()
audio.onPause()
audio.onTimeUpdate()
audio.onEnded()
audio.onError()
audio.onWaiting()
```

4. `onError` 必须给用户友好提示，不要静默失败。
5. 页面卸载时必须 `destroy()` 当前 `InnerAudioContext`。
6. 对音频 URL 做基础校验：空 URL、非 HTTPS、疑似未编码空格时给出提示。

验收：

- iPhone 真机静音键打开时，点击播放仍应尽量出声；
- 点击播放后能看到播放态变化；
- 加载失败时能看到明确提示；
- 离开页面后不继续占用音频实例。

完成记录（2026-10-09）：

- `audio-player/index.js` 已新增 `validateAudioUrl()`，对空地址、非 HTTPS、地址空格做基础拦截；
- 已新增 `ensureInnerAudioOption()`，播放前调用 `wx.setInnerAudioOption({ obeyMuteSwitch: false })`；
- `togglePlay()` 首次播放仍由用户点击触发，准备音频后再调用 `playAudio()`；
- 已补充 `audio.onWaiting()`，并细化 `onCanplay/onPlay/onPause/onStop/onEnded/onError` 的 loading/error 状态同步；
- `onError` 已通过 `getAudioErrorMessage()` 转成用户友好提示；
- `destroyAudio()` 已增加 try/catch，离开页面时停止并销毁音频实例；
- `audio-player/index.wxml` 已新增加载中和错误提示区域；
- `audio-player/index.wxss` 已新增 `.audio-state` / `.audio-state.error` 样式；
- 已执行 `node --check miniprogram/pages/audio-player/index.js`，语法通过。

### 17.2 优先级 P1：全屏退出兜底增强

目标文件：

```text
miniprogram/pages/track-detail/index.js
miniprogram/pages/knowledge-detail/index.js
```

需要确认并补强：

1. `getVideoContext()` 始终使用同一个 `lessonVideo` id 和当前页面作用域。
2. `handleFullscreenChange(event)` 以 `event.detail.fullScreen` 为准。
3. 退出全屏时调用 `exitFullScreen()` 后加入兜底定时器。
4. 如果 500ms 左右仍停留在本地全屏态，应重置：

```js
{
  isFullscreen: false,
  fullscreenDirection: 'none',
  controlsVisible: true
}
```

5. 避免自定义遮罩层吞掉退出按钮点击。

验收：

- 横屏全屏可以退出；
- 竖屏全屏可以退出；
- 系统手势退出后页面状态同步正确；
- 退出后不残留全屏样式或遮罩。

完成记录（2026-10-10）：

- `track-detail/index.js` 和 `knowledge-detail/index.js` 已新增 `fullscreenDirection: 'none'` 状态；
- `toggleFullscreen()` 退出全屏时改为调用 `exitFullscreenWithFallback()`；
- 已新增 `exitFullscreenWithFallback()`，调用 `exitFullScreen()` 后 500ms 检查本地全屏态，必要时重置 `isFullscreen/fullscreenDirection/isPortraitFullscreen/controlsVisible`；
- `handleFullscreenChange()` 已以 `event.detail.fullScreen` 为准，并记录 `event.detail.direction`，退出后统一恢复 `fullscreenDirection: 'none'`；
- `onUnload()` 已清理 `fullscreenExitTimer`，避免页面卸载后残留定时器；
- 已执行 `node --check` 校验 `track-detail/index.js` 与 `knowledge-detail/index.js`，语法均通过。

### 17.3 优先级 P1：全屏控制条布局二次优化

目标文件：

```text
miniprogram/pages/track-detail/index.wxml
miniprogram/pages/track-detail/index.wxss
```

方向：

- 小窗控制条保持轻量；
- 全屏控制条可以拆成两行：
  - 第一行：进度条和拖动气泡；
  - 第二行：播放 / 时间 / 清晰度 / 倍速 / 退出全屏；
- 横屏全屏按钮间距可以更大；
- 竖屏全屏按钮尺寸应略大；
- 注意安全区域和不同手机宽高比例。

验收：

- 小窗不拥挤；
- 横屏全屏底部控制区清晰；
- 竖屏全屏按钮不贴边、不误触；
- 时间、清晰度、倍速不互相挤压。

完成记录（2026-10-10）：

- `track-detail/index.wxml` 已将控制条拆为“进度条层 + 控制按钮层”；
- `track-detail/index.wxss` 已将 `.video-controls` 改为纵向布局，避免进度条、时间、清晰度、倍速、全屏按钮挤在同一行；
- 小窗模式保留轻量控制条，但仍显示时间与全屏入口；
- 全屏模式增加控制区高度、按钮尺寸和间距，进度条独占上层宽度；
- 新增 `.control-row`、`.right-controls` 等样式，左右控制区与中间时间分区更稳定；
- `knowledge-detail` 继续通过 `@import "../track-detail/index.wxss"` 复用本轮样式，不新增分叉样式；
- 已执行 `node --check` 校验 `track-detail/index.js` 与 `knowledge-detail/index.js`，语法均通过。

### 17.4 优先级 P2：清晰度切换数据结构接入

当前清晰度切换更多是 UI 和状态入口。后端真正支持多清晰度后，应统一数据结构。

建议后端或归一化后提供：

```js
qualities: [
  { label: '自动', value: 'auto', url: '...' },
  { label: '高清', value: 'hd', url: '...' },
  { label: '标清', value: 'sd', url: '...' }
]
```

前端切换清晰度时：

1. 记录当前播放时间；
2. 切换视频 `src`；
3. 加载后 seek 回原时间；
4. 如果切换失败，回退到原清晰度和原地址；
5. 给用户提示，不要静默失败。

完成记录（2026-10-10）：

- `track-detail/index.js` 和 `knowledge-detail/index.js` 已在切换清晰度前记录 `quality/currentTime/detail` 作为 `pendingQualityRollback`；
- 清晰度切换目标没有 `videoUrl` 时会提示“当前清晰度暂无视频”，不再静默失败；
- 切换清晰度时会设置 `videoWaiting: true`，加载成功后由 `handleVideoPlay()` 清理等待状态；
- 视频错误发生在清晰度切换过程中时，会调用 `rollbackQuality()` 恢复原清晰度、原 detail，并 seek 回原时间；
- 回退时会提示“清晰度切换失败，已恢复原画面”；
- 已执行 `node --check` 校验 `track-detail/index.js` 与 `knowledge-detail/index.js`，语法均通过。

### 17.5 优先级 P2：播放器错误态和加载态

建议补充：

- 视频 `bindwaiting`：显示轻量加载态；
- 视频 `binderror`：显示友好错误提示；
- seek 后等待恢复时避免控制条错乱；
- 网络慢时不要频繁隐藏控制条。

完成记录（2026-10-10）：

- `track-detail/index.wxml` 与 `knowledge-detail/index.wxml` 已绑定 `bindwaiting="handleVideoWaiting"`、`binderror="handleVideoError"`；
- 两个页面均新增 `video-state` 覆盖提示层，显示“视频加载中…”或错误信息；
- `track-detail/index.wxss` 新增 `.video-state` / `.video-state.error`，`knowledge-detail` 继续复用样式；
- 两个页面 JS 新增 `videoWaiting`、`videoErrorText` 状态；
- `handleVideoWaiting()` 会显示加载态并保持控制条可见；
- 普通播放错误会显示“视频加载失败，请稍后重试”；
- `handleVideoPlay()` 会清理 loading/error 状态，避免网络恢复后残留遮罩；
- 已执行 `node --check` 校验 `track-detail/index.js` 与 `knowledge-detail/index.js`，语法均通过。

## 18. 验收清单

每次改播放器后至少验证：

### 18.1 视频播放页

- [ ] 曲目播放详情页能进入；
- [ ] 知识点播放详情页能进入；
- [ ] 小窗播放 / 暂停正常；
- [ ] 当前时间 / 总时长显示正确；
- [ ] 点击进度条可以跳转；
- [ ] 拖动进度条时显示时间气泡；
- [ ] 拖动释放后跳转到目标时间；
- [ ] 拖动时不会被 `timeupdate` 抢回原位置；
- [ ] 倍速切换正常；
- [ ] 清晰度按钮不报错；
- [ ] 横屏全屏进入 / 退出正常；
- [ ] 竖屏全屏进入 / 退出正常；
- [ ] 系统手势退出全屏后状态同步正确；
- [ ] 退出全屏后页面不残留遮罩；
- [ ] 分 P 切换后时间、进度、播放态重置正确。

### 18.2 音频播放页

- [ ] 点击音频附件能进入音频播放页；
- [ ] 页面不会自动强制播放导致 iOS 无声；
- [ ] 用户点击播放后创建/使用音频实例；
- [ ] 播放前设置 `obeyMuteSwitch: false`；
- [ ] iPhone 静音键场景尽量可播放；
- [ ] 播放 / 暂停正常；
- [ ] 快退 / 快进正常；
- [ ] 倍速切换正常；
- [ ] 循环播放开关正常；
- [ ] 拖动进度条正常；
- [ ] `onError` 能提示用户；
- [ ] 离开页面后音频销毁。

### 18.3 代码校验

- [x] `track-detail/index.js` 语法检查通过；
- [x] `knowledge-detail/index.js` 语法检查通过；
- [x] `audio-player/index.js` 语法检查通过；
- [x] 相关 JSON 文件格式正确；
- [x] 不修改 `web/`；
- [x] 不引入新的 npm 依赖；
- [x] 不复制第三方播放器整包。

自动校验记录（2026-10-10）：

- 已使用 Node `--check` 校验 `track-detail/index.js`、`knowledge-detail/index.js`、`audio-player/index.js`，全部通过；
- 已使用 Node `JSON.parse` 校验 `app.json`、`track-detail/index.json`、`knowledge-detail/index.json`、`audio-player/index.json`，全部通过；
- 视频播放体验、全屏横竖屏、iPhone 静音键音频播放仍需微信开发者工具和真机人工验收，不能仅凭静态校验打勾。

## 19. 协作注意点

1. 播放器改造以“小步提交、小步验证”为原则，不要一次性重写所有播放页面。
2. `knowledge-detail` 与 `track-detail` 同构，样式优先复用，不要制造两套分叉控制条。
3. 自定义控制层必须优先保证可点击、可拖动、可退出全屏，再追求图标细节。
4. 不要恢复原生 controls 与自定义 controls 混用的状态，避免不同机型层级冲突。
5. 视频清晰度是否真实可切换取决于后端是否提供多码率 URL；当前不应伪造不存在的视频源。
6. 音频 iOS 无声必须用真机验证，开发者工具无法完全复现。
7. 所有学生可见文案必须是用户语言，不要出现“TODO”“开发提示”“mock”等面向程序员的字样。
8. 每次修改播放相关页面后，应同步更新本文档的“已完成记录”和 README 中的播放器现状。

## 20. 2026-10-13 横屏尺寸与播放器逻辑收敛

- 横屏全屏控制层改为由真实全屏方向状态触发，固定像素尺寸并适配左右、底部安全区域；
- 进度轨道保持 4px，拖动热区和主要控制按钮热区不低于 44px；隐藏控制层不再拦截触摸；
- 拖动开始时只查询一次真实轨道尺寸，移动阶段复用缓存，释放阶段只提交一次 seek；
- 视频统一使用 `contain`，避免宽屏设备拉伸画面；
- 页面返回不再重复请求详情或自动播放，所有异步播放入口增加页面可见性门禁；
- 清晰度切换保留回滚状态至新视频元数据和首个进度事件就绪，单一视频源不展示切换按钮；
- 曲目页与知识点页播放器逻辑已收敛到 `utils/create-video-detail-page.js`，页面文件只保留接口和文案配置；
- 已完成 JS 语法、WXSS/WXML 结构、WXML 事件处理器映射和共享播放器冒烟测试；微信开发者工具及真机验收仍待执行。
