import { requestChildTests } from "./request-child-tests";

requestChildTests({
  path: "/api/followups",
  create: { title: "Premier rappel", due_date: "2028-02-29" },
  stored: { due_date: "2028-02-29", done: false },
  patch: { title: "Rappel réalisé", due_date: "2027-03-28", done: true },
  updated: { title: "Rappel réalisé", due_date: "2027-03-28", done: true },
  invalid: [{ due_date: "2027-02-29" }, { due_date: "0000-01-01" }, { due_date: "2027-03-28T00:00:00Z" }, { done: "true" }],
});
