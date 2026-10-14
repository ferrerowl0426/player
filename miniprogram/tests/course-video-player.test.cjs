const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createRequire } = require('node:module');

const componentPath = path.join(__dirname, '../components/course-video-player/index.js');
const { getPlayerLayout, getMenuLayout, getSeekBubbleStyle, seekTime } = require('../components/course-video-player/layout');

function player({ measure = false } = {}) {
  let definition;
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const events = [];
  const patches = [];
  const queries = [];
  const info = { windowWidth: 375, windowHeight: 667, screenWidth: 375, screenHeight: 667 };
  const context = {
    play() { calls.push(['play']); },
    pause() { calls.push(['pause']); },
    playbackRate(rate) { calls.push(['rate', rate]); },
    seek(time) { calls.push(['seek', time]); },
    requestFullScreen(options) { calls.push(['enter', options.direction]); },
    exitFullScreen() { calls.push(['exit']); }
  };
  vm.runInNewContext(fs.readFileSync(componentPath, 'utf8'), {
    require: createRequire(componentPath),
    Component(value) { definition = value; },
    wx: {
      createVideoContext(id) { calls.push(['context', id]); return context; },
      getWindowInfo() { return info; },
      showToast(options) { calls.push(['toast', options.title]); }
    },
    console,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const defaults = Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, value.value]));
  const instance = {
    ...definition.methods,
    data: { ...defaults, ...definition.data, active: true },
    setData(patch, callback) { patches.push(patch); Object.assign(this.data, patch); callback?.(); },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  if (measure) instance.createSelectorQuery = () => {
    const requests = [];
    queries.push(requests);
    assert.ok(queries.length < 20, 'layout measurement must not recurse');
    const query = {
      select(selector) {
        return {
          boundingClientRect(callback) { requests.push({ selector, callback, value: { left: 24, width: 327, height: 195 } }); return query; },
          fields(options, callback) { requests.push({ selector, callback, value: { paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '20px' } }); return query; }
        };
      },
      exec(callback) { requests.forEach((request) => request.callback(request.value)); callback(); }
    };
    return query;
  };
  definition.lifetimes.ready.call(instance);
  function load(id, position = 0, play = true, src = `https://example.test/${id}.mp4`) {
    const media = { id, src, position, play };
    instance.data.media = media;
    definition.observers.media.call(instance, media);
  }
  function nativeEvent(detail = {}, dataset = null) {
    return { detail, currentTarget: { dataset: dataset || { sourceId: instance._sourceId, sourceToken: instance._sourceToken } } };
  }
  function metadata(width = 1920, height = 1080) {
    instance.handleLoadedMetadata(nativeEvent({ duration: 120, width, height }));
  }
  function fullscreen(fullScreen, direction = 'horizontal') {
    instance.handleFullscreenChange(nativeEvent({ fullScreen, direction }));
  }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  }
  return { instance, definition, calls, events, patches, queries, info, load, metadata, fullscreen, nativeEvent, advance };
}

test('metadata is required before requesting fullscreen, including zero dimensions', () => {
  const p = player();
  p.load('first');
  p.instance.toggleFullscreen();
  assert.equal(p.calls.filter(([name]) => name === 'enter').length, 0);
  p.metadata(0, 0);
  p.instance.toggleFullscreen();
  assert.equal(p.calls.filter(([name]) => name === 'enter').length, 0);
  p.metadata();
  p.instance.toggleFullscreen();
  assert.deepEqual(p.calls.filter(([name]) => name === 'enter'), [['enter', 90]]);
});

test('fullscreen direction falls back to loaded video dimensions when the event omits it', () => {
  const p = player();
  p.load('first');
  p.metadata(1920, 1080);
  p.instance.handleFullscreenChange(p.nativeEvent({ fullScreen: true }));
  assert.equal(p.instance.data.fullscreenDirection, 'horizontal');
});

test('fullscreen exit keeps the fullscreen tree until the three-second fallback', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  p.instance.toggleFullscreen();
  p.advance(900);
  assert.equal(p.instance.data.isFullscreen, true);
  assert.equal(p.instance.data.fullscreenTransition, 'exiting');
  p.advance(2100);
  assert.equal(p.instance.data.isFullscreen, false);
  assert.equal(p.instance.data.fullscreenTransition, '');
  assert.equal(p.calls.filter(([name]) => name === 'exit').length, 1);
  p.fullscreen(false);
  assert.equal(p.instance.data.isFullscreen, false);
});

test('old and untagged native events cannot mutate the next load, even with the same URL', () => {
  const p = player();
  p.load('first');
  p.metadata();
  const oldDataset = { sourceId: p.instance._sourceId, sourceToken: p.instance._sourceToken };
  p.load('second', 0, true, 'https://example.test/first.mp4');
  p.metadata();
  p.instance.handlePlay(p.nativeEvent());
  const count = p.events.length;
  for (const dataset of [oldDataset, {}]) {
    p.instance.handlePause(p.nativeEvent({}, dataset));
    p.instance.handleError(p.nativeEvent({}, dataset));
    p.instance.handleEnded(p.nativeEvent({}, dataset));
    p.instance.handleWaiting(p.nativeEvent({}, dataset));
    p.instance.handleTimeUpdate(p.nativeEvent({ currentTime: 95, duration: 120 }, dataset));
    p.instance.handleFullscreenChange(p.nativeEvent({ fullScreen: true }, dataset));
  }
  p.advance(500);
  assert.equal(p.events.length, count);
  assert.equal(p.instance.data.isPlaying, true);
  assert.equal(p.instance.data.errorText, '');
  assert.equal(p.instance.data.isFullscreen, false);
});

