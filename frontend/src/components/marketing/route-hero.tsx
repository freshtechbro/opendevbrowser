import type { ReactNode } from "react";

export type RouteHeroProps = {
  eyebrow?: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
  visual: ReactNode;
};

export function RouteHero({ eyebrow, title, description, actions, visual }: RouteHeroProps) {
  return (
    <section className="hero">
      <div className="hero-inner">
        <article className="hero-panel reveal">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          <p>{description}</p>
          {actions ? <div className="hero-actions">{actions}</div> : null}
        </article>
        <aside className="hero-visual reveal delay-lg">
          {visual}
        </aside>
      </div>
    </section>
  );
}
