import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chatError, readChatBody } from "../../../../lib/chat-http";
import { requireSameOrigin, requireSession, verifyApproval } from "../../../../lib/chat-session";
import { withIncidentClient } from "../../../../lib/chat-mcp";
import { AppError } from "../../../../lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const session = requireSession(request);
    const input = z.object({ token: z.string().min(1).max(50000) }).strict().safeParse(await readChatBody(request));
    if (!input.success) throw new AppError("INVALID_REQUEST", "Approve an unchanged proposal using its signed approval token.", 400);
    const approval = verifyApproval(input.data.token, session.id);
    const requestId = randomUUID();
    console.info(JSON.stringify({ event: "chat_mutation_approved", requestId, sessionId: session.id, approvalId: approval.id, tool: approval.mutation.name, fields: Object.keys(approval.mutation.arguments) }));
    const result = CallToolResultSchema.parse(await withIncidentClient(requestId, client => client.callTool({ name: approval.mutation.name, arguments: { ...approval.mutation.arguments, confirmed: true } })));
    const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    return Response.json({ message: text, requestId, isError: result.isError === true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return chatError(error); }
}