test('fullscreen quality switching preserves the native fullscreen layer and paused position', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  p.load('second', 42, false);
  assert.equal(p.instance._sourceId, 'second');
  assert.equal(p.instance.data.isFullscreen, true);
  assert.equal(p.instance.data.videoDirection, 90);
  p.metadata();
  p.instance.handleSeekComplete(p.nativeEvent());
  assert.deepEqual(p.calls.filter(([name]) => name === 'enter' || name === 'exit'), []);
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek').at(-1), ['seek', 42]);
  assert.equal(p.instance._wantPlay, false);
});

test('source switch during fullscreen entry mounts the latest source after rotation without exiting', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.instance.requestFullscreen(true);
  p.load('second', 13, true);
  p.load('third', 24, true);
  assert.equal(p.instance._sourceId, 'first');
  p.fullscreen(true);
  assert.equal(p.instance.data.fullscreenTransition, '');
  assert.equal(p.instance.data.isFullscreen, true);
  assert.equal(p.calls.filter(([name]) => name === 'exit').length, 0);
  assert.equal(p.instance._sourceId, 'third');
  p.metadata(720, 1280);
  assert.deepEqual(p.calls.filter(([name]) => name === 'enter'), [['enter', 90]]);
  assert.equal(p.instance.data.fullscreenDirection, 'horizontal');
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek').at(-1), ['seek', 24]);
});

test('fullscreen menus keep landscape cards on one row and portrait cards inside the safe area', () => {
  for (const horizontal of [true, false]) {
    const layout = getPlayerLayout({
      windowWidth: horizontal ? 667 : 375,
      windowHeight: horizontal ? 375 : 667,
      screenWidth: horizontal ? 667 : 375,
      screenHeight: horizontal ? 375 : 667
    }, true, horizontal);
    const popup = getMenuLayout(layout, 6);
    const popupTop = layout.height - popup.bottom - popup.height;
    assert.ok(popupTop >= layout.top + 12);
    assert.ok(popup.width <= layout.width - layout.left - layout.right);
    assert.equal(popup.columns, horizontal ? 6 : 3);
    if (horizontal) {
      assert.equal(popup.width, layout.width - layout.left - layout.right);
      assert.equal(popup.height, 120);
    } else {
      assert.ok(popup.width <= layout.width - layout.left - layout.right);
      assert.ok(popup.height >= 130);
    }
  }
});

test('automatic next episode starts at zero and keeps fullscreen', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  p.instance.handleEnded(p.nativeEvent());
  assert.equal(p.events.at(-1).name, 'ended');
  // 详情页收到 ended 后传入下一 P；沿用同一个组件。
  p.load('next', 0, true);
  p.metadata();
  p.instance.handlePlay(p.nativeEvent());
  assert.equal(p.instance.data.isFullscreen, true);
  assert.equal(p.instance.data.isPlaying, true);
  assert.equal(p.instance.snapshot().currentTime, 0);
  assert.deepEqual(p.calls.filter(([name]) => name === 'exit' || name === 'enter'), []);
});

test('same-URL source selection seeks without clearing src or waiting for another metadata event', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  const start = p.patches.length;
  p.load('same-url', 20, false, 'https://example.test/first.mp4');
  assert.equal(p.instance.data.metadataReady, true);
  assert.equal(p.instance.data.isFullscreen, true);
  assert.ok(!p.patches.slice(start).some((patch) => patch.videoSrc === ''));
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek').at(-1), ['seek', 20]);
  p.instance.handleSeekComplete(p.nativeEvent());
  assert.equal(p.instance.snapshot().playing, false);
});

test('same-URL source selection preserves the requested play intent after native pause', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.instance.handlePlay(p.nativeEvent());
  p.load('same-url', 20, true, 'https://example.test/first.mp4');
  p.instance.handlePause(p.nativeEvent());
  assert.equal(p.instance.snapshot().playing, true);
  p.instance.handleSeekComplete(p.nativeEvent());
  assert.equal(p.instance.snapshot().playing, true);
});

test('source loading errors before metadata are reported so quality rollback can run', () => {
  const p = player();
  p.load('bad');
  p.instance.handleError(p.nativeEvent({ errMsg: 'load failed' }));
  assert.equal(p.events.at(-1).name, 'error');
  assert.equal(p.instance.data.waiting, false);
  assert.ok(p.instance.data.errorText);
});

