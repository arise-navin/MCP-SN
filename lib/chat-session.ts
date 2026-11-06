import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readConfig } from "./config";
import { AppError } from "./errors";
import { mutationSchema, type Mutation } from "./chat-schema";

export const sessionCookie = "incident_chat_session";
const sessionSchema = z.object({ id: z.uuid(), expiresAt: z.number() }).strict();
const approvalSchema = z.object({ sessionId: z.uuid(), expiresAt: z.number(), id: z.uuid(), mutation: mutationSchema }).strict();
function chatPassword(): string {
  const password = process.env.CHAT_PASSWORD;
  if (!password || password.length < 6) throw new AppError("CHAT_NOT_CONFIGURED", "Set CHAT_PASSWORD to a private password of at least 6 characters on the server.", 503);
  return password;
}
function signingKey(): string {
  return createHmac("sha256", readConfig().MCP_API_KEY).update(chatPassword()).digest("hex");
}
function sign(value: object, purpose: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(`${purpose}.${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}
function verify(token: string, purpose: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 50000) throw new AppError("INVALID_TOKEN", "The session or approval is invalid. Sign in again and request a fresh proposal.", 401);
  const [payload, supplied] = parts;
  const expected = createHmac("sha256", signingKey()).update(`${purpose}.${payload}`).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError("INVALID_TOKEN", "The session or approval has been modified. Sign in again and request a fresh proposal.", 401);
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new AppError("INVALID_TOKEN", "The signed payload is not valid JSON.", 401); }
}
export function requireSameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new AppError("ORIGIN_REJECTED", "Chat requests must originate from this website.", 403);
}
export function issueSession(password: string): string {
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(password), digest(chatPassword()))) throw new AppError("UNAUTHORIZED", "The chat password is incorrect.", 401);
  return sign({ id: randomUUID(), expiresAt: Date.now() + 8 * 60 * 60 * 1000 }, "session");
}
export function requireSession(request: Request): z.infer<typeof sessionSchema> {
  const token = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (!token) throw new AppError("UNAUTHORIZED", "Sign in to use incident chat.", 401);
  const parsed = sessionSchema.safeParse(verify(token, "session"));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) throw new AppError("SESSION_EXPIRED", "Your chat session expired. Sign in again.", 401);
  return parsed.data;
}
export function issueApproval(mutation: Mutation, sessionId: string): string {
  return sign({ mutation, sessionId, id: randomUUID(), expiresAt: Date.now() + 5 * 60 * 1000 }, "approval");
}
export function verifyApproval(token: string, sessionId: string): z.infer<typeof approvalSchema> {
  const result = approvalSchema.safeParse(verify(token, "approval"));
  if (!result.success || result.data.expiresAt <= Date.now() || result.data.sessionId !== sessionId) throw new AppError("APPROVAL_EXPIRED", "This proposal expired or belongs to a different session. Request a fresh proposal.", 403);
  return result.data;
}
