import { z } from "zod";
import { AppError } from "./errors";
const environment = z.object({
  SERVICENOW_INSTANCE_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  }),
  SERVICENOW_USERNAME: z.string().min(1).refine(value => !value.includes(":")),
  SERVICENOW_PASSWORD: z.string().min(1),
  MCP_API_KEY: z.string().min(32),
});
export type ServerConfig = z.infer<typeof environment>;
export function readConfig(): ServerConfig {
  const result = environment.safeParse(process.env);
  if (!result.success) throw new AppError("CONFIGURATION_ERROR", `Set valid server environment variables: ${result.error.issues.map(issue => issue.path.join(".")).join(", ")}.`, 503);
  return result.data;
}
export function readChoices(name: "SERVICENOW_INCIDENT_STATES" | "SERVICENOW_INCIDENT_CATEGORIES"): string[] {
  const raw = process.env[name];
  if (!raw) throw new AppError("CHOICES_NOT_CONFIGURED", `Configure ${name} with administrator-verified internal values from this ServiceNow instance.`, 503);
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { throw new AppError("INVALID_CONFIGURATION", `${name} must be a JSON array of strings.`, 503); }
  const parsed = z.array(z.string().min(1)).min(1).safeParse(decoded);
  if (!parsed.success) throw new AppError("INVALID_CONFIGURATION", `${name} must contain verified internal choice values.`, 503);
  return parsed.data;
}
