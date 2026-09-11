export default function PanelBox({ title, meta = '', more = null, children, className = '' }) {
  return (
    <section className={`box ${className}`.trim()}>
      <div className="box-head">
        <h2>{title}</h2>
        {more || meta ? <span className={more ? 'more' : 'meta'}>{more || meta}</span> : null}
      </div>
      {children}
    </section>
  );
}
