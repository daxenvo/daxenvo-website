import {
  demoStateSchema,
  type DemoState,
  type RequestStatus,
  type Qualification,
} from "./models.ts";

export type DemoAction =
  | { type: "prospect"; value: DemoState["prospects"][number] }
  | { type: "request"; value: DemoState["requests"][number] }
  | { type: "followup"; value: DemoState["followups"][number] }
  | { type: "appointment"; value: DemoState["appointments"][number] }
  | { type: "status"; id: string; status: RequestStatus }
  | { type: "toggle-followup"; id: string }
  | { type: "qualify"; id: string; qualification: Qualification };

export function applyDemoAction(
  state: DemoState,
  action: DemoAction,
): DemoState {
  let next: DemoState;
  switch (action.type) {
    case "prospect":
      next = { ...state, prospects: [action.value, ...state.prospects] };
      break;
    case "request":
      next = { ...state, requests: [action.value, ...state.requests] };
      break;
    case "followup":
      next = { ...state, followups: [...state.followups, action.value] };
      break;
    case "appointment":
      next = { ...state, appointments: [...state.appointments, action.value] };
      break;
    case "status":
      next = {
        ...state,
        requests: state.requests.map((r) =>
          r.id === action.id ? { ...r, status: action.status } : r,
        ),
      };
      break;
    case "toggle-followup":
      next = {
        ...state,
        followups: state.followups.map((f) =>
          f.id === action.id ? { ...f, done: !f.done } : f,
        ),
      };
      break;
    case "qualify":
      next = {
        ...state,
        requests: state.requests.map((r) =>
          r.id === action.id
            ? {
                ...r,
                qualification: action.qualification,
                status: ["nouvelle", "a_qualifier"].includes(r.status)
                  ? "qualifiee"
                  : r.status,
              }
            : r,
        ),
      };
      break;
  }
  return demoStateSchema.parse(next);
}

export function dashboardMetrics(state: DemoState) {
  const active = state.requests.filter(
    (r) => !["gagnee", "perdue"].includes(r.status),
  );
  return {
    prospects: state.prospects.length,
    active: active.length,
    pipeline: active.reduce((total, r) => total + r.budget, 0),
    toQualify: active.filter((r) => !r.qualification).length,
    followups: state.followups.filter((f) => !f.done).length,
    won: state.requests.filter((r) => r.status === "gagnee").length,
  };
}
