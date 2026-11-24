import { expect, test } from "@playwright/test";

const headers = { origin: "http://127.0.0.1:3128" };
const path = (id: string) => "/api/quote-requests/" + id + "/bookings";

test("J10 — session obligatoire, cache privé et contrôle de l’origine", async ({ request }) => {
  const url = path(crypto.randomUUID());
  const anonymous = await request.get(url);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toContain("no-store");
  const foreign = await request.post(url, { headers: { origin: "https://example.invalid" }, data: {} });
  expect(foreign.status()).toBe(403);
});

test("J10 — la demande doit appartenir à l’entreprise active avant l’accès au calendrier", async ({ request }) => {
  await request.post("/auth/connexion", { headers, form: { email: "alice@example.invalid", password: "test-only" } });
  const prospect = await request.post("/api/prospects", { headers, data: { name: "Fixture J10", sector: "Test", city: "Paris" } });
  const quote = await request.post("/api/quote-requests", { headers, data: {
    prospect_id: (await prospect.json()).data.id, title: "Test J10", description: "Demande fictive J10",
  } });
  const url = path((await quote.json()).data.id);
  const own = await request.get(url);
  expect(own.status()).toBe(503);
  expect(await own.json()).toMatchObject({ error: "CALENDAR_NOT_CONFIGURED" });
  await request.post("/auth/entreprise", { headers, form: { company_id: "20000000-0000-4000-8000-000000000002" }, maxRedirects: 0 });
  expect((await request.get(url)).status()).toBe(404);
  expect((await request.post(url, { headers, data: { action: "sync", id: crypto.randomUUID() } })).status()).toBe(404);
});
