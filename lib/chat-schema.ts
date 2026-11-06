import { z } from "zod";
import { createSchema, getSchema, updateSchema } from "./validation";

const createArguments = createSchema.omit({ confirmed: true });
const updateArguments = z.object(updateSchema.shape).omit({ confirmed: true }).strict().refine(
  value => Object.keys(value).some(key => key !== "incident_number"),
  "Provide at least one field to update.",
);
export const mutationSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("create_incident"), arguments: createArguments }).strict(),
  z.object({ name: z.literal("update_incident"), arguments: updateArguments }).strict(),
]);
export const toolCallSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("get_incident"), arguments: getSchema }).strict(),
  ...mutationSchema.options,
]);
export type Mutation = z.infer<typeof mutationSchema>;
export const chatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(24000) }).strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatRequestSchema = z.object({ messages: z.array(chatMessageSchema).min(1).max(20) }).strict().refine(
  value => value.messages.at(-1)?.role === "user", "The last message must be from the user.",
);
export const chatResponseSchema = z.object({
  message: z.string(),
  approval: z.object({ token: z.string(), mutation: mutationSchema }).strict().optional(),
}).strict();
export type ChatResponse = z.infer<typeof chatResponseSchema>;
