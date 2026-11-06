"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { chatResponseSchema, type ChatMessage, type ChatResponse } from "../lib/chat-schema";

const initialMessages: ChatMessage[] = [{ role: "assistant", content: "Hi! I can help you create, find, or update a ServiceNow incident. What do you need?" }];
async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (!parsed.success) throw new Error(`The server returned an invalid error response (HTTP ${response.status}).`);
    throw new Error(parsed.data.error.message);
  }
  return body;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Check your connection and server logs.";
}
export default function Chat() {
  const [access, setAccess] = useState<"checking" | "locked" | "ready">("checking");
  const [password, setPassword] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatResponse["approval"]>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function checkSession(): Promise<void> {
      try {
        const response = await fetch("/api/chat/session", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) { if (active) setAccess("locked"); return; }
        const body = z.object({ authenticated: z.literal(true) }).parse(await readResponse(response));
        if (active && body.authenticated) setAccess("ready");
      } catch (failure) {
        if (active) { setError(errorMessage(failure)); setAccess("locked"); }
      }
    }
    void checkSession();
    return () => { active = false; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending, busy]);

  async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/chat/session", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      z.object({ authenticated: z.literal(true) }).parse(await readResponse(response));
      setPassword(""); setAccess("ready");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function signOut(): Promise<void> {
    setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/chat/session", { method: "DELETE", credentials: "same-origin" }));
      setAccess("locked"); setMessages(initialMessages); setPending(undefined); setDraft("");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.trim() || busy || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: draft.trim() }];
    setMessages(next); setDraft(""); setBusy(true); setError("");
    try {
      const response = await fetch("/api/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      if (response.status === 401) setAccess("locked");
      const reply = chatResponseSchema.parse(await readResponse(response));
      setMessages([...next, { role: "assistant", content: reply.message }]); setPending(reply.approval);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function approve(): Promise<void> {
    if (!pending || busy) return;
    const token = pending.token;
    // Consume the local proposal before sending; never automatically replay a write.
    setPending(undefined); setBusy(true); setError("");
    try {
      const response = await fetch("/api/chat/approve", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (response.status === 401) setAccess("locked");
      const reply = z.object({ message: z.string(), requestId: z.string(), isError: z.boolean() }).parse(await readResponse(response));
      setMessages(previous => [...previous, { role: "assistant", content: `${reply.isError ? "Action failed" : "ServiceNow result"} (request ${reply.requestId}):\n${reply.message}` }]);
    } catch (failure) { setError(`${errorMessage(failure)} If the request was sent, check ServiceNow before trying the write again.`); }
    finally { setBusy(false); }
  }
  function cancel(): void {
    setPending(undefined);
    setMessages(previous => [...previous, { role: "assistant", content: "Action cancelled. No write was sent." }]);
  }
  function reset(): void { setMessages(initialMessages); setPending(undefined); setError(""); setDraft(""); }

  return <main className="chat-shell">
    <header className="chat-header">
      <div><p className="eyebrow">SERVICENOW + OLLAMA CLOUD</p><h1>Incident assistant</h1><p className="subtitle">A simple place to manage your incidents.</p></div>
      {access === "ready" && <div className="header-actions"><button type="button" className="secondary" data-testid="new-chat" onClick={reset} disabled={busy || !!pending}>New chat</button><button type="button" className="secondary" data-testid="sign-out" onClick={() => void signOut()} disabled={busy}>Sign out</button></div>}
    </header>
    {access === "checking" ? <section className="access-card" role="status">Checking access?</section> : access === "locked" ? <section className="access-card">
      <h2>Welcome</h2><p>Enter your chat access password to get started.</p>
      <form onSubmit={signIn} data-testid="login-form"><label htmlFor="chat-password">Access password</label><input id="chat-password" data-testid="chat-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required maxLength={1024} disabled={busy} /><button type="submit" data-testid="sign-in" disabled={busy}>{busy ? "Signing in?" : "Open chat"}</button></form>
    </section> : <section className="chat-panel" aria-label="Incident conversation">
      <div className="messages" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => <article key={index} className={`message ${message.role}`} data-testid={`message-${index}`}><span className="message-author">{message.role === "user" ? "You" : "Assistant"}</span><div className="message-text">{message.content}</div></article>)}
        {pending && <section className="approval" data-testid="approval-card" aria-label="Review proposed changes"><h2>Approve this action?</h2><p>{pending.mutation.name === "create_incident" ? "Create a new incident" : "Update an existing incident"}</p><dl>{Object.entries(pending.mutation.arguments).map(([name, value]) => <div key={name}><dt>{name.replaceAll("_", " ")}</dt><dd>{value === "" ? "(empty)" : value}</dd></div>)}</dl><p className="muted">Approval expires in 5 minutes.</p><div className="approval-actions"><button type="button" data-testid="approve-action" onClick={() => void approve()} disabled={busy}>Approve and run</button><button type="button" className="secondary" data-testid="cancel-action" onClick={cancel} disabled={busy}>Cancel</button></div></section>}
        {busy && <p className="working" role="status">Working?</p>}
        <div ref={endRef} />
      </div>
      <form className="composer" data-testid="chat-form" onSubmit={send}><label htmlFor="chat-message" className="sr-only">Your message</label><textarea id="chat-message" data-testid="chat-message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask about an incident, or describe an issue?" rows={2} maxLength={4000} disabled={busy || !!pending || messages.length >= 20} required /><button type="submit" data-testid="send-message" disabled={busy || !!pending || !draft.trim() || messages.length >= 20}>Send</button></form>
      <p className="chat-note">{pending ? "Approve or cancel the proposed action to continue." : messages.length >= 20 ? "Conversation limit reached. Start a new chat to continue." : "Create and update actions always need your approval. Chat and retrieved incident data are sent to Ollama Cloud."}</p>
    </section>}
    {error && <p className="error" role="alert" data-testid="chat-error">{error}</p>}
    <footer>ServiceNow Incident MCP ? <code>/api/mcp</code></footer>
  </main>;
}
