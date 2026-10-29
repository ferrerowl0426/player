'use client';

// 公开/私密二选一切换按钮。用于分 P 与附件行。
// visibility: 'public' | 'private'；onChange 回传新值。
export default function VisibilityToggle({ visibility = 'public', onChange, disabled = false, size = 'sm' }) {
  const value = visibility === 'private' ? 'private' : 'public';

  function select(next) {
    if (disabled || next === value) return;
    onChange?.(next);
  }

  return (
    <div className={`vis-toggle vis-toggle-${size}`} role="radiogroup" aria-label="可见性">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'public'}
        className={`vis-opt vis-pub${value === 'public' ? ' on' : ''}`}
        disabled={disabled}
        onClick={() => select('public')}
      >公开</button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'private'}
        className={`vis-opt vis-priv${value === 'private' ? ' on' : ''}`}
        disabled={disabled}
        onClick={() => select('private')}
      >私密</button>
    </div>
  );
}
