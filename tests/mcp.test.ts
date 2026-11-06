import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, GET, DELETE } from "../app/api/mcp/route";
import { GET as health } from "../app/api/health/route";
import { z } from "zod";
const key = "test-key-with-at-least-32-characters";
const incident = { number: "INC0010001", sys_id: "a".repeat(32), short_description: "Network outage", description: "Details", state: "1", priority: "3", impact: "2", urgency: "2", assigned_to: "", sys_updated_on: "2026-11-06 01:00:00", sys_mod_count: "0" };
const rpcSchema = z.object({ result: z.object({ isError: z.boolean().optional(), tools: z.array(z.object({ name: z.string() })).optional(), content: z.array(z.object({ type: z.string(), text: z.string() })).optional(), protocolVersion: z.string().optional() }).optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });
function request(body: object, token: string): Request {
  return new Request("https://mcp.example.com/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify(body) });
}
async function call(name: string, args: object): Promise<z.infer<typeof rpcSchema>> {
  const response = await POST(request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, key));
  expect(response.status).toBe(200);
  return rpcSchema.parse(await response.json());
}
function resultResponse(): Response { return Response.json({ result: incident }); }
function listResponse(): Response { return Response.json({ result: [incident] }); }
beforeEach(() => {
  vi.stubEnv("SERVICENOW_INSTANCE_URL", "https://test.service-now.com");
  vi.stubEnv("SERVICENOW_USERNAME", "integration"); vi.stubEnv("SERVICENOW_PASSWORD", "test-password"); vi.stubEnv("MCP_API_KEY", key);
  vi.stubEnv("SERVICENOW_INCIDENT_STATES", '["1","2"]'); vi.stubEnv("SERVICENOW_INCIDENT_CATEGORIES", '["network"]');
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected ServiceNow request"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("remote MCP transport and incident operations", () => {
  it("initializes without a session and discovers exactly three tools", async () => {
    const init = await POST(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, key));
    expect(init.status).toBe(200); expect(init.headers.has("mcp-session-id")).toBe(false);
    expect(rpcSchema.parse(await init.json()).result?.protocolVersion).toBe("2025-11-25");
    const listing = await POST(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key));
    expect(rpcSchema.parse(await listing.json()).result?.tools?.map(tool => tool.name).sort()).toEqual(["create_incident", "get_incident", "update_incident"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("creates an incident with only approved fields and no invented defaults", async () => {
    const mock = vi.mocked(fetch).mockResolvedValueOnce(resultResponse());
    const result = await call("create_incident", { short_description: "Network outage", confirmed: true });
    expect(result.result?.isError).not.toBe(true);
    const [url, options] = mock.mock.calls[0];
    expect(String(url)).toContain("/api/now/table/incident?"); expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({ short_description: "Network outage" });
    expect(result.result?.content?.[0].text).toContain("INC0010001");
  });
  it("retrieves by exact number and requests only selected fields", async () => {
    const mock = vi.mocked(fetch).mockResolvedValueOnce(listResponse());
    const result = await call("get_incident", { incident_number: incident.number });
    expect(result.result?.isError).not.toBe(true);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.searchParams.get("sysparm_query")).toBe("number=INC0010001"); expect(url.searchParams.get("sysparm_limit")).toBe("1"); expect(url.searchParams.has("sysparm_fields")).toBe(true);
  });
  it("updates the resolved sys_id and only supplied fields", async () => {
    const mock = vi.mocked(fetch).mockResolvedValueOnce(listResponse()).mockResolvedValueOnce(listResponse()).mockResolvedValueOnce(Response.json({ result: { ...incident, urgency: "1", sys_mod_count: "1" } }));
    const result = await call("update_incident", { incident_number: incident.number, urgency: "1", confirmed: true });
    expect(result.result?.isError).not.toBe(true);
    expect(String(mock.mock.calls[2][0])).toContain(`/incident/${incident.sys_id}?`);
    expect(mock.mock.calls[2][1]?.method).toBe("PATCH"); expect(JSON.parse(String(mock.mock.calls[2][1]?.body))).toEqual({ urgency: "1" });
  });
  it.each([
    ["create_incident", { short_description: "" , confirmed: true }],
    ["create_incident", { short_description: "x" }],
    ["create_incident", { short_description: "x", confirmed: false }],
    ["create_incident", { short_description: "x", confirmed: true, caller_id: "bad" }],
    ["create_incident", { short_description: "x", confirmed: true, sys_id: "bad" }],
    ["get_incident", { incident_number: "INC001^ORactive=true" }],
    ["update_incident", { incident_number: incident.number, confirmed: true }],
    ["update_incident", { incident_number: incident.number, impact: "4", confirmed: true }],
    ["update_incident", { incident_number: incident.number, state: "999", confirmed: true }],
    ["create_incident", { short_description: "x", category: "unverified", confirmed: true }],
  ])("rejects invalid input for %s without API access", async (name, args) => {
    const result = await call(name, args); expect(result.result?.isError).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("reports missing incidents clearly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ result: [] }));
    const result = await call("get_incident", { incident_number: incident.number }); expect(result.result?.content?.[0].text).toContain("INCIDENT_NOT_FOUND");
  });
  it.each([401, 403, 400, 429])("sanitizes ServiceNow HTTP %i failures and never retries writes", async status => {
    const mock = vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { detail: "SECRET PRIVATE PAYLOAD" } }, { status }));
    const result = await call("create_incident", { short_description: "x", confirmed: true });
    expect(result.result?.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("SECRET"); expect(mock).toHaveBeenCalledTimes(1);
  });
  it("retries transient read errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValueOnce(listResponse());
    const result = await call("get_incident", { incident_number: incident.number }); expect(result.result?.isError).not.toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("detects concurrent updates before PATCH", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(listResponse()).mockResolvedValueOnce(Response.json({ result: [{ ...incident, sys_mod_count: "1" }] }));
    const result = await call("update_incident", { incident_number: incident.number, urgency: "1", confirmed: true }); expect(result.result?.content?.[0].text).toContain("UPDATE_CONFLICT"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects no-op updates", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(listResponse());
    expect((await call("update_incident", { incident_number: incident.number, urgency: "2", confirmed: true })).result?.content?.[0].text).toContain("NO_CHANGES"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown tools", async () => { const result = await call("delete_incident", {}); expect(result.result?.isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); });
  it("rejects invalid or missing MCP credentials", async () => {
    expect((await POST(request({}, "wrong"))).status).toBe(401);
    expect((await POST(new Request("https://mcp.example.com/api/mcp", { method: "POST" }))).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests", async () => {
    const req = request({}, key); req.headers.set("Origin", "https://attacker.example"); expect((await POST(req)).status).toBe(403);
  });
  it("returns authenticated 405 for unsupported session methods", async () => {
    for (const handler of [GET, DELETE]) { const response = await handler(new Request("https://mcp.example.com/api/mcp", { headers: { Authorization: `Bearer ${key}` } })); expect(response.status).toBe(405); }
  });
  it("handles missing configuration and safe health responses", async () => {
    expect(health().status).toBe(200); vi.stubEnv("SERVICENOW_PASSWORD", ""); expect(health().status).toBe(503); expect((await POST(request({}, key))).status).toBe(503);
  });
  it("rejects invalid ServiceNow response shapes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ result: [{ number: incident.number }] }));
    expect((await call("get_incident", { incident_number: incident.number })).result?.content?.[0].text).toContain("INVALID_SERVICENOW_RESPONSE");
  });
  it("does not retry a write with ambiguous network outcome", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
    const result = await call("create_incident", { short_description: "x", confirmed: true }); expect(result.result?.content?.[0].text).toContain("outcome is unknown"); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("connects an official MCP client through real stateless route handlers", async () => {
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.example.com/api/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (req.method === "GET") return GET(req);
      if (req.method === "DELETE") return DELETE(req);
      return POST(req);
    },
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(["create_incident", "get_incident", "update_incident"]);
    vi.mocked(fetch).mockResolvedValueOnce(listResponse());
    const result = await client.callTool({ name: "get_incident", arguments: { incident_number: incident.number } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("INC0010001") })]));
  } finally { await client.close(); }
});
