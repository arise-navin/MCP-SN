# ServiceNow Incident MCP Server

A custom Next.js App Router server exposing exactly three tools over authenticated, stateless MCP Streamable HTTP at **`/api/mcp`**. It calls the official ServiceNow Table REST API directly; it does not use ServiceNow's OOTB MCP server.

## What MCP does

Model Context Protocol gives an AI host a standard way to discover and call external tools. The host connects, initializes the protocol, requests `tools/list`, and sends `tools/call`. This project uses the official TypeScript SDK to implement that protocol, rather than exposing three unrelated REST endpoints.

```text
User ? AI host / MCP client ? HTTPS /api/mcp ? ServiceNow Table API ? incident
           ?
       Ollama Cloud model
```

The SDK creates a server and Web Standard Streamable HTTP transport for each request, with session IDs disabled and JSON responses enabled. Nothing depends on process-global sessions. Authenticated GET and DELETE return 405 because this deployment does not offer a persistent SSE stream or session termination. POST handles initialization, notifications, tool discovery, and invocation. The SDK negotiates protocol versions and validates MCP requests.

## Built-in chat

The home page now includes a simple chat UI backed by Ollama Cloud. Set these server-side variables in `.env.local` and in Vercel, in addition to the ServiceNow/MCP settings:

| Name | Purpose |
| --- | --- |
| `OLLAMA_API_KEY` | Private Ollama Cloud API key |
| `OLLAMA_MODEL` | Exact tool-capable cloud model name available to your account, from Ollama's `/api/tags` listing |
| `CHAT_PASSWORD` | Separate private chat access password, at least 6 characters (use a longer random password for production); never reuse an API key |

Run `npm run dev`, open the home page, sign in with `CHAT_PASSWORD`, and chat normally (Hindi, English, or Hinglish). For example: ?INC0010001 ka status batao? or ?VPN issue ka incident banao.? Read requests run automatically. Create/update requests show exact fields with **Approve and run** and **Cancel** buttons. The server supplies `confirmed: true` only on the separate approval endpoint after verifying the signed proposal and the authenticated session. The host uses an official MCP client with a per-request in-process transport to discover/call the same existing three tools; external clients still use `/api/mcp` unchanged.

Sessions use an HttpOnly, SameSite cookie (Secure on HTTPS), expire after 8 hours, and require same-origin requests. Proposals are signed, bound to the session and exact fields, and expire after 5 minutes. The UI removes a proposal before submitting a write and never retries it automatically. Approval events include the session, proposal, and MCP audit request IDs. This is shared-password access, not individual-user authentication. Stateless signed approvals are not single-use: a technically capable authenticated client can replay one within its validity period. Add a durable approval-consumption ledger and per-user identity before workflows requiring replay-proof approvals. Sign-out removes the browser cookie; rotate the chat password to invalidate all outstanding sessions.

Chat history is kept in the current page only and clears on refresh/new chat; no database is required. Requests are limited to 20 messages and bounded model/tool rounds. Prompts and retrieved incident data are sent to Ollama Cloud. Review your organization's data-sharing policy, configure Vercel Firewall limits for login/chat endpoints, and use a tool-capable model. The basic app does not provide per-user quotas or persistent chat history. Chat requires a Vercel function duration of up to 180 seconds; verify your plan supports it. No Ollama key is exposed in browser code, and the browser never receives the MCP bearer secret.

