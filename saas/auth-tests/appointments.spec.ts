import { requestChildTests } from "./request-child-tests";

requestChildTests({
  path: "/api/appointments",
  // Same clock time in Paris, on either side of the autumn DST change.
  create: { title: "Visite chantier", starts_at: "2027-10-31T02:30:00.123456+02:00", duration_minutes: 15 },
  stored: { starts_at: "2027-10-31T00:30:00.123456Z", duration_minutes: 15 },
  patch: { title: "Visite reportée", starts_at: "2027-10-31T02:30:00+01:00", duration_minutes: 240 },
  updated: { title: "Visite reportée", starts_at: "2027-10-31T01:30:00.000Z", duration_minutes: 240 },
  invalid: [
    { starts_at: "2027-10-31T02:30:00" }, { starts_at: "2027-10-31" },
    { starts_at: "2027-02-29T12:00:00Z" }, { starts_at: "2027-10-31T12:00:00+28:00" },
    { starts_at: "2027-10-31T12:00:00.1234567Z" },
    { duration_minutes: 14 }, { duration_minutes: 241 }, { duration_minutes: 15.5 },
  ],
});

import { expect, test } from "@playwright/test";

test("UTC explicite et changement de jour avec un décalage négatif", async ({ request }) => {
  const headers = { origin: "http://127.0.0.1:3128" };
  await request.post("/auth/connexion", { headers, maxRedirects: 0,
    form: { email: "alice@example.invalid", password: "test-only" } });
  const post = async (path: string, data: Record<string, string | number>) => {
    const res = await request.post(path, { headers, data });
    expect(res.status()).toBe(201);
    return (await res.json()).data;
  };
  const prospect = await post("/api/prospects", { name: "Date UTC", sector: "Travaux", city: "Nantes" });
  const quote = await post("/api/quote-requests", {
    prospect_id: prospect.id, title: "Demande UTC", description: "Contrôle de la date UTC",
  });
  const appointment = await post("/api/appointments", {
    title: "Visite", request_id: quote.id, starts_at: "2027-12-31T23:30:00.001-05:00", duration_minutes: 60,
  });
  expect(appointment.starts_at).toBe("2028-01-01T04:30:00.001Z");
  const path = "/api/appointments/" + appointment.id;
  const update = await request.patch(path, { headers, data: { starts_at: "2028-01-01T04:30:00.001Z" } });
  expect((await update.json()).data.starts_at).toBe(appointment.starts_at);
  for (const url of [path, "/api/quote-requests/" + quote.id, "/api/prospects/" + prospect.id])
    expect((await request.delete(url, { headers })).status()).toBe(204);
});
