import { z } from "zod";
import type { Resource } from "./api";

const label = z.string().trim().min(2).max(160);
const create = z.strictObject({ name: label, sector: label, city: label });
export const prospects: Resource = {
  table: "prospects",
  columns: "id,company_id,name,sector,city,created_at",
  create,
  patch: create.partial().refine(value => Object.keys(value).length > 0),
};
