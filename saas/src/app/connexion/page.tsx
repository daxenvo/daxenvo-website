import Link from "next/link";
import { AccessPanel } from "@/components/access-panel";
import { Notice } from "@/components/notice";
import { configuration } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Connexion",
  description: "Connexion à votre espace Daxenvo AI.",
};
const messages: Record<string, string> = {
  NOT_CONFIGURED:
    "La connexion est indisponible. Supabase n’est pas configuré.",
  UNAVAILABLE:
    "Le service de connexion est indisponible. Réessayez dans quelques instants.",
  UNAUTHENTICATED:
    "Connectez-vous pour accéder à votre espace. Si votre session a expiré, saisissez à nouveau vos identifiants.",
  INVALID: "Adresse e-mail ou mot de passe incorrect.",
};
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  let configured = true;
  try {
    configuration();
  } catch {
    configured = false;
  }
  const { etat } = await searchParams;
  const message = configured
    ? etat && Object.hasOwn(messages, etat)
      ? messages[etat]
      : null
    : messages.NOT_CONFIGURED;
  return (
    <AccessPanel title="Connexion à votre espace">
      {message && <Notice error>{message}</Notice>}
      <form method="post" action="/auth/connexion">
        <label className="field">
          <span>Adresse e-mail</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            maxLength={320}
            disabled={!configured}
          />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={4096}
            disabled={!configured}
          />
        </label>
        <button className="btn primary" disabled={!configured}>
          Se connecter
        </button>
      </form>
      <Link href="/fr/tableau-de-bord" prefetch={false}>
        Explorer la démonstration
      </Link>
    </AccessPanel>
  );
}
