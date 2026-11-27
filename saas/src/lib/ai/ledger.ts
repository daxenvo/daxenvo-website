import "server-only";
import postgres from "postgres";
import type { Ledger, Scope } from "./analysis.server";

let pool: ReturnType<typeof postgres> | undefined;
export function simulatedLedger(): Ledger | null {
  if (process.env.DAXENVO_AI_MODE !== "simulation" || !process.env.DAXENVO_AI_DATABASE_URL) return null;
  const url = new URL(process.env.DAXENVO_AI_DATABASE_URL);
  if (!["postgresql:","postgres:"].includes(url.protocol) || url.username !== "daxenvo_ai_runtime" ||
      !url.password || url.search || url.hash || !url.hostname) return null;
  pool ??= postgres(url.toString(),{ssl:"verify-full",max:3,prepare:false,connect_timeout:4,idle_timeout:10,
    onnotice:()=>{},connection:{application_name:"daxenvo-j12"}});
  const sql = pool;
  async function transaction<T>(scope:Scope, work:(tx:postgres.TransactionSql)=>Promise<T>) {
    return sql.begin(async tx=>{
      await tx.unsafe("set local role daxenvo_ai_gateway");
      await tx.unsafe("set local statement_timeout='4s'");
      await tx`select set_config('daxenvo.ai_company',${scope.company},true),set_config('daxenvo.ai_actor',${scope.actor},true)`;
      return work(tx);
    });
  }
  return {
    reserve:(s,hash,bound)=>transaction(s,async tx=>(await tx`select daxenvo_private.ai_reserve(${s.operation},${s.request},${hash},${bound}) as result`)[0].result),
    finish:(s,state,input,output)=>transaction(s,async tx=>(await tx`select daxenvo_private.ai_finish(${s.operation},${s.request},${state},${input},${output}) as result`)[0].result as string),
  };
}
