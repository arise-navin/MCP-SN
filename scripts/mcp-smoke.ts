import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const settings = z.object({ MCP_SERVER_URL: z.url(), MCP_API_KEY: z.string().min(32) }).parse(process.env);
const client = new Client({ name: "mcp-sn-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(settings.MCP_SERVER_URL), {
  requestInit: { headers: { Authorization: `Bearer ${settings.MCP_API_KEY}` } },
});
try {
  await client.connect(transport);
  const result = await client.listTools();
  const names = result.tools.map(tool => tool.name).sort();
  const expected = ["create_incident", "get_incident", "update_incident"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Unexpected tools: ${JSON.stringify(names)}`);
  console.log(JSON.stringify({ status: "ok", tools: names }));
} finally {
  await client.close();
}
