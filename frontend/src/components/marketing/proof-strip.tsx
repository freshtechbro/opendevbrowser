"use client";

import { useEffect, useRef, useState } from "react";

export type ProofMetric = {
  label: string;
  value: number;
  meta: string;
};

type ProofStripProps = {
  metrics: ProofMetric[];
};

function ProofValue({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const startedAt = performance.now();
          const duration = 1500;
          const tick = (now: number) => {
            const progress = Math.min((now - startedAt) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(Math.round(value * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          observer.disconnect();
        });
      },
      { threshold: 0.45 }
    );

    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={elementRef} className="proof-value">
      {display}
    </div>
  );
}

export function ProofStrip({ metrics }: ProofStripProps) {
  return (
    <section className="proof-strip route-anchor" id="proof-strip">
      <div className="proof-grid">
        {metrics.map((metric) => (
          <article className="proof-card reveal" key={metric.label}>
            <ProofValue value={metric.value} />
            <p>{metric.label}</p>
            <p className="meta">{metric.meta}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
