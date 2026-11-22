import { z } from "zod";
import { followupInput } from "@/lib/domain/models";
import type { Resource } from "./api";
import { checkRequest } from "./request-relation";

const editable = z.strictObject({
  title: followupInput.shape.title,
  due_date: followupInput.shape.dueDate.refine(date => !date.startsWith("0000")),
  done: z.boolean(),
});

export const followups: Resource = {
  table: "followups",
  columns: "id,company_id,request_id,title,due_date,done",
  create: editable.extend({ request_id: z.uuid(), done: z.boolean().default(false) }),
  patch: editable.partial().refine(fields => Object.keys(fields).length > 0),
  checkRelation: checkRequest,
};
