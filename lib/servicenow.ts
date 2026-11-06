import { z } from "zod";
import { readConfig } from "./config";
import { AppError } from "./errors";
import { sysId } from "./validation";
export const incidentSchema = z.object({
  number: z.string().regex(/^INC[0-9]+$/), sys_id: sysId,
  short_description: z.string(), description: z.string(), state: z.string(), priority: z.string(),
  impact: z.string(), urgency: z.string(), assigned_to: z.string(), sys_updated_on: z.string(),
  sys_mod_count: z.string().regex(/^\d+$/),
});
export type Incident = z.infer<typeof incidentSchema>;
const fields = Object.keys(incidentSchema.shape).join(",");
export class ServiceNowClient {
  async request(method: "GET" | "POST" | "PATCH", path: string, query: URLSearchParams, body: object | undefined): Promise<unknown> {
    const config = readConfig();
    const url = new URL(`/api/now/table/${path}`, config.SERVICENOW_INSTANCE_URL);
    url.search = query.toString();
    const attempts = method === "GET" ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method, headers: { Authorization: `Basic ${Buffer.from(`${config.SERVICENOW_USERNAME}:${config.SERVICENOW_PASSWORD}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
        });
      } catch {
        if (attempt < attempts) {
          console.warn(JSON.stringify({ event: "servicenow_retry", method, attempt, reason: "network_or_timeout" }));
          await new Promise(resolve => setTimeout(resolve, attempt * 300));
          continue;
        }
        throw new AppError("SERVICENOW_UNREACHABLE", method === "GET" ? "ServiceNow could not be reached within the timeout. Check connectivity and instance URL." : "ServiceNow write outcome is unknown. Inspect the incident in ServiceNow before retrying to avoid duplicate writes.", 502);
      }
      if (!response.ok) {
        if (attempt < attempts && (response.status === 429 || response.status >= 500)) {
          console.warn(JSON.stringify({ event: "servicenow_retry", method, attempt, status: response.status }));
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, attempt * 300));
          continue;
        }
        await response.body?.cancel();
        const code = response.status === 401 ? "SERVICENOW_AUTHENTICATION_FAILED" : response.status === 403 ? "SERVICENOW_ACCESS_DENIED" : response.status === 429 ? "SERVICENOW_RATE_LIMITED" : "SERVICENOW_REQUEST_FAILED";
        throw new AppError(code, `ServiceNow ${method} incident request returned HTTP ${response.status}. Check integration credentials, ACLs, mandatory fields, data policies, and rate limits. Response content is withheld because it may contain private data.${method !== "GET" && response.status >= 500 ? " Write outcome may be unknown; inspect ServiceNow before retrying." : ""}`, 502);
      }
      try { return await response.json(); } catch { throw new AppError("INVALID_SERVICENOW_RESPONSE", "ServiceNow returned invalid JSON. For writes, inspect ServiceNow before retrying.", 502); }
    }
    throw new AppError("SERVICENOW_REQUEST_FAILED", "ServiceNow read retry budget exhausted.", 502);
  }
  async find(number: string): Promise<Incident | null> {
    const payload = await this.request("GET", "incident", new URLSearchParams({ sysparm_query: `number=${number}`, sysparm_limit: "1", sysparm_fields: fields, sysparm_display_value: "false", sysparm_exclude_reference_link: "true" }), undefined);
    const result = z.object({ result: z.array(incidentSchema).max(1) }).safeParse(payload);
    if (!result.success) throw new AppError("INVALID_SERVICENOW_RESPONSE", "ServiceNow incident response is missing required readable fields. Check field ACLs and API configuration.", 502);
    const incident = result.data.result[0] ?? null;
    if (incident && incident.number !== number) throw new AppError("INVALID_SERVICENOW_RESPONSE", "ServiceNow returned an incident that does not match the requested number.", 502);
    return incident;
  }
  async write(method: "POST" | "PATCH", id: string | undefined, changes: object): Promise<Incident> {
    const payload = await this.request(method, id === undefined ? "incident" : `incident/${id}`, new URLSearchParams({ sysparm_fields: fields, sysparm_display_value: "false", sysparm_exclude_reference_link: "true" }), changes);
    const result = z.object({ result: incidentSchema }).safeParse(payload);
    if (!result.success) throw new AppError("INVALID_SERVICENOW_RESPONSE", "ServiceNow write response is missing required fields. Inspect ServiceNow before retrying.", 502);
    return result.data.result;
  }
}
