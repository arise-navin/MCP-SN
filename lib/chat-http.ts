import { randomUUID } from "node:crypto";
import { AppError, safeError } from "./errors";
export async function readChatBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("INVALID_REQUEST", "Send a JSON request body.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_REQUEST", "The request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new AppError("REQUEST_TOO_LARGE", "Chat requests must be smaller than 128 KiB. Start a new conversation.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("INVALID_JSON", "The request body must contain valid JSON.", 400); }
}
export function chatError(error: unknown): Response {
  const requestId = randomUUID();
  const safe = safeError(error);
  const status = error instanceof AppError ? error.status : 500;
  console.warn(JSON.stringify({ event: "chat_request_failed", requestId, code: safe.code, status }));
  return Response.json({ error: safe, requestId }, { status, headers: { "Cache-Control": "no-store" } });
}
