import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorize } from "../../../lib/auth";
import { createServer } from "../../../lib/incident-tools";
import { AppError, safeError } from "../../../lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    authorize(request);
    if (request.method !== "POST") return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Stateless transport supports POST only; no persistent SSE stream or sessions." } }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    const server = createServer(requestId);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65536 });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      // Consume JSON before closing the per-request transport.
      const body = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Request-Id", requestId);
      return new Response(body.byteLength ? body : null, { status: response.status, headers });
    } finally { await server.close(); }
  } catch (error) {
    const safe = safeError(error);
    const status = error instanceof AppError ? error.status : 500;
    console.warn(JSON.stringify({ event: "mcp_request_rejected", requestId, code: safe.code, status }));
    return Response.json({ error: safe, requestId }, { status, headers: { "Cache-Control": "no-store", ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } });
  }
}
export { handle as POST, handle as GET, handle as DELETE };
