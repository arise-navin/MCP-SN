import { chatError, readChatBody } from "../../../lib/chat-http";
import { requireSameOrigin, requireSession } from "../../../lib/chat-session";
import { chatRequestSchema } from "../../../lib/chat-schema";
import { runChat } from "../../../lib/chat";
import { AppError } from "../../../lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const session = requireSession(request);
    const parsed = chatRequestSchema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new AppError("INVALID_REQUEST", "Send 1?20 user/assistant messages ending with a user message. Each message must contain 1?24000 characters.", 400);
    return Response.json(await runChat(parsed.data.messages, session.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return chatError(error); }
}
