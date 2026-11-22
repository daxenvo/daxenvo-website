import { ApiError, checkDatabase, type Resource } from "./api";

// The composite foreign key also checks the relation when the write commits.
export const checkRequest: NonNullable<Resource["checkRelation"]> = async (client, company, fields) => {
  if (fields.request_id === undefined) return;
  const { data, error, status } = await client.from("quote_requests").select("id")
    .eq("company_id", company).eq("id", fields.request_id).maybeSingle();
  checkDatabase(error, status);
  if (!data) throw new ApiError(409, "RELATION_CONFLICT");
};
