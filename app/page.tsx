export default function Page() {
  return <main><h1>ServiceNow Incident MCP</h1><p>A custom, authenticated MCP server for incident management.</p><p>Connect your trusted MCP client to <code>/api/mcp</code> using Streamable HTTP and your configured bearer token.</p><ul><li>create_incident</li><li>get_incident</li><li>update_incident</li></ul><p>Creating and updating incidents require explicit user approval through your client.</p></main>;
}
