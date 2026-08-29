// 游客模式使用 localStorage 在前端标记，不需要后端认证。
// 游客只能浏览公开视频列表和播放视频，看不到推送和留言。

const GUEST_KEY = 'video_player_guest_mode';

export function setGuestMode(value) {
  if (typeof window === 'undefined') {
    return;
  }

  if (value) {
    localStorage.setItem(GUEST_KEY, '1');
  } else {
    localStorage.removeItem(GUEST_KEY);
  }
}

export function isGuestMode() {
  if (typeof window === 'undefined') {
    return false;
  }

  return localStorage.getItem(GUEST_KEY) === '1';
}

export function clearGuestMode() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(GUEST_KEY);
}
