import { z } from "zod";
import { requestInput, statuses } from "@/lib/domain/models";
import { ApiError, checkDatabase, type Resource } from "./api";

const shortText = z.string().trim().max(200);
const create = z.strictObject({
  prospect_id: z.uuid(),
  title: requestInput.shape.title,
  description: requestInput.shape.description,
  project_type: shortText.optional(),
  city: shortText.optional(),
  budget: z.number().min(0).max(1_000_000_000).multipleOf(0.01).optional(),
  requested_timeline: shortText.optional(),
  status: z.enum(statuses).optional(),
});

export const quoteRequests: Resource = {
  table: "quote_requests",
  columns: "id,company_id,prospect_id,title,description,project_type,city,budget,requested_timeline,status,created_at",
  create,
  patch: create.partial().refine(value => Object.keys(value).length > 0),
  async checkRelation(client, company, fields) {
    if (fields.prospect_id === undefined) return;
    const { data, error, status } = await client.from("prospects").select("id")
      .eq("company_id", company).eq("id", fields.prospect_id).maybeSingle();
    checkDatabase(error, status);
    if (!data) throw new ApiError(409, "RELATION_CONFLICT");
  },
};
