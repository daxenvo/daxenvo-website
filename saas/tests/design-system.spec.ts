import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sections } from "../src/lib/i18n/dictionaries";

for (const theme of ["dark", "light"] as const) {
  test(`Charte et accessibilité des sept modules · ${theme}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const section of sections) {
      await page.goto(`/fr/${section}`);
      await expect(page.locator("main")).toHaveAttribute("data-demo-ready", "true");
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await page.evaluate(() => document.fonts.check("14px Inter") && getComputedStyle(document.body).fontFamily.startsWith("Inter"))).toBe(true);
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(11, 17, 32)" : "rgb(248, 250, 252)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
      expect(results.violations.map(v => [v.id, v.nodes.map(n => [n.target, n.failureSummary])]), section).toEqual([]);
    }
  });
}
for (const width of [390, 820, 1440]) {
  test(`Largeur des sept modules à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const section of sections) {
      await page.goto(`/fr/${section}`);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await page.evaluate(() => document.documentElement.scrollWidth), section).toBeLessThanOrEqual(width);
    }
  });
}
