"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { ThemeProvider } from "next-themes";
import { createDemoStore } from "@/lib/demo/store";

type Store = ReturnType<typeof createDemoStore>;
const DemoContext = createContext<Store | null>(null);
export function Providers({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDemoStore);
  useEffect(() => {
    try {
      store.hydrate(window.localStorage);
    } catch {
      store.hydrate(null);
    }
  }, [store]);
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="daxenvo.theme"
      disableTransitionOnChange
    >
      <DemoContext.Provider value={store}>{children}</DemoContext.Provider>
    </ThemeProvider>
  );
}
export function useDemo() {
  const store = useContext(DemoContext);
  if (!store) throw new Error("Contexte de démonstration manquant");
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return { ...snapshot, dispatch: store.dispatch, reset: store.reset };
}
