import { z } from "zod";
import { issueSession, requireSameOrigin, requireSession, sessionCookie } from "../../../../lib/chat-session";
import { chatError, readChatBody } from "../../../../lib/chat-http";
import { AppError } from "../../../../lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const parsed = z.object({ password: z.string().min(1).max(1024) }).strict().safeParse(await readChatBody(request));
    if (!parsed.success) throw new AppError("INVALID_REQUEST", "Enter the chat access password.", 400);
    const token = issueSession(parsed.data.password);
    return Response.json({ authenticated: true }, { headers: {
      "Set-Cookie": `${sessionCookie}=${token}; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
      "Cache-Control": "no-store",
    } });
  } catch (error) { return chatError(error); }
}
export function GET(request: Request): Response {
  try { requireSession(request); return Response.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return chatError(error); }
}
export function DELETE(request: Request): Response {
  try {
    requireSameOrigin(request);
    return Response.json({ authenticated: false }, { headers: { "Set-Cookie": `${sessionCookie}=; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`, "Cache-Control": "no-store" } });
  } catch (error) { return chatError(error); }
}
