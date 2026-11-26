"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/notice";
import { workspaceUrl, type Section } from "@/lib/dashboard/model";

const Tenant = createContext("");
// A channel delivers messages to other instances in the same document too.
let documentId: string | undefined;
function currentDocument() {
  return (documentId ??= crypto.randomUUID());
}
export function CompanyScope({
  company,
  children,
}: {
  company: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const bus = new BroadcastChannel("daxenvo-access");
    const reload = () => {
      document.documentElement.style.visibility = "hidden";
      location.replace("/espace");
    };
    bus.onmessage = (event) => {
      if (event.data !== currentDocument()) reload();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    window.addEventListener("pageshow", restored);
    return () => {
      bus.close();
      window.removeEventListener("pageshow", restored);
    };
  }, []);
  return <Tenant.Provider value={company}>{children}</Tenant.Provider>;
}

export function AccessForm({
  action,
  children,
}: {
  action: string;
  children: ReactNode;
}) {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new URLSearchParams();
    new FormData(e.currentTarget).forEach((v, k) => form.set(k, String(v)));
    setBusy(true);
    try {
      const response = await fetch(action, {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      if (!response.redirected) throw Error();
      const bus = new BroadcastChannel("daxenvo-access");
      bus.postMessage(currentDocument());
      bus.close();
      location.replace(response.url);
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <form action={action} method="post" onSubmit={submit}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && <Notice error>Changement d’accès indisponible.</Notice>}
    </form>
  );
}

export const messages: Record<string, string> = {
  SOURCE_CHANGED:
    "La demande a changé pendant la qualification. Relisez sa version actuelle avant de relancer les règles.",
  COMPANY_CHANGED:
    "L’entreprise active a changé. Rouvrez votre espace avant de continuer.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  FORBIDDEN: "Votre rôle ne permet pas cette action.",
  NOT_FOUND: "Cet élément est introuvable dans votre entreprise.",
  INVALID_INPUT: "Vérifiez les champs du formulaire.",
  CALENDAR_NOT_CONFIGURED:
    "Le calendrier doit être configuré par un opérateur.",
  SLOT_UNAVAILABLE: "Ce créneau a déjà été pris.",
  INVALID_WINDOW: "Choisissez une période future de sept jours au maximum.",
  NOT_CONFIGURED: "Le service doit être configuré.",
  RELATION_CONFLICT: "La relation avec la demande ou le prospect a changé.",
  EVENT_CONFLICT:
    "Cette opération entre en conflit avec une action précédente.",
};
export function useWorkspaceApi() {
  const company = useContext(Tenant);
  return useCallback(
    async (path: string, method = "GET", body?: Record<string, unknown>) => {
      if (!company) throw Error("FORBIDDEN");
      const response = await fetch(path, {
        method,
        cache: "no-store",
        headers: {
          "x-daxenvo-company": company,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok) throw Error(data?.error ?? "UNAVAILABLE");
      return data;
    },
    [company],
  );
}
export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return (
    messages[code] ??
    (/^[A-Z][A-Z0-9_]{1,60}$/.test(code)
      ? "Action indisponible · " + code
      : "Service indisponible. Vérifiez l’état enregistré avant de réessayer.")
  );
}
export function Field({
  name,
  label,
  value = "",
  type = "text",
  required = true,
  min,
  max,
  options,
}: {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: Record<string, string>;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {options ? (
        <select name={name} defaultValue={value} required={required}>
          {Object.entries(options).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          defaultValue={value}
          minLength={min}
          maxLength={max}
          required={required}
        />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          minLength={type !== "number" ? min : undefined}
          maxLength={type !== "number" ? max : undefined}
          min={type === "number" ? min : undefined}
          max={type === "number" ? max : undefined}
          step={
            type === "number" ? (name === "budget" ? "0.01" : "1") : undefined
          }
        />
      )}
    </label>
  );
}
type Result = { data?: { id?: string }; reschedule_url?: string } | null;
export function Action({
  path,
  method = "POST",
  title,
  children,
  fixed,
  operation = false,
  empty = false,
  numbers = [],
  confirm,
  createdIn,
  onResult,
}: {
  path: string;
  method?: string;
  title: string;
  children?: ReactNode;
  fixed?: Record<string, unknown>;
  operation?: boolean;
  empty?: boolean;
  numbers?: string[];
  confirm?: string;
  createdIn?: Section;
  onResult?: (value: Result) => void;
}) {
  const api = useWorkspaceApi(),
    router = useRouter();
  const [state, setState] = useState({
    busy: false,
    message: "",
    error: false,
  });
  const lock = useRef(false),
    last = useRef({ input: "", id: "" });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current || (confirm && !window.confirm(confirm))) return;
    lock.current = true;
    setState({ busy: true, message: "", error: false });
    try {
      const data: Record<string, unknown> = {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        ...fixed,
      };
      for (const key of numbers) if (key in data) data[key] = Number(data[key]);
      if (operation) {
        const input = JSON.stringify(data);
        if (last.current.input !== input)
          last.current = { input, id: crypto.randomUUID() };
        data.operation = last.current.id;
      }
      const result = await api(path, method, empty ? undefined : data);
      onResult?.(result);
      if (createdIn && result?.data?.id) {
        location.assign(workspaceUrl(createdIn, { id: result.data.id }));
        return;
      }
      setState({ busy: false, message: "Action enregistrée.", error: false });
      router.refresh();
    } catch (error) {
      setState({ busy: false, message: errorText(error), error: true });
      if (error instanceof Error && error.message === "SOURCE_CHANGED")
        router.refresh();
    } finally {
      lock.current = false;
    }
  }
  return (
    <form onSubmit={submit} className="client-form">
      <fieldset disabled={state.busy}>
        {children}
        <button className="btn secondary" type="submit">
          {state.busy ? "Traitement en cours…" : title}
        </button>
      </fieldset>
      {state.message && <Notice error={state.error}>{state.message}</Notice>}
    </form>
  );
}
