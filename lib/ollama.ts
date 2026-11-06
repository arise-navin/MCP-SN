import { z } from "zod";
import { AppError } from "./errors";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const modelArguments = z.object({
  incident_number: z.string().optional(), short_description: z.string().optional(), description: z.string().optional(),
  impact: z.string().optional(), urgency: z.string().optional(), category: z.string().optional(),
  caller_id: z.string().optional(), state: z.string().optional(), work_notes: z.string().optional(),
  confirmed: z.boolean().optional(),
}).strict();
const modelMessageSchema = z.object({
  role: z.literal("assistant"), content: z.string(),
  tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: modelArguments }) })).max(3).optional(),
});
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type OllamaMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_name?: string; tool_calls?: ModelMessage["tool_calls"] };
function modelTool(tool: Tool): object {
  const { confirmed, ...properties } = tool.inputSchema.properties ?? {};
  void confirmed;
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: {
    ...tool.inputSchema, properties, required: tool.inputSchema.required?.filter(name => name !== "confirmed"),
  } } };
}
export async function askOllama(messages: OllamaMessage[], tools: Tool[]): Promise<ModelMessage> {
  const config = z.object({ OLLAMA_API_KEY: z.string().min(1), OLLAMA_MODEL: z.string().min(1) }).safeParse(process.env);
  if (!config.success) throw new AppError("OLLAMA_NOT_CONFIGURED", "Set OLLAMA_API_KEY and OLLAMA_MODEL to a tool-capable Ollama Cloud model on the server.", 503);
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://ollama.com/api/chat", {
        method: "POST", headers: { Authorization: `Bearer ${config.data.OLLAMA_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.data.OLLAMA_MODEL, messages, tools: tools.map(modelTool), stream: false }),
        signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
      });
    } catch {
      if (attempt < 2) {
        console.warn(JSON.stringify({ event: "ollama_retry", attempt, reason: "network_or_timeout" }));
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      throw new AppError("OLLAMA_UNREACHABLE", "Ollama Cloud could not be reached within the timeout. Check connectivity and try again.", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        console.warn(JSON.stringify({ event: "ollama_retry", attempt, status: response.status }));
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      throw new AppError("OLLAMA_REQUEST_FAILED", `Ollama Cloud returned HTTP ${response.status}. Check API key, model access, and usage limits.`, 502);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new AppError("INVALID_OLLAMA_RESPONSE", "Ollama Cloud returned invalid JSON.", 502); }
    const parsed = z.object({ message: modelMessageSchema }).safeParse(payload);
    if (!parsed.success) throw new AppError("INVALID_OLLAMA_RESPONSE", "Ollama Cloud returned an invalid chat or tool-call response. Check model tool support.", 502);
    return parsed.data.message;
  }
  throw new AppError("OLLAMA_REQUEST_FAILED", "Ollama Cloud retry budget exhausted.", 502);
}
