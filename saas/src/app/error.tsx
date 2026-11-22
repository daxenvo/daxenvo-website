"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="empty-state">
      <h1>La page n’a pas pu être chargée.</h1>
      <p>Aucune opération externe n’a été déclenchée.</p>
      <button className="btn" onClick={reset}>
        Réessayer
      </button>
    </section>
  );
}
