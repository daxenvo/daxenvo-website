import { demoStateSchema, type DemoState } from "../domain/models.ts";
import { initialDemoState } from "../domain/fixtures.ts";
import { applyDemoAction, type DemoAction } from "../domain/operations.ts";

export const DEMO_STORAGE_KEY = "daxenvo.demo.v1";
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
type Snapshot = {
  data: DemoState;
  persistence: "loading" | "local" | "memory";
  notice: string | null;
};
const initial: Snapshot = {
  data: initialDemoState,
  persistence: "loading",
  notice: null,
};
export function createDemoStore() {
  let snapshot = initial;
  let storage: StoragePort | null = null;
  let hydrated = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  function save(data: DemoState) {
    let persistence: Snapshot["persistence"] = "memory";
    try {
      if (storage) {
        storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
        persistence = "local";
      }
    } catch {
      /* Aucun contenu local ni détail d'erreur ne doit être journalisé. */
    }
    snapshot = {
      data,
      persistence,
      notice:
        persistence === "memory"
          ? "Stockage indisponible : vos changements restent en mémoire jusqu’au rechargement."
          : null,
    };
    emit();
  }
  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    hydrate(port: StoragePort | null) {
      if (hydrated) return;
      hydrated = true;
      storage = port;
      let raw: string | null | undefined;
      try {
        raw = port?.getItem(DEMO_STORAGE_KEY);
      } catch {
        storage = null;
        save(initialDemoState);
        return;
      }
      if (raw && raw.length <= 2_000_000) {
        try {
          const result = demoStateSchema.safeParse(JSON.parse(raw));
          if (result.success) {
            snapshot = {
              data: result.data,
              persistence: "local",
              notice: null,
            };
            emit();
            return;
          }
        } catch {
          /* JSON local invalide : réinitialisation sans journalisation. */
        }
      }
      save(initialDemoState);
      if (raw) {
        snapshot = {
          ...snapshot,
          notice:
            "Les données locales invalides ont été remplacées par les exemples fictifs.",
        };
        emit();
      }
    },
    dispatch(action: DemoAction) {
      save(applyDemoAction(snapshot.data, action));
    },
    reset() {
      save(initialDemoState);
    },
  };
}
