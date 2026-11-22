import test from "node:test";
import assert from "node:assert/strict";
import { initialDemoState } from "./fixtures.ts";
import { demoStateSchema, requestInput, appointmentInput } from "./models.ts";
import { applyDemoAction, dashboardMetrics } from "./operations.ts";
import { createDemoStore, DEMO_STORAGE_KEY } from "../demo/store.ts";
import { isLocale, isSection } from "../i18n/dictionaries.ts";

test("les exemples sont valides, reliés et les indicateurs calculés", () => {
  const data = demoStateSchema.parse(initialDemoState);
  assert.equal(data.prospects.length, 5);
  assert.deepEqual(dashboardMetrics(data), {
    prospects: 5,
    active: 5,
    pipeline: 49500,
    toQualify: 5,
    followups: 3,
    won: 1,
  });
});
test("une référence croisée ou un doublon invalide est rejeté", () => {
  const data = structuredClone(initialDemoState);
  data.requests[0].prospectId = "absent";
  assert.equal(demoStateSchema.safeParse(data).success, false);
  assert.throws(() =>
    applyDemoAction(initialDemoState, {
      type: "prospect",
      value: initialDemoState.prospects[0],
    }),
  );
});
test("les entrées métier bornent descriptions, budgets, dates et horaires", () => {
  assert.equal(
    requestInput.safeParse({ ...initialDemoState.requests[0], budget: -1 })
      .success,
    false,
  );
  assert.equal(
    requestInput.safeParse({
      ...initialDemoState.requests[0],
      description: "x".repeat(4001),
    }).success,
    false,
  );
  assert.equal(
    appointmentInput.safeParse({
      ...initialDemoState.appointments[0],
      time: "25:99",
    }).success,
    false,
  );
  assert.equal(
    appointmentInput.safeParse({
      ...initialDemoState.appointments[0],
      date: "2026-02-30",
    }).success,
    false,
  );
});
test("la qualification locale modifie le bon dossier et ne rétrograde pas une affaire gagnée", () => {
  const qualification = {
    priorite: "moyenne" as const,
    motif: "Exemple fictif",
    actionRecommandee: "Relire",
    informationsManquantes: [],
    analysePar: "regles" as const,
    requiresHumanReview: false,
  };
  const result = applyDemoAction(initialDemoState, {
    type: "qualify",
    id: "D-1048",
    qualification,
  });
  assert.equal(result.requests[0].status, "qualifiee");
  assert.equal(result.requests[1].qualification, null);
  assert.equal(initialDemoState.requests[0].qualification, null);
  const won = applyDemoAction(initialDemoState, {
    type: "qualify",
    id: "D-1043",
    qualification,
  });
  assert.equal(won.requests.find((r) => r.id === "D-1043")?.status, "gagnee");
});
test("les tâches et statuts restent cohérents avec les indicateurs", () => {
  const done = applyDemoAction(initialDemoState, {
    type: "toggle-followup",
    id: "f1",
  });
  assert.equal(dashboardMetrics(done).followups, 2);
  const won = applyDemoAction(done, {
    type: "status",
    id: "D-1048",
    status: "gagnee",
  });
  assert.equal(dashboardMetrics(won).active, 4);
  assert.equal(dashboardMetrics(won).pipeline, 31000);
});
test("la sauvegarde locale se restaure, notifie et se réinitialise", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const first = createDemoStore();
  let updates = 0;
  const unsubscribe = first.subscribe(() => {
    updates++;
  });
  first.hydrate(storage);
  first.dispatch({ type: "toggle-followup", id: "f1" });
  assert.equal(updates, 2);
  const second = createDemoStore();
  second.hydrate(storage);
  assert.equal(second.getSnapshot().data.followups[0].done, true);
  second.reset();
  assert.equal(second.getSnapshot().data.followups[0].done, false);
  assert.ok(values.has(DEMO_STORAGE_KEY));
  unsubscribe();
});
test("un stockage refusé reste en mémoire et est signalé honnêtement", () => {
  const store = createDemoStore();
  store.hydrate({
    getItem: () => null,
    setItem: () => {
      throw new Error("Interdit");
    },
  });
  store.dispatch({ type: "toggle-followup", id: "f1" });
  assert.equal(store.getSnapshot().persistence, "memory");
  assert.equal(store.getSnapshot().data.followups[0].done, true);
  assert.match(store.getSnapshot().notice ?? "", /mémoire/);
});
test("les données stockées malformées ne sont pas interprétées comme des données valides", () => {
  const store = createDemoStore();
  store.hydrate({
    getItem: () => JSON.stringify({ version: 99 }),
    setItem() {},
  });
  assert.equal(store.getSnapshot().data.requests.length, 7);
  assert.match(store.getSnapshot().notice ?? "", /invalides/);
});
test("la navigation valide explicitement les routes et locales disponibles", () => {
  assert.equal(isLocale("fr"), true);
  assert.equal(isLocale("en"), false);
  assert.equal(isSection("qualification"), true);
  assert.equal(isSection("admin"), false);
});

test("une seconde initialisation ne remplace pas une modification ni un avertissement", () => {
  const store = createDemoStore();
  const storage = { getItem: () => '{"version":99}', setItem() {} };
  store.hydrate(storage);
  store.hydrate(storage);
  assert.match(store.getSnapshot().notice ?? "", /invalides/);
  store.dispatch({ type: "toggle-followup", id: "f1" });
  store.hydrate(storage);
  assert.equal(store.getSnapshot().data.followups[0].done, true);
});
test("un JSON tronqué est remplacé sans désactiver un stockage fonctionnel", () => {
  const store = createDemoStore();
  let saved = "{";
  store.hydrate({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  assert.equal(store.getSnapshot().persistence, "local");
  assert.match(store.getSnapshot().notice ?? "", /invalides/);
  assert.equal(demoStateSchema.safeParse(JSON.parse(saved)).success, true);
});
