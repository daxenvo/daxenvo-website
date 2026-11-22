import type { ReactNode } from "react";

export function AccessPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="access-page">
      <section className="panel access-panel">
        <div className="brand">
          daxenvo<span className="brand-ai">AI</span>
        </div>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
