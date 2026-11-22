import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { responseSession } from "@/lib/supabase/response";
import { AccessUnavailable, activeCompanyCookie, memberships, selectCompany, verifiedUser } from "@/lib/supabase/session";

type Client = ReturnType<ReturnType<typeof responseSession>["client"]>;
type Fields = Record<string, string | number>;
export type Resource = {
  table: string;
  columns: string;
  create: z.ZodType<Fields>;
  patch: z.ZodType<Fields>;
  checkRelation?: (client: Client, company: string, fields: Fields) => Promise<void>;
};

export class ApiError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}

export function checkDatabase(error: { code: string } | null, status: number) {
  if (!error) return;
  if (status === 401) throw new ApiError(401, "UNAUTHENTICATED");
  if (error.code === "42501") throw new ApiError(403, "FORBIDDEN");
  if (error.code === "23503") throw new ApiError(409, "RELATION_CONFLICT");
  throw new ApiError(503, "UNAVAILABLE");
}

async function readBody(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new ApiError(415, "JSON_REQUIRED");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_BODY");
  } finally { reader.releaseLock(); }
}

const page = z.strictObject({
  after: z.uuid().optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).optional(),
});

export async function handle(request: NextRequest, resource: Resource, id?: string) {
  const session = responseSession(request);
  const json = (value: unknown, status = 200) =>
    session.finish(NextResponse.json(value, { status }));
  try {
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET" && request.headers.get("origin") !== request.nextUrl.protocol + "//" + request.headers.get("host"))
      throw new ApiError(403, "ORIGIN_REFUSED");
    const client = session.client();
    const user = await verifiedUser(client);
    const active = selectCompany(await memberships(client, user.id), request.cookies.get(activeCompanyCookie)?.value);
    const company = active.company_id;
    if (id !== undefined) z.uuid().parse(id);
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length > 1))
      throw new ApiError(400, "INVALID_QUERY");
    const table = client.from(resource.table);
    if (method === "GET" && id === undefined) {
      const { after, limit = 25 } = page.parse(Object.fromEntries(params));
      let query = table.select(resource.columns).eq("company_id", company).order("id").limit(limit + 1);
      if (after) query = query.gt("id", after);
      const { data, error, status } = await query;
      checkDatabase(error, status);
      const rows = z.array(z.looseObject({ id: z.uuid() })).safeParse(data);
      if (!rows.success) throw new ApiError(503, "UNAVAILABLE");
      return json({ data: rows.data.slice(0, limit), nextCursor: rows.data.length > limit ? rows.data[limit - 1].id : null });
    }
    if (params.size) throw new ApiError(400, "INVALID_QUERY");
    if (method === "DELETE" && active.role === "member") throw new ApiError(403, "FORBIDDEN");

    let query;
    if (method === "POST" || method === "PATCH") {
      const fields = (method === "POST" ? resource.create : resource.patch).parse(await readBody(request));
      await resource.checkRelation?.(client, company, fields);
      query = method === "POST"
        ? table.insert({ ...fields, company_id: company }).select(resource.columns)
        : table.update(fields).eq("company_id", company).eq("id", id!).select(resource.columns);
    } else if (method === "DELETE") {
      query = table.delete().eq("company_id", company).eq("id", id!).select("id");
    } else {
      query = table.select(resource.columns).eq("company_id", company).eq("id", id!);
    }
    const { data, error, status } = await query.maybeSingle();
    checkDatabase(error, status);
    if (!data) throw new ApiError(404, "NOT_FOUND");
    return method === "DELETE" ? session.finish(new NextResponse(null, { status: 204 }))
      : json({ data }, method === "POST" ? 201 : 200);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "INVALID_INPUT" }, 400);
    if (error instanceof AccessUnavailable) {
      const status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_CONFIGURED: 503, UNAVAILABLE: 503 }[error.code];
      return json({ error: error.code }, status);
    }
    return json({ error: "UNAVAILABLE" }, 503);
  }
}
