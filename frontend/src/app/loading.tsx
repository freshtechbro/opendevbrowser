export default function Loading() {
  return (
    <section className="section" aria-busy="true" aria-live="polite">
      <div className="section-inner">
        <div className="grid cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <article key={index} className="card" style={{ minHeight: "140px", opacity: 0.65 }} />
          ))}
        </div>
      </div>
    </section>
  );
}
