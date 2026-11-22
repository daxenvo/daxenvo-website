import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Connexion hors configuration, privée et distincte de la démo", async ({
  page,
  request,
}) => {
  const response = await request.get("/espace", { maxRedirects: 0 });
  expect(response.headers().location).toContain(
    "/connexion?etat=NOT_CONFIGURED",
  );
  await page.goto("/connexion");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Supabase n’est pas configuré",
  );
  await expect(
    page.getByRole("button", { name: "Se connecter" }),
  ).toBeDisabled();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 820 });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Explorer la démonstration" }),
  ).toBeFocused();
});
