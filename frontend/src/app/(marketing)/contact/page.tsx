import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/seo/metadata";
import { SectionShell } from "@/components/shared/section-shell";

export const metadata: Metadata = createRouteMetadata({
  title: "Contact",
  description: "Contact the OpenDevBrowser team with implementation, support, or integration requests.",
  path: "/contact"
});

export default function ContactPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <article className="hero-panel reveal">
            <h1>
              Contact the <span className="grad">OpenDevBrowser team</span>
            </h1>
            <p>Share your use case, integration goals, or support request. Submitting this form opens a prefilled message.</p>
          </article>
          <aside className="hero-panel reveal delay-lg" id="contact-form">
            <form
              className="contact-form"
              action="mailto:team@opendevbrowser.com"
              method="post"
              encType="text/plain"
              aria-label="Contact OpenDevBrowser team"
            >
              <label htmlFor="contact-name">Name</label>
              <input id="contact-name" name="name" type="text" required autoComplete="name" />

              <label htmlFor="contact-email">Work email</label>
              <input id="contact-email" name="email" type="email" required autoComplete="email" />

              <label htmlFor="contact-company">Company</label>
              <input id="contact-company" name="company" type="text" autoComplete="organization" />

              <label htmlFor="contact-subject">Subject</label>
              <input id="contact-subject" name="subject" type="text" required />

              <label htmlFor="contact-message">Message</label>
              <textarea id="contact-message" name="message" rows={6} required />

              <button type="submit" className="btn btn-primary">
                Send Message
              </button>
            </form>
          </aside>
        </div>
      </section>

      <SectionShell
        title="Response expectations"
        description="Use this channel for architecture questions, workflow integration support, and enterprise reliability reviews."
      >
        <div className="grid cols-3">
          <article className="card reveal">
            <h3>Integration support</h3>
            <p>Share your runtime mode, relay setup, and target sites so we can return actionable guidance.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "70ms" }}>
            <h3>Security review</h3>
            <p>Reference required controls so we can map your needs to docs, command surfaces, and implementation paths.</p>
          </article>
          <article className="card reveal" style={{ transitionDelay: "140ms" }}>
            <h3>Issue escalation</h3>
            <p>Include reproduction steps and diagnostics to speed up triage and resolution.</p>
          </article>
        </div>
      </SectionShell>
    </>
  );
}
