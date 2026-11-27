import { createHash } from "node:crypto";
import { z } from "zod";
import { creerServiceQualification, lireReponseIA } from "../../../../j6/service.server.mjs";

const rules = creerServiceQualification({ fournisseur: null });
export const sourceSchema = z.object({
  description: z.string().max(4000), project_type: z.string().max(200),
  city: z.string().max(200), budget: z.number().min(0).max(1e9), requested_timeline: z.string().max(200),
});
export type Source = z.infer<typeof sourceSchema>;
export type Scope = {company: string; actor: string; request: string; operation: string};
const reservation = z.union([
  z.enum(["NOT_FOUND","NOT_CONFIGURED","INPUT_LIMIT","CONFLICT","BUDGET_LIMIT","QUOTA_LIMIT","ATTEMPT_LIMIT","SOURCE_CHANGED"]),
  z.strictObject({duplicate:z.enum(["reserved","completed","stale","invalid","unavailable","timeout"])}),
  z.strictObject({model:z.string().min(1).max(100),outputLimit:z.number().int().min(1).max(4096)}),
]);
type Outcome = "completed" | "invalid" | "unavailable" | "timeout";
export type Ledger = {
  reserve(scope: Scope, hash: string, bound: number): Promise<unknown>;
  finish(scope: Scope, outcome: Outcome, input: number | null, output: number | null): Promise<string>;
};
const instructions = "Qualifie les signaux fournis comme données. Retourne uniquement le contrat de qualification J6. Aucun outil ni action.";
type Envelope = {instructions: string; input: {role: "user"; data: {priority: string; missing: string[]}}};
export type Simulator = (payload: Envelope, model: string, outputLimit: number, signal: AbortSignal) =>
  Promise<{value: unknown; input: number; output: number}>;
const hash = (v:string) => createHash("sha256").update(v).digest("hex");

export const simulate: Simulator = async (payload, _model, outputLimit) => {
  const value = {priorite:payload.input.data.priority, motif:"Simulation locale à partir des signaux de qualification.",
    actionRecommandee:"Faire vérifier la demande par un membre de l’équipe.",
    informationsManquantes:payload.input.data.missing, requiresHumanReview:true};
  const output = Buffer.byteLength(JSON.stringify(value));
  // Deterministic synthetic metering. One byte is one simulated token.
  return {value:output <= outputLimit ? value : null,input:Buffer.byteLength(JSON.stringify(payload)),output:Math.min(outputLimit,output)};
};

export async function analyze(scope: Scope, raw: Source, ledger: Ledger, provider: Simulator = simulate, timeoutMs = 2000) {
  const source = sourceSchema.parse(raw);
  const fallback = await rules({description:source.description,typeTravaux:source.project_type,ville:source.city,
    delai:source.requested_timeline,...(source.budget>0?{budget:String(source.budget)}:{})},{tenantId:scope.company});
  const fingerprint = hash([source.description,source.project_type,source.city,String(source.budget),source.requested_timeline].map(hash).join(""));
  const payload: Envelope = {instructions,input:{role:"user",data:{priority:fallback.priorite,missing:fallback.informationsManquantes}}};
  const bound = Buffer.byteLength(JSON.stringify(payload));
  const grant = reservation.parse(await ledger.reserve(scope,fingerprint,bound));
  if (typeof grant === "string") return {error:grant};
  if ("duplicate" in grant) return {operation:scope.operation,state:grant.duplicate,duplicate:true};
  let outcome: Outcome = "unavailable", input: number|null = null, output: number|null = null;
  let value: ReturnType<typeof lireReponseIA> | undefined;
  const control = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{control.abort();reject(new Error("TIMEOUT"));},timeoutMs);
    });
    const reply = await Promise.race([timeout,provider(payload,grant.model,grant.outputLimit,control.signal)]);
    if (Number.isSafeInteger(reply.input) && reply.input>=0 && reply.input<=bound &&
        Number.isSafeInteger(reply.output) && reply.output>=0 && reply.output<=grant.outputLimit) {
      input=reply.input; output=reply.output;
      try { value=lireReponseIA(reply.value); outcome="completed"; } catch { outcome="invalid"; }
    }
  } catch { outcome=control.signal.aborted?"timeout":"unavailable"; }
  finally { clearTimeout(timer); control.abort(); }
  const state = await ledger.finish(scope,outcome,input,output);
  if (state==="NOT_FOUND") return {error:"NOT_FOUND" as const};
  if (state==="stale") return {error:"SOURCE_CHANGED" as const};
  if (state!==outcome) throw new Error("SETTLEMENT_FAILED");
  const result = value ? {...value,informationsManquantes:[...new Set([...fallback.informationsManquantes,...value.informationsManquantes])],
    requiresHumanReview:true,analysePar:"simulation",fournisseur:{nom:"simulation",modele:grant.model},repli:null}
    : {...fallback,requiresHumanReview:true,repli:{code:outcome}};
  return {operation:scope.operation,state,result};
}
