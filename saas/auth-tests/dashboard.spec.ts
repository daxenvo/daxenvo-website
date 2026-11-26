import { expect, test, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3128";
const beta = "20000000-0000-4000-8000-000000000002";
async function login(page: Page, name = "alice") {
  await page.request.post("/auth/connexion", {
    headers: { origin },
    form: { email: name + "@example.invalid", password: "test-only" },
  });
  await page.goto("/espace");
}
async function fixture(page: Page) {
  const post = async (path: string, data: Record<string, string>) => {
    const r = await page.request.post(path, { headers: { origin }, data });
    expect(r.status()).toBe(201);
    return (await r.json()).data.id as string;
  };
  const prospect = await post("/api/prospects", {
    name: "Contact de test",
    city: "Paris",
    sector: "Travaux",
  });
  return post("/api/quote-requests", {
    prospect_id: prospect,
    title: "Aménagement du local",
    description: "Projet fictif de rénovation",
  });
}
test("J11 — parcours commercial et changement d’entreprise sans données résiduelles", async ({
  page,
}, info) => {
  await login(page);
  await expect(
    page.getByText("Relances planifiées", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Prospects", exact: true }).click();
  await page.getByText("Ajouter un prospect").click();
  await page.getByLabel("Nom du prospect").fill("Atelier Tulipe");
  await page.getByLabel("Secteur", { exact: true }).first().fill("Agencement");
  await page.getByLabel("Ville", { exact: true }).fill("Nantes");
  await page
    .getByLabel("Adresse e-mail de contact")
    .fill("atelier@example.invalid");
  await page.getByRole("button", { name: "Créer le prospect" }).click();
  await expect(
    page.getByRole("heading", { name: "Atelier Tulipe" }),
  ).toBeVisible();
  await page.getByText("Modifier le prospect").click();
  await page.getByLabel("Ville", { exact: true }).fill("Angers");
  await page.getByRole("button", { name: "Enregistrer le prospect" }).click();
  await expect(page.getByText("Agencement · Angers")).toBeVisible();
  await page.getByText("Créer une demande pour ce prospect").click();
  await page.getByLabel("Objet de la demande").fill("Agencement du bureau");
  await page
    .getByLabel("Description du projet")
    .fill("Rénover un bureau de 45 mètres carrés.");
  await page.getByRole("button", { name: "Créer la demande" }).click();
  await expect(
    page.getByRole("heading", { name: "Agencement du bureau" }),
  ).toBeVisible();
  await page.getByText("Modifier la demande").click();
  await page.getByLabel("Statut commercial").selectOption("en_cours");
  await page.getByRole("button", { name: "Enregistrer la demande" }).click();
  await expect(
    page.getByText("Devis en cours ·", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Qualifications", exact: true }).click();
  await expect(
    page.getByText("Aucune qualification enregistrée."),
  ).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Qualifier la demande" }).click();
  await expect(
    page.getByText("Dernière qualification · Révision 1"),
  ).toBeVisible();
  await page.route("**/qualifications", (r) =>
    r.fulfill({ status: 409, json: { error: "SOURCE_CHANGED" } }),
  );
  await page.getByRole("button", { name: "Qualifier la demande" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "La demande a changé",
  );
  const old = page.url();
  await page
    .getByRole("link", { name: "Tableau de bord", exact: true })
    .last()
    .click();
  await page.screenshot({
    path: info.outputPath("tableau-de-bord.png"),
    fullPage: true,
  });
  await page.getByLabel("Entreprise active").selectOption(beta);
  await page.getByRole("button", { name: "Ouvrir l’entreprise" }).click();
  await expect(
    page.getByRole("heading", { name: "Entreprise Beta" }),
  ).toBeVisible();
  await page.goto(old);
  await expect(
    page.getByText("Fiche introuvable dans l’entreprise active."),
  ).toBeVisible();
  const stale = await page.request.post("/api/prospects", {
    headers: {
      origin,
      "x-daxenvo-company": "20000000-0000-4000-8000-000000000001",
    },
    data: {},
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toEqual({ error: "COMPANY_CHANGED" });
});
test("J11 — mobile, chargement, opposition, rôles et états du calendrier simulé", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "bob");
  const id = await fixture(page);
  await page.goto("/espace?vue=parametres");
  await expect(page.getByText("Aucun calendrier provisionné")).toBeVisible();
  await expect(page.getByText("Configurer les relances")).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/followup-automation", async (r) => {
    await gate;
    await r.fulfill({
      json: {
        job: {
          state: "cancelled",
          reason: "opt_out",
          paused: false,
          sent_count: 0,
          due_at: null,
          channel: null,
        },
        history: [],
      },
    });
  });
  await page.goto("/espace?vue=demandes&id=" + id + "&onglet=relances");
  await expect(page.getByText("Chargement des données…")).toBeVisible();
  release();
  await expect(
    page.getByText(/Opposition aux communications/).first(),
  ).toBeVisible();
  await expect(page.locator('option[value="resume"]')).toHaveCount(0);
  const start = "2027-01-12T13:00:00.000Z";
  const booking = {
    id: crypto.randomUUID(),
    title: "Visite fictive",
    start,
    status: "proposed",
    minutes: 30,
    zone: "Europe/Paris",
    error: null,
    retry_at: null,
    cancellation_requested: false,
  };
  await page.route("**/bookings", async (r) => {
    if (r.request().method() === "POST") {
      const input = r.request().postDataJSON();
      if (input.action === "availability")
        return r.fulfill({ json: { data: [{ start, minutes: 30 }] } });
      if (input.action === "reserve") {
        booking.status = "pending";
        return r.fulfill({ status: 202, json: { data: booking } });
      }
      if (input.action === "sync") {
        booking.status = "confirmed";
        return r.fulfill({ json: { data: booking } });
      }
    }
    return r.fulfill({ json: { data: [booking], nextCursor: null } });
  });
  await page.getByRole("link", { name: "Réservations", exact: true }).click();
  await expect(page.getByText(/Proposé ·/)).toBeVisible();
  await page.getByLabel("Journée recherchée (UTC)").fill("2027-01-12");
  await page
    .getByRole("button", { name: "Consulter les disponibilités" })
    .click();
  await expect(
    page.getByLabel("Créneau disponible (heure de Paris)"),
  ).toBeVisible();
  await page.getByLabel("Nom de l’invité").fill("Invité fictif");
  await page.getByLabel("E-mail de l’invité").fill("invite@example.invalid");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Demander la réservation" }).click();
  await expect(page.getByText(/En attente ·/)).toBeVisible();
  await expect(page.getByText(/Confirmé ·/)).toHaveCount(0);
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByText(/Confirmé ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Annuler le rendez-vous" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("reservations-mobile.png"),
    fullPage: true,
  });
  await page.route("**/bookings", (r) =>
    r.fulfill({ status: 503, json: { error: "CALENDAR_NOT_CONFIGURED" } }),
  );
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "configuré par un opérateur",
  );
});

test("J11 — changement de contexte et déconnexion propagés au second onglet", async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  await other.goto("/espace?vue=parametres");
  await expect(
    other.getByRole("heading", { name: "Entreprise Alpha" }),
  ).toBeVisible();
  await page.getByLabel("Entreprise active").selectOption(beta);
  await page.getByRole("button", { name: "Ouvrir l’entreprise" }).click();
  for (const tab of [page, other]) {
    await expect(
      tab.getByRole("heading", { name: "Entreprise Beta" }),
    ).toBeVisible();
    await expect(tab.getByText("Votre rôle · Propriétaire")).toBeVisible();
  }
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(other).toHaveURL(/\/connexion/);
  await expect(
    other.getByRole("heading", { name: "Entreprise Beta" }),
  ).toHaveCount(0);
});