test('fullscreen controls toggle and close the menu without changing playback', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  p.instance.handlePlay(p.nativeEvent());
  p.instance.toggleMenu({ currentTarget: { dataset: { menu: 'speed' } } });
  const count = p.calls.length;
  p.instance.toggleControls();
  assert.equal(p.instance.data.controlsVisible, false);
  assert.equal(p.instance.data.menu, '');
  p.instance.handleTimeUpdate(p.nativeEvent({ currentTime: 2, duration: 120 }));
  p.advance(3000);
  assert.equal(p.instance.data.controlsVisible, false);
  p.instance.toggleControls();
  assert.equal(p.instance.data.controlsVisible, true);
  assert.equal(p.instance.data.isPlaying, true);
  assert.equal(p.calls.length, count);
});

test('window geometry queries finish once and native touch coordinates seek across the entire track', () => {
  const p = player({ measure: true });
  p.load('first');
  p.metadata();
  assert.equal(p.queries.length, 1);
  const track = p.instance._layout.track;
  assert.equal(track.left, 35);
  assert.equal(track.width, 305);
  p.instance.startSeek({ touches: [{ x: 0 }] });
  assert.equal(p.instance.data.progressPercent, 0);
  p.instance.moveSeek({ touches: [{ x: track.width * 0.75 }] });
  assert.equal(p.calls.filter(([name]) => name === 'seek').length, 0);
  p.instance.endSeek({ changedTouches: [{ x: track.width * 0.75 }] });
  p.instance.tapSeek({ detail: { x: track.left + track.width * 0.75 } });
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek'), [['seek', 90]]);
  p.instance.handleSeekComplete(p.nativeEvent({ position: 90000 }));
  assert.equal(p.instance.snapshot().currentTime, 90);
  assert.equal(p.instance.data.isSeeking, false);
  assert.equal(p.queries.length, 1);
});

test('window tap-only dispatch seeks using page coordinates while paused', () => {
  const p = player({ measure: true });
  p.load('first', 0, false);
  p.metadata();
  const track = p.instance._layout.track;
  p.instance.tapSeek({ detail: { pageX: track.left + track.width / 2 } });
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek'), [['seek', 60]]);
  p.instance.handleSeekComplete(p.nativeEvent({ position: 60 }));
  assert.equal(p.instance.snapshot().playing, false);
});

test('window tap-only dispatch also seeks from native target-relative tap coordinates', () => {
  const p = player({ measure: true });
  p.load('first', 0, false);
  p.metadata();
  const track = p.instance._layout.track;
  p.instance.tapSeek({ detail: { x: track.width / 2 } });
  assert.deepEqual(p.calls.filter(([name]) => name === 'seek'), [['seek', 60]]);
});

test('seek clamps absolute and native coordinates including zero and invalid touches', () => {
  const track = { left: 25, width: 300 };
  for (const [touch, expected] of [[{ clientX: 25 }, 0], [{ clientX: 175 }, 60], [{ pageX: 325 }, 120], [{ x: 0 }, 0], [{ x: 150 }, 60], [{ x: 400 }, 120]]) {
    assert.equal(seekTime(touch, track, 120), expected);
  }
  assert.equal(seekTime({}, track, 120), null);
  assert.equal(seekTime(null, track, 120), null);
  assert.equal(seekTime({ relativeX: 150 }, track, 120), 60);
});

test('seek bubbles stay inside both edges and close to the track across viewport sizes', () => {
  for (const width of [320, 375, 414, 768]) {
    for (const full of [false, true]) {
      const layout = getPlayerLayout({ windowWidth: width, screenWidth: width, screenHeight: 844, safeArea: { left: 0, right: width, top: 44, bottom: 810 } }, full, full);
      for (const percent of [0, 1, 50, 99, 100]) {
        const style = Object.fromEntries(getSeekBubbleStyle(layout, percent, full).split(';').filter(Boolean).map((field) => {
          const [name, value] = field.split(':');
          return [name, parseFloat(value)];
        }));
        assert.ok(style.left >= layout.left);
        assert.ok(style.left + style.width <= layout.width - layout.right + 0.001);
        assert.ok(style.bottom > layout.trackBottom);
        assert.ok(style.bottom - layout.trackBottom <= (full ? 4 : 18 * layout.scale) + 0.001);
      }
    }
  }
});

test('leaving fullscreen during source arrival honors the exit and does not re-enter', () => {
  const p = player();
  p.load('first');
  p.metadata();
  p.fullscreen(true);
  p.instance.toggleFullscreen();
  p.load('next');
  p.fullscreen(false);
  p.metadata();
  assert.equal(p.instance._sourceId, 'next');
  assert.equal(p.instance.data.isFullscreen, false);
  assert.deepEqual(p.calls.filter(([name]) => name === 'enter' || name === 'exit'), [['exit']]);
});

test('partial safe-area data falls back to CSS env insets instead of stale numeric edges', () => {
  const layout = getPlayerLayout({
    windowWidth: 667,
    windowHeight: 375,
    screenWidth: 667,
    screenHeight: 375,
    safeArea: { top: 0, bottom: 375 }
  }, true, true);
  assert.equal(layout.safeAreaAvailable, false);
  assert.equal(layout.left, 18);
  assert.equal(layout.right, 18);
});
