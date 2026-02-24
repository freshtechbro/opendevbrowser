import type { ReactNode } from "react";

type SectionShellProps = {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function SectionShell({ id, title, description, children }: SectionShellProps) {
  return (
    <section id={id} className="section route-anchor">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2>{title}</h2>
          <p>{description}</p>
        </header>
        {children}
      </div>
    </section>
  );
}
