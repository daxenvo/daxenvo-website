import { z } from "zod";
import { appointmentInput } from "@/lib/domain/models";
import type { Resource } from "./api";
import { checkRequest } from "./request-relation";

// PostgreSQL retains microseconds. Date handles the offset but only stores milliseconds.
const startsAt = z.iso.datetime({ offset: true }).transform((value, ctx) => {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "";
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || fraction.length > 6 || value.startsWith("0000")) {
    ctx.addIssue({ code: "custom", message: "Horodatage invalide ou précision supérieure à six décimales." });
    return z.NEVER;
  }
  const utc = new Date(millis).toISOString();
  if (!/^[0-9]{4}-/.test(utc) || utc.startsWith("0000")) {
    ctx.addIssue({ code: "custom", message: "Date UTC hors limites." });
    return z.NEVER;
  }
  return utc.slice(0, -1) + fraction.slice(3) + "Z";
});

const editable = z.strictObject({
  title: appointmentInput.shape.title,
  starts_at: startsAt,
  duration_minutes: appointmentInput.shape.duration,
});

export const appointments: Resource = {
  table: "appointments",
  columns: "id,company_id,request_id,title,starts_at,duration_minutes",
  create: editable.extend({ request_id: z.uuid() }),
  patch: editable.partial().refine(fields => Object.keys(fields).length > 0),
  checkRelation: checkRequest,
};
