import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./incident-tools";

/** Use the existing MCP tools within one request, without a loopback HTTP request or persistent sessions. */
export async function withIncidentClient<T>(requestId: string, operation: (client: Client) => Promise<T>): Promise<T> {
  const server = createServer(requestId);
  const client = new Client({ name: "incident-chat-host", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await operation(client);
  } finally {
    try { await client.close(); } finally { await server.close(); }
  }
}
