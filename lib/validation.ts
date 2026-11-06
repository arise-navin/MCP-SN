import { z } from "zod";
export const incidentNumber = z.string().regex(/^INC[0-9]+$/).max(40);
export const sysId = z.string().regex(/^[0-9a-f]{32}$/i);
const shortDescription = z.string().trim().min(1).max(160);
const text = z.string().max(16000);
const level = z.enum(["1", "2", "3"]);
export const createSchema = z.object({
  short_description: shortDescription,
  description: text.optional(), impact: level.optional(), urgency: level.optional(),
  category: z.string().min(1).max(100).optional(), caller_id: sysId.optional(),
  confirmed: z.literal(true).describe("Supply true only after the host application obtains explicit user approval for these exact changes."),
}).strict();
export const getSchema = z.object({ incident_number: incidentNumber }).strict();
export const updateSchema = z.object({
  incident_number: incidentNumber, short_description: shortDescription.optional(),
  description: text.optional(), impact: level.optional(), urgency: level.optional(),
  state: z.string().min(1).max(40).optional(), work_notes: text.min(1).optional(),
  confirmed: z.literal(true).describe("Supply true only after explicit user approval for these exact changes."),
}).strict().refine(value => Object.keys(value).some(key => key !== "incident_number" && key !== "confirmed"), "Provide at least one field to update.");
export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
