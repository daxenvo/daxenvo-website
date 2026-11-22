import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <span className="eyebrow">DAXENVO · 404</span>
      <h1>Cette page n’existe pas.</h1>
      <p>Retrouvez votre espace de démonstration.</p>
      <Link className="btn primary" href="/fr/tableau-de-bord">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
