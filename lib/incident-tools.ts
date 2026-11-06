import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createSchema, getSchema, updateSchema } from "./validation";
import { ServiceNowClient, type Incident } from "./servicenow";
import { readChoices } from "./config";
import { AppError, safeError } from "./errors";
function validateChoice(value: string, name: "SERVICENOW_INCIDENT_STATES" | "SERVICENOW_INCIDENT_CATEGORIES"): void {
  if (!readChoices(name).includes(value)) throw new AppError("INVALID_CHOICE", `The requested choice is not allowed by ${name}. Ask the administrator to verify instance configuration.`, 400);
}
function publicIncident(incident: Incident): Omit<Incident, "sys_mod_count"> {
  const { sys_mod_count, ...visible } = incident;
  void sys_mod_count;
  return visible;
}
async function invoke(tool: string, requestId: string, operation: () => Promise<object>): Promise<CallToolResult> {
  console.info(JSON.stringify({ event: "tool_started", requestId, tool, principal: "trusted-integration-client", timestamp: new Date().toISOString() }));
  try {
    const data = await operation();
    console.info(JSON.stringify({ event: "tool_completed", requestId, tool, timestamp: new Date().toISOString() }));
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data, requestId } };
  } catch (error) {
    const safe = safeError(error);
    console.error(JSON.stringify({ event: "tool_failed", requestId, tool, code: safe.code, timestamp: new Date().toISOString() }));
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ ...safe, requestId }) }], structuredContent: { error: safe, requestId } };
  }
}
export function createServer(requestId: string): McpServer {
  const server = new McpServer({ name: "servicenow-incident-mcp", version: "1.0.0" });
  const client = new ServiceNowClient();
  server.registerTool("create_incident", {
    description: "Create a new incident in ServiceNow. Host must obtain user approval before sending confirmed: true. Omitted fields use instance defaults.", inputSchema: createSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, input => invoke("create_incident", requestId, async () => {
    const { confirmed, ...fields } = createSchema.parse(input);
    void confirmed;
    if (fields.category !== undefined) validateChoice(fields.category, "SERVICENOW_INCIDENT_CATEGORIES");
    const incident = await client.write("POST", undefined, fields);
    return { number: incident.number, sys_id: incident.sys_id, short_description: incident.short_description, state: incident.state, priority: incident.priority, message: "Incident created successfully." };
  }));
  server.registerTool("get_incident", {
    description: "Retrieve an existing ServiceNow incident by exact incident number, subject to integration-account ACLs.", inputSchema: getSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => invoke("get_incident", requestId, async () => {
    const { incident_number } = getSchema.parse(input);
    const incident = await client.find(incident_number);
    if (!incident) return { found: false, code: "INCIDENT_NOT_FOUND", message: "No readable incident exists with that number." };
    return { found: true, ...publicIncident(incident) };
  }));
  server.registerTool("update_incident", {
    description: "Update an incident by exact number. Requires at least one change and confirmed: true after host obtains user approval. State must be an administrator-verified instance choice. Work notes append and are not idempotent.", inputSchema: updateSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, input => invoke("update_incident", requestId, async () => {
    const { confirmed, incident_number, ...changes } = updateSchema.parse(input);
    void confirmed;
    if (changes.state !== undefined) validateChoice(changes.state, "SERVICENOW_INCIDENT_STATES");
    const current = await client.find(incident_number);
    if (!current) throw new AppError("INCIDENT_NOT_FOUND", "No readable incident exists with that number.", 404);
    const entries = Object.entries(changes);
    if (entries.every(([key, value]) => key !== "work_notes" && current[key as keyof Incident] === value)) throw new AppError("NO_CHANGES", "The requested values already match the incident; no update was sent.", 409);
    const latest = await client.find(incident_number);
    if (!latest || latest.sys_id !== current.sys_id || latest.sys_mod_count !== current.sys_mod_count) throw new AppError("UPDATE_CONFLICT", "The incident changed during validation. Retrieve it and obtain fresh approval before retrying.", 409);
    const updated = await client.write("PATCH", current.sys_id, changes);
    if (updated.sys_id !== current.sys_id || updated.number !== incident_number) throw new AppError("INVALID_SERVICENOW_RESPONSE", "The updated incident identity does not match. Inspect ServiceNow before retrying.", 502);
    const changedFields = entries.map(([field, value]) => ({ field, requested: value, actual: field === "work_notes" ? "Journal entry submitted; inspect ServiceNow activity for confirmation." : updated[field as keyof Incident] }));
    return { number: updated.number, sys_id: updated.sys_id, changed_fields: changedFields, message: "Update processed. Review actual values; instance policies may change or reject individual fields." };
  }));
  return server;
}
