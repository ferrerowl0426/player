// 悬停在过长标题上时盒内横向滚动（--sd 为滚动距离，由 CSS 动画消费）
const marquee = {
  onMouseEnter: (e) => {
    const el = e.currentTarget;
      if (el.scrollWidth > el.clientWidth + 1) {
        const dist = el.scrollWidth - el.clientWidth;
        el.style.setProperty('--sd', `-${dist}px`);
        el.style.setProperty('--sdur', `${Math.max(1.5, dist / 60)}s`); // 约 60px/s，溢出越多转越久
        el.classList.add('marquee');
      }
  },
  onMouseLeave: (e) => e.currentTarget.classList.remove('marquee'),
};

export default function ListRow({ type = 'file', href = '', title, meta = '', action = null, active = false, index = null, onClick = null, label = 'PDF' }) {
  if (type === 'part') {
    const content = (
      <>
        <span className="idx">{active ? <span className="eq"><i /><i /><i /></span> : String(index || '').padStart(2, '0')}</span>
        <span className="t" {...marquee}><span className="tt">{title}</span></span>
        <span className="len">{meta}</span>
      </>
    );
    return <button className={active ? 'pl-item playing' : 'pl-item'} type="button" onClick={onClick}>{content}</button>;
  }

  if (type === 'book') {
    const body = <><span className="bcover">{label}</span><span><span className="bname" {...marquee}><span className="tt">{title}</span></span><span className="bmeta">{meta}</span></span>{action ? <span className="bops">{action}</span> : null}</>;
    return href ? <a className="brow" href={href}>{body}</a> : <div className="brow">{body}</div>;
  }

  const body = <><span className={`fico ${String(label).toLowerCase()}`}>{label}</span><span><span className="fname" {...marquee}><span className="tt">{title}</span></span><span className="fmeta">{meta}</span></span>{action ? <span className="fops">{action}</span> : null}</>;
  return href ? <a className="frow" href={href}>{body}</a> : <div className="frow">{body}</div>;
}
