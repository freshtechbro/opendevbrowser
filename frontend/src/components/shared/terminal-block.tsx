import type { ReactNode } from "react";

type TerminalBlockProps = {
  title: string;
  children: ReactNode;
};

export function TerminalBlock({ title, children }: TerminalBlockProps) {
  return (
    <article className="terminal reveal">
      <div className="terminal-head">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="terminal-title">{title}</span>
      </div>
      <pre>{children}</pre>
    </article>
  );
}
