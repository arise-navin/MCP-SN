import { createHash, timingSafeEqual } from "node:crypto";
import { readConfig } from "./config";
import { AppError } from "./errors";
export function authorize(request: Request): void {
  const { MCP_API_KEY } = readConfig();
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHORIZED", "Send the configured MCP bearer token.", 401);
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(header.slice(7)), digest(MCP_API_KEY))) throw new AppError("UNAUTHORIZED", "The MCP bearer token is invalid.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AppError("ORIGIN_REJECTED", "Cross-origin browser requests are not allowed.", 403);
}
