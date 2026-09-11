export default function FiltersBar({ keyword = '', onKeywordChange, onClear, children, placeholder = '搜索内容' }) {
  const filtering = Boolean(keyword);

  return (
    <div className="filters">
      <div className="filter-line">
        <label className={filtering ? 'gsearch filtering' : 'gsearch'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={keyword} onChange={(event) => onKeywordChange?.(event.target.value)} placeholder={placeholder} />
          <button className="clr" type="button" onClick={onClear}>清除</button>
        </label>
        {children}
      </div>
    </div>
  );
}
