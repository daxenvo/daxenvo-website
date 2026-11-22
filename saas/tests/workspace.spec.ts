import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Appel externe interdit en démonstration");
    await route.continue();
  });
});

test("sept routes accessibles, navigation active et aucun compte faussement connecté", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
  await expect(page.getByText("Données fictives · Aucun compte connecté")).toBeVisible();
  const routes = [
    ["Prospects", "prospects"], ["Demandes de devis", "demandes"], ["Qualification", "qualification"],
    ["Suivi commercial", "suivi"], ["Rendez-vous", "rendez-vous"], ["Paramètres", "parametres"],
  ];
  for (const [title, route] of routes) {
    await page.locator("aside.sidebar").getByRole("link", { name: title, exact: title !== "Demandes de devis" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/${route}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${title}.`);
    await expect(page.locator(`aside.sidebar nav a[href="/fr/${route}"]`)).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByText("Non activée", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune session utilisateur", { exact: false })).toBeVisible();
});

test("création, recherche, qualification serveur et sauvegarde locale", async ({ page }) => {
  await page.goto("/fr/prospects");
  await page.getByRole("button", { name: "Nouveau prospect", exact: true }).click();
  await page.getByLabel("Nom du prospect fictif").fill("Atelier Test J7");
  await page.getByLabel("Secteur d’activité").fill("Rénovation");
  await page.getByLabel("Ville fictive").fill("Ville Démo");
  await page.getByRole("button", { name: "Enregistrer l’exemple" }).click();
  await expect(page.getByRole("heading", { name: "Atelier Test J7" })).toBeVisible();
  await page.goto("/fr/demandes");
  await page.getByRole("button", { name: "Nouvelle demande" }).click();
  await page.getByLabel("Prospect", { exact: true }).selectOption({ label: "Atelier Test J7 (fictif)" });
  await page.getByLabel("Intitulé du projet").fill("Cuisine fictive J7");
  await page.getByLabel("Description du projet fictif").fill("Remplacer des meubles dans une cuisine fictive.");
  await page.getByLabel("Type de projet").fill("Cuisine");
  await page.getByLabel("Ville", { exact: true }).fill("Ville Démo");
  await page.getByLabel("Budget estimé").fill("6400");
  await page.getByLabel("Délai", { exact: true }).selectOption("Dès que possible");
  await page.getByRole("button", { name: "Enregistrer l’exemple" }).click();
  await page.getByRole("textbox", { name: "Rechercher une demande" }).fill("Cuisine fictive J7");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Cuisine fictive J7", exact: false }).first().click();
  await page.getByRole("link", { name: "Qualifier cette demande" }).click();
  await page.getByRole("button", { name: "Qualifier avec les règles locales" }).click();
  await expect(page.getByText("Analysé par les règles J6 · pas par une IA")).toBeVisible();
  await expect(page.locator(".result-priority strong")).toHaveText("Élevée");
  await expect(page.getByText("Les cinq informations métier sont renseignées.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Analysé par les règles J6 · pas par une IA")).toBeVisible();
  await page.goto("/fr/demandes");
  await page.getByLabel("Filtrer les demandes par statut").selectOption("qualifiee");
  await expect(page.getByText("Cuisine fictive J7", { exact: true })).toBeVisible();
});

test("les informations manquantes entraînent une revue humaine", async ({ page }) => {
  await page.goto("/fr/qualification?demande=D-1044");
  await page.getByRole("button", { name: "Qualifier avec les règles locales" }).click();
  await expect(page.getByText("Validation humaine nécessaire", { exact: false })).toBeVisible();
  await expect(page.locator(".missing-list")).toContainText("Délai");
});

test("suivi réversible et ajout d’un rendez-vous sans message externe", async ({ page }) => {
  await page.goto("/fr/suivi");
  await page.getByRole("button", { name: "Terminer : Préciser le périmètre du projet" }).click();
  await expect(page.getByRole("button", { name: "Rouvrir : Préciser le périmètre du projet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Rouvrir : Préciser le périmètre du projet" })).toBeVisible();
  await page.goto("/fr/rendez-vous");
  await page.getByRole("button", { name: "Nouveau rendez-vous" }).click();
  await page.getByLabel("Demande associée").selectOption("D-1048");
  await page.getByLabel("Objet", { exact: true }).fill("Rendez-vous fictif J7");
  await page.getByRole("button", { name: "Enregistrer l’exemple" }).click();
  await expect(page.getByRole("heading", { name: "Rendez-vous fictif J7" })).toBeVisible();
  await expect(page.getByText("aucune invitation envoyée", { exact: false })).toBeVisible();
});

test("trois thèmes persistants et suivi effectif du système", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/fr/parametres");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Thème clair", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Thème sombre", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Thème système", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.getByRole("group", { name: "Apparence de l’application" }).getByRole("button", { name: "Système", exact: false })).toHaveAttribute("aria-pressed", "true");
});

test("navigation mobile, fermeture du menu et absence de débordement de page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/tableau-de-bord");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu de navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Qualification", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Qualification.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto("/fr/tableau-de-bord");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("le dialogue est accessible au clavier et les données corrompues sont isolées", async ({ page }) => {
  await page.goto("/fr/tableau-de-bord");
  await expect(page.locator("main")).toHaveAttribute("data-demo-ready", "true");
  await page.evaluate(() => localStorage.setItem("daxenvo.demo.v1", '{"version":99}'));
  await page.reload();
  await expect(page.getByText("Les données locales invalides", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle demande" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Nouvelle demande" })).toBeFocused();
});

test("routes inconnues et locales non traduites refusées", async ({ page }) => {
  const response = await page.goto("/en/tableau-de-bord");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Cette page n’existe pas.")).toBeVisible();
  const invalid = await page.goto("/fr/administration");
  expect(invalid?.status()).toBe(404);
});

for (const theme of ["light", "dark"] as const) {
  test(`accessibilité automatique WCAG A/AA du tableau de bord et des formulaires · ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/fr/tableau-de-bord");
    await expect(page.locator("main")).toHaveAttribute("data-demo-ready", "true");
    const dashboard = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(dashboard.violations).toEqual([]);
    await page.getByRole("button", { name: "Nouvelle demande" }).click();
    const form = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(form.violations).toEqual([]);
  });
}