See the official [Ollama Cloud API](https://docs.ollama.com/cloud) and [tool-calling guide](https://docs.ollama.com/capabilities/tool-calling) for model selection and API behavior.

## Requirements and local setup

Use Node.js 24 LTS (Node >=22.13 supported), npm, and an administrator-approved ServiceNow integration account. The lockfile records the installed dependencies, including Next.js, React, the MCP SDK, Zod, Vitest, and MCP Inspector.

```powershell
npm ci
Copy-Item .env.example .env.local
# Edit .env.local with your private configuration.
npm run dev
```

Open `http://localhost:3000`. The MCP URL is `http://localhost:3000/api/mcp`. Use HTTPS outside local development. `.env.local` is ignored by Git. Never put these values in `NEXT_PUBLIC_` variables or browser code.

## Configure ServiceNow and least privilege

1. Have a ServiceNow administrator create a dedicated integration user. Do not use an administrator account. Prefer web-service-only access if supported by your instance, and prohibit interactive login.
2. Create a narrowly scoped integration role and configure table, row, and field ACLs for the intended incident population. Permit read, create, and update; do not grant delete or broad table access. Role names and required entitlements vary by instance: do not assume a generic role such as `itil` is least privilege.
3. Permit reading `number`, `sys_id`, `short_description`, `description`, `state`, `priority`, `impact`, `urgency`, `assigned_to`, `sys_updated_on`, and `sys_mod_count`. Missing readable fields cause an explicit response-validation error. `assigned_to` is returned as its raw reference sys_id, not a display name.
4. Permit writes only to the fields described below. Give `caller_id` only the reference access needed for permitted callers. Preserve all row and field ACLs, business rules, and data policies; this application never elevates permissions.
5. Confirm Table API/web-service access is enabled and that HTTPS Basic authentication is permitted by your instance's authentication policies. Check network/IP restrictions for your Vercel deployment.
6. Inspect the effective Incident **state** and **category** choices in the instance dictionary / Configure Choices, including inherited choices, overrides, inactive values, dependencies, and business rules. Export administrator-approved **internal values** into the JSON environment arrays below. This is an explicit instance configuration snapshot, not a universal hardcoded state list. Review it whenever instance choices change. Do not grant broad `sys_choice` access merely for this server. State transitions and mandatory fields remain subject to ServiceNow validation; for example, a closure needing resolution fields cannot be performed through this tool's restricted field list.
7. Enable and verify ServiceNow incident auditing and journal retention. Confirm that the integration identity appears in audit records. Test ACLs as that user using read-only queries before approving any test mutation.

## Environment variables

| Name | Purpose |
| --- | --- |
| `SERVICENOW_INSTANCE_URL` | HTTPS origin, such as `https://your-instance.service-now.com`; no path, query, or embedded credentials |
| `SERVICENOW_USERNAME` | Dedicated least-privilege integration username |
| `SERVICENOW_PASSWORD` | Integration password |
| `MCP_API_KEY` | Random private bearer secret, at least 32 characters |
| `SERVICENOW_INCIDENT_STATES` | JSON string array of verified internal state values; required when setting state |
| `SERVICENOW_INCIDENT_CATEGORIES` | JSON string array of verified internal category values; required when setting category |

Generate the API key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it privately. The choice arrays in `.env.example` are deliberately empty: leaving them empty prevents use of that optional field; it does not invent defaults. Every other tool operation still works. For example, populate state choices with values exported from **your instance**, not values copied from another deployment.

`GET /api/health` returns application configuration readiness (`200` or `503`) without credentials or private settings. It does not contact ServiceNow or guarantee its availability, credentials, field ACLs, or choice snapshot freshness.

## Tool inputs and results

All schemas reject unknown input keys. Incident numbers must match `INC` followed by digits (maximum 40 characters). Descriptions and work notes are bounded to 16,000 characters. Short descriptions are trimmed and must contain 1?160 characters. `impact` and `urgency` accept only strings `"1"`, `"2"`, or `"3"`.

### create_incident

Required: `short_description`, `confirmed: true`.

Optional: `description`, `impact`, `urgency`, `category` (verified allowlist), `caller_id` (32 hexadecimal characters).

```json
{"short_description":"VPN unavailable","description":"User-approved details","impact":"2","urgency":"2","confirmed":true}
```

Sends only supplied allowlisted fields via `POST /api/now/table/incident`. Confirmation is never sent to ServiceNow. Returns number, sys_id, short description, state, priority, and a success message. Omitted fields use ServiceNow's defaults.

### get_incident

```json
{"incident_number":"INC0010001"}
```

Uses a validated exact-number query, limit 1, and explicit fields. Returns the requested incident fields and `found: true`. `found: false` with `INCIDENT_NOT_FOUND` means no incident is visible to the integration account; ACL-hidden records cannot be distinguished from absent records.

### update_incident

Required: `incident_number`, `confirmed: true`, and at least one change.

Optional changes: `short_description`, `description`, `impact`, `urgency`, `state` (verified instance allowlist), `work_notes` (nonempty; appends a journal entry).

```json
{"incident_number":"INC0010001","description":"User-approved investigation details","confirmed":true}
```

Resolves the number to sys_id and PATCHes only supplied changes. It rejects already-matching updates, re-reads `sys_mod_count` to detect changes during validation, and returns the incident identity plus requested and actual changed-field values. ServiceNow policies can reject or modify individual fields even when an HTTP request succeeds; inspect returned actual values. Journal responses confirm submission, not independently verified journal persistence.

No tool accepts arbitrary queries, tables, sys_ids to update, number changes, priority changes, ACL fields, or arbitrary table fields. MCP responses contain text JSON and structured content under `data`; expected operational failures use `isError: true` with a safe code, message, and audit request ID. The SDK handles unknown tool names and schema errors.

## Confirmation, authorization, and audit

**The host application must show the exact proposed mutation to the user and obtain approval before supplying `confirmed: true`.** Bind approval to the exact arguments and authenticated human, invalidate approval when arguments change, and enforce that policy in host code outside the model. A boolean produced by a model is not proof of approval.

The MCP endpoint independently requires `Authorization: Bearer <MCP_API_KEY>` using a constant-time digest comparison. Treat this as a single trusted-client prototype credential. It is not a complete public MCP OAuth authorization solution, and anyone holding this key can invoke all three tools under the integration account's permissions. ServiceNow ACLs are the authoritative data-access boundary. Cross-origin browser requests are rejected; use a server-side MCP client or Inspector's proxy.

Structured application logs record request ID, tool, shared client principal, lifecycle events, timestamps, safe error codes, and retry status. They exclude credentials, authorization headers, incident text, work notes, and raw ServiceNow errors. ServiceNow audit/journal history records record-level changes. Route logs and application logs do not establish a human identity or tamper-proof approval history: configure a durable Vercel log drain and retention, and maintain user/approval-to-request-ID records in the trusted host for production review.

Read calls have an 8-second attempt timeout and at most 3 attempts with bounded backoff and structured warnings for network errors, 429, or 5xx. Writes have one bounded attempt: automatic retries could duplicate incidents or journal entries. On an uncertain write outcome, inspect ServiceNow before retrying. Safe errors deliberately withhold raw response bodies and incident parameters. Operator diagnostics should use ServiceNow-side audit records.

Concurrency detection is best effort: a change between the last read and PATCH cannot be prevented atomically through this implementation. There is no durable idempotency ledger, so replayed creates and repeated work notes may duplicate data. Before production workflows require stronger guarantees, implement host-side durable request deduplication and instance-side atomic conflict enforcement. Never use in-memory locks across Vercel functions.

## Tests and checks

```powershell
npm run typecheck
npm test
npm run build
```

Vitest mocks the ServiceNow network boundary while exercising the real SDK, authentication, transport, schema validation, and tool handlers. Tests cover discovery, initialization, all three tools, confirmation and field restrictions, invalid inputs, not-found, ACL/auth failures, rate limits/retries, invalid responses, ambiguous writes, no-op/conflicting updates, configuration, and HTTP methods. Tests never contact a live instance or perform real mutations.

### MCP Inspector

```powershell
npm run inspector
```

Open the local URL printed by Inspector (retain its own proxy authentication token). Select **Streamable HTTP**, use `http://localhost:3000/api/mcp` or `https://YOUR-APP.vercel.app/api/mcp`, and configure the server's custom header `Authorization: Bearer YOUR_MCP_API_KEY`. Use Inspector's proxy connection so the browser does not send cross-origin requests directly to this server. Connect, list tools, and start with `get_incident`. Create and update are real writes when run against a configured instance: obtain approval first and use a permitted test incident.

### Read-only protocol smoke test

With the app running, this official-SDK client initializes and lists tools without making a ServiceNow request:

```powershell
$env:MCP_SERVER_URL = "https://YOUR-APP.vercel.app/api/mcp"
# Supply the real key privately in your shell or secret manager.
$env:MCP_API_KEY = "YOUR_PRIVATE_KEY"
npm run smoke:mcp
```

An unauthenticated POST must return HTTP 401. A configured `GET https://YOUR-APP.vercel.app/api/health` must return 200. A successful smoke test validates transport and discovery, not live ServiceNow access.

## Deploy from GitHub to Vercel

1. Review the uncommitted diff locally and push approved source changes to your GitHub `MCP-SN` repository. Never push `.env.local` or secrets.
2. In Vercel choose **Add New ? Project**, import `MCP-SN`, and use the Next.js preset with the repository root as root directory.
3. Use Node.js 24, `npm ci`, and `npm run build`. No custom Vercel routing or persistent server process is required. The MCP route uses the Node.js runtime and a 60-second maximum duration; verify your plan permits that duration.
4. Add the four required secrets/settings and the verified choice arrays in project environment settings. Scope production credentials to Production. Use a separate nonproduction ServiceNow instance and key for Preview and Development.
5. Deploy, check `/api/health`, run the protocol smoke test, then test authorized read access. Do not run create/update without approval. If Vercel Deployment Protection is enabled, configure the client with the separately authorized Vercel bypass header or use a suitable production URL; MCP authentication remains required.
6. After environment changes, redeploy. Rotate keys/passwords in both server and client, configure rate limits at the gateway/Vercel Firewall, and monitor request failures and ServiceNow audit history.

## External clients and Ollama Cloud

Your MCP-capable host must support remote **Streamable HTTP** and configurable authorization headers. Supply the exact `/api/mcp` URL and `Authorization: Bearer <MCP_API_KEY>` on every request. Legacy SSE-only clients are not supported. `scripts/mcp-smoke.ts` shows official SDK client connection and discovery with the required header.

Ollama models do **not** independently connect to MCP servers. An Ollama Cloud-based application must implement orchestration:

1. Authenticate the human user and create a server-side MCP SDK client with the private bearer token.
2. Initialize and call `listTools()`. Translate each discovered name, description, and JSON input schema into the tool format supported by the selected Ollama model/API.
3. Send the conversation and tool definitions to the model. Treat model arguments as untrusted.
4. For mutations, display the exact proposed change, obtain human approval, validate authorization, and only then set `confirmed: true` in host code. Do not trust a boolean from the model.
5. Call `client.callTool({ name, arguments })`, handle MCP errors, and pass the tool result back to the model to continue the conversation. Bound the tool-call loop, timeouts, and costs. Treat incident text and tool results as untrusted content to reduce prompt-injection risks.
6. Keep credentials out of prompts, model requests, logs, and the browser. Record authenticated user approval and the returned request ID in your host's durable audit store.

## Moving to OAuth

There are two separate migrations. For ServiceNow, register an OAuth integration with the instance administrator, use an approved OAuth 2.0 flow for a least-privilege principal, and update the ServiceNow connector to acquire/cache/refresh short-lived tokens in an appropriate secure shared store. Replace Basic with `Bearer` on the ServiceNow leg; preserve ACLs, timeout/error handling, and secret redaction. Do not expose refresh tokens to clients.

For a public or multi-user MCP service, replace the shared API key with standards-compliant MCP OAuth authorization, protected-resource metadata, issuer/audience/scope checks, and per-user/per-client policy. Bind approvals and audit trails to authenticated subjects. These are separate from ServiceNow authentication and are not implemented by the prototype bearer key.

Before production use, also verify instance choices and mandatory fields, least-privilege ACLs, account rotation, abuse limits, durable audit/approval retention, replay protections appropriate to the workflow, and atomic concurrency controls where required. The app is deployable; live-instance validation and these organization-specific controls require administrator configuration.

## Official references

- [MCP TypeScript SDK v1 server guide](https://ts.sdk.modelcontextprotocol.io/server) (installed SDK declarations and source are the implementation authority).
- [ServiceNow REST APIs](https://www.servicenow.com/docs/r/api-reference/rest-api-explorer/c_RESTAPI.html).
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector).
- [Vercel environment variables](https://vercel.com/docs/environment-variables).
