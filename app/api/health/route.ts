import { readConfig } from "../../../lib/config";
export const dynamic = "force-dynamic";
export function GET(): Response {
  try {
    readConfig();
    return Response.json({ status: "ok", service: "servicenow-incident-mcp" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", service: "servicenow-incident-mcp" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
