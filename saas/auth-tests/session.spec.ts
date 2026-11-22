import { expect, test, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3128";
const alpha = "20000000-0000-4000-8000-000000000001";
const beta = "20000000-0000-4000-8000-000000000002";
async function login(page: Page, name = "alice", password = "test-only") {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(name + "@example.invalid");
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}
test("Route privée sans session et réponse non stockable", async ({
  request,
}) => {
  const response = await request.get("/espace", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toContain(
    "/connexion?etat=UNAUTHENTICATED",
  );
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("Identifiants refusés", async ({ page }) => {
  await login(page, "alice", "incorrect");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "incorrect",
  );
});
test("Connexion et séparation du stockage de démonstration", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Entreprise Alpha" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("daxenvo.demo.v1")),
  ).toBeNull();
  await page.goto("/fr/tableau-de-bord");
  await expect(page.getByText("Atelier Démo").first()).toBeVisible();
});
test("Déconnexion et refus de réutilisation de la session locale", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  expect(
    (await page.context().cookies()).some((c) => c.name.endsWith("auth-token")),
  ).toBe(false);
  await page.goto("/espace");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Connectez-vous",
  );
});
test("Compte sans adhésion", async ({ page }) => {
  await login(page, "isolated");
  await expect(
    page.getByRole("heading", { name: "Accès interdit" }),
  ).toBeVisible();
  await expect(page.getByLabel("Entreprise active")).toHaveCount(0);
});
test("Service de données indisponible", async ({ page }) => {
  await login(page, "offline");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "indisponible",
  );
});
test("Changement d’entreprise autorisé et rôle propre à l’entreprise", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("Entreprise active").selectOption(beta);
  await page.getByRole("button", { name: "Ouvrir l’entreprise" }).click();
  await expect(
    page.getByRole("heading", { name: "Entreprise Beta" }),
  ).toBeVisible();
  await expect(page.getByText("Votre rôle · Propriétaire")).toBeVisible();
});
test("Entreprise étrangère refusée en POST et en cookie", async ({ page }) => {
  await login(page, "bob");
  const res = await page.request.post("/auth/entreprise", {
    form: { company_id: alpha },
    headers: { origin },
    maxRedirects: 0,
  });
  expect(res.headers().location).toContain("FORBIDDEN");
  await page
    .context()
    .addCookies([{ name: "daxenvo-company", value: alpha, url: origin }]);
  await page.goto("/espace");
  await expect(
    page.getByRole("heading", { name: "Accès interdit" }),
  ).toBeVisible();
  await expect(page.getByText("Entreprise Alpha")).toHaveCount(0);
});
test("Mutation interorigine refusée", async ({ request }) => {
  const response = await request.post("/auth/connexion", {
    headers: { origin: "https://example.invalid" },
    form: {},
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toContain("no-store");
});
for (const renewable of [true, false]) {
  test(
    renewable
      ? "Renouvellement SSR et propagation des cookies et en-têtes"
      : "Session expirée définitivement",
    async ({ page }) => {
      await login(page);
      await expect(
        page.getByRole("heading", { name: "Entreprise Alpha" }),
      ).toBeVisible();
      const context = page.context();
      const cookie = (await context.cookies()).find((c) =>
        c.name.endsWith("auth-token"),
      )!;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      const session = JSON.parse(
        Buffer.from(
          cookie.value.slice("base64-".length),
          "base64url",
        ).toString(),
      );
      session.expires_at = 1;
      if (!renewable) session.refresh_token = "expired-fixture";
      const value =
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
      await context.addCookies([{ ...cookie, value }]);
      const response = await page.request.get("/espace", { maxRedirects: 0 });
      expect(response.status()).toBe(renewable ? 200 : 303);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers().pragma).toBe("no-cache");
      expect(response.headers().expires).toBe("0");
      expect(response.headers()["set-cookie"]).toContain(cookie.name + "=");
      if (renewable) {
        expect(await response.text()).toContain("Entreprise Alpha");
        const updated = (await context.cookies()).find(
          (c) => c.name === cookie.name,
        )!;
        expect(updated.value).not.toBe(value);
        expect(updated.value).not.toBe(cookie.value);
      } else expect(response.headers().location).toContain("UNAUTHENTICATED");
    },
  );
}
test("Deux sessions simultanées conservent leurs entreprises et leurs rôles", async ({
  browser,
}) => {
  const [left, right] = await Promise.all([
    browser.newContext({ baseURL: origin }),
    browser.newContext({ baseURL: origin }),
  ]);
  try {
    const [alice, bob] = await Promise.all([left.newPage(), right.newPage()]);
    await Promise.all([login(alice), login(bob, "bob")]);
    await Promise.all([alice.reload(), bob.reload()]);
    await expect(
      alice.getByRole("heading", { name: "Entreprise Alpha" }),
    ).toBeVisible();
    await expect(
      bob.getByRole("heading", { name: "Entreprise Beta" }),
    ).toBeVisible();
    await expect(bob.getByText("Votre rôle · Membre")).toBeVisible();
    await expect(bob.getByText("Entreprise Alpha")).toHaveCount(0);
  } finally {
    await Promise.all([left.close(), right.close()]);
  }
});

test("Réponse de connexion 303 avec cookies et directives du SDK", async ({ request }) => {
  const result = await request.post("/auth/connexion", {
    headers: { origin },
    form: { email: "alice@example.invalid", password: "test-only" },
    maxRedirects: 0,
  });
  expect(result.status()).toBe(303);
  const headers = result.headers();
  expect(headers.location).toBe("/espace");
  expect(headers["cache-control"]).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
  expect(headers.pragma).toBe("no-cache");
  expect(headers.expires).toBe("0");
  expect(headers["set-cookie"]).toContain("HttpOnly");
});
