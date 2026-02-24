import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section">
      <div className="section-inner">
        <header className="section-head">
          <h2>Page not found</h2>
          <p>The requested route does not exist in the OpenDevBrowser landing surface.</p>
        </header>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/">
            Back to Home
          </Link>
          <Link className="btn btn-secondary" href="/docs">
            Open Docs
          </Link>
        </div>
      </div>
    </section>
  );
}
