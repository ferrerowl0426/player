import Link from 'next/link';

function Cover({ cover, title, collection }) {
  return (
    <div className={collection ? 'cover stack' : 'cover'}>
      {cover ? <img src={cover} alt={title} /> : <span className="disc"><span className="lbl"><i /></span></span>}
    </div>
  );
}

export default function ContentCard({ href, title, cover = '', meta = '', countLabel = '', collection = false, actions = null, className = '' }) {
  const content = (
    <>
      <Cover cover={cover} title={title} collection={collection} />
      <div className="name">{title}</div>
      <div className="meta">
        {countLabel ? <span className="cnt-chip">{countLabel}</span> : null}
        <span>{meta}</span>
      </div>
    </>
  );

  return (
    <article className={`card ${className}`.trim()}>
      {href ? <Link className="card-link" href={href}>{content}</Link> : content}
      {actions ? <div className="ops">{actions}</div> : null}
    </article>
  );
}
