export default function ListRow({ type = 'file', href = '', title, meta = '', action = null, active = false, onClick = null }) {
  if (type === 'part') {
    const content = (
      <>
        <span className="idx">{active ? <span className="eq"><i /><i /><i /></span> : null}</span>
        <span className="t">{title}</span>
        <span className="len">{meta}</span>
      </>
    );
    return <button className={active ? 'pl-item playing' : 'pl-item'} type="button" onClick={onClick}>{content}</button>;
  }

  if (type === 'book') {
    const body = <><span className="bcover">资料</span><span><span className="bname">{title}</span><span className="bmeta">{meta}</span></span>{action ? <span className="bops">{action}</span> : null}</>;
    return href ? <a className="brow" href={href}>{body}</a> : <div className="brow">{body}</div>;
  }

  const body = <><span className="fico pdf">PDF</span><span><span className="fname">{title}</span><span className="fmeta">{meta}</span></span>{action ? <span className="fops">{action}</span> : null}</>;
  return href ? <a className="frow" href={href}>{body}</a> : <div className="frow">{body}</div>;
}
