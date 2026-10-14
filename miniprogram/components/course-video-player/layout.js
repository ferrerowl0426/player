function formatTime(value = 0) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function getPlayerLayout(info = {}, full = false, horizontal = false, rect = null, envInsets = {}) {
  const windowWidth = Number(info.windowWidth || info.screenWidth) || 375;
  const screenWidth = Number(info.screenWidth || windowWidth);
  const screenHeight = Number(info.screenHeight || info.windowHeight) || 667;
  const safe = info.safeArea || {};
  const safeAreaAvailable = ['left', 'right', 'top', 'bottom'].every((edge) => (
    safe[edge] !== undefined && Number.isFinite(Number(safe[edge]))
  ));
  const insets = {
    left: Math.max(0, Number(safe.left) || 0),
    right: Math.max(0, screenWidth - Number(safe.right ?? screenWidth)),
    top: Math.max(0, Number(safe.top) || 0),
    bottom: Math.max(0, screenHeight - Number(safe.bottom ?? screenHeight))
  };
  if (!safeAreaAvailable) {
    insets.left = 0;
    insets.right = 0;
    insets.top = 0;
    insets.bottom = 0;
  }
  const width = full
    ? (horizontal ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight))
    : (rect?.width || windowWidth * (694 / 750));
  const height = full
    ? (horizontal ? Math.min(screenWidth, screenHeight) : Math.max(screenWidth, screenHeight))
    : (rect?.height || windowWidth * (390 / 750));
  if (full) {
    if (horizontal !== (screenWidth > screenHeight)) {
      // 仅原生 video 旋转时，窗口仍是旧方向，不能直接套用旧方向的 env 值。
      const side = Math.max(insets.top, insets.bottom);
      const end = Math.max(insets.left, insets.right);
      insets.left = insets.right = side;
      insets.top = end;
      // 保守保留手势区域；即使 API 没有更新也不会压住底部按钮。
      insets.bottom = Math.max(end, insets.bottom);
    } else {
      // env 由 video 外的普通 view 读取，与系统 safeArea 汇合后只输出一套坐标。
      for (const edge of ['left', 'right', 'top', 'bottom']) {
        insets[edge] = Math.max(insets[edge], Number(envInsets[edge]) || 0);
      }
    }
  }
  const origin = full ? 0 : (rect?.left ?? windowWidth * (28 / 750));
  const left = full ? (horizontal ? 18 : 12) + insets.left : windowWidth * (22 / 750);
  const right = full ? (horizontal ? 18 : 12) + insets.right : windowWidth * (22 / 750);
  const bottom = full ? 10 + insets.bottom : windowWidth * (16 / 750);
  const scale = windowWidth / 750;
  // 与 WXSS 的 padding、progress-zone 和 control-row 高度保持一致。
  const controlsHeight = full ? 10 + 34 + 38 + bottom : scale * 138;
  const trackBottom = full ? bottom + 38 + 17 : bottom + scale * (60 + 22);
  return {
    width, height, left, right, bottom, controlsHeight, trackBottom, scale, horizontal, safeAreaAvailable,
    top: full ? insets.top : 0,
    track: { left: origin + left, width: Math.max(1, width - left - right) }
  };
}

function getMenuLayout(layout, count = 0) {
  const availableWidth = Math.max(1, layout.width - layout.left - layout.right);
  const optionCount = Math.max(1, Number(count) || 1);
  // Landscape menus are the wide, one-row cards shown above the controls.
  // Portrait keeps a bounded three-column grid because a full-width row is too
  // tall on small devices and native cover-view cannot paint outside its layer.
  if (layout.horizontal) {
    const columns = Math.min(optionCount, 6);
    return {
      columns,
      width: availableWidth,
      optionWidth: Math.max(1, (availableWidth - (columns - 1) * 8) / columns),
      height: 28 + 6 + 86,
      bottom: layout.controlsHeight + 6,
      horizontal: true
    };
  }

  const optionWidth = 56;
  const columns = Math.max(1, Math.min(optionCount, 3,
    Math.floor((availableWidth - 12) / (optionWidth + 4))));
  const rows = Math.ceil(optionCount / columns);
  return {
    columns,
    width: Math.min(availableWidth, columns * (optionWidth + 4) + 12),
    optionWidth,
    height: 8 + 18 + 5 + rows * 52 + 6,
    bottom: layout.controlsHeight + 6,
    horizontal: false
  };
}

function getSeekBubbleStyle(layout, percent, full) {
  const ratio = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Number(percent))) : 0;
  const width = full ? 64 : 90 * layout.scale;
  // popupStyle is relative to the player shell, while track.left may include
  // the shell's page offset from the selector query.
  const trackLeft = layout.left;
  const edgeGap = full ? 8 : 0;
  const center = trackLeft + (full ? 6 : 8 * layout.scale) + layout.track.width * ratio / 100;
  // In window mode the player itself may have page margins. Clamp against
  // the viewport instead of the track so the 0s bubble can stay centered over
  // the knob without being clipped by that margin.
  const minLeft = full ? layout.left : edgeGap;
  const maxLeft = layout.width - (full ? layout.right : 0) - width - edgeGap;
  const left = Math.max(minLeft, Math.min(maxLeft, center - width / 2));
  // Leave the knob's radius plus a small gap between the bubble and the track.
  // The previous offset put the bubble over the knob on fullscreen devices.
  const bottom = layout.trackBottom + (full ? 14 : 28 * layout.scale);
  return `left:${left}px;bottom:${bottom}px;width:${width}px;`;
}

function seekTime(touch, rect, duration) {
  if (!touch || !rect?.width || !duration) return null;
  const absolute = touch.clientX ?? touch.pageX;
  const relative = touch.x ?? touch.relativeX;
  // The fixed touch surface starts at the track's left edge. Local x is
  // already an offset; only viewport/page coordinates need the inset removed.
  const offset = absolute !== undefined ? Number(absolute) - rect.left : Number(relative);
  if (!Number.isFinite(offset)) return null;
  return Math.max(0, Math.min(1, offset / rect.width)) * duration;
}

module.exports = { formatTime, getPlayerLayout, getMenuLayout, getSeekBubbleStyle, seekTime };
