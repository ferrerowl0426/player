'use client';

export default function VideoFilters({ filters, onChange, onSubmit, onReset }) {
  return (
    <form className="filter-form" onSubmit={onSubmit}>
      <label>
        <span>关键词</span>
        <input
          type="search"
          value={filters.keyword}
          maxLength="120"
          placeholder="搜索标题或简介"
          onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
        />
      </label>

      <label>
        <span>开始日期</span>
        <input
          type="date"
          value={filters.startDate}
          onChange={(event) => onChange({ ...filters, startDate: event.target.value })}
        />
      </label>

      <label>
        <span>结束日期</span>
        <input
          type="date"
          value={filters.endDate}
          onChange={(event) => onChange({ ...filters, endDate: event.target.value })}
        />
      </label>

      <div className="filter-actions">
        <button type="submit">搜索</button>
        <button type="button" className="secondary-button" onClick={onReset}>清空</button>
      </div>
    </form>
  );
}
