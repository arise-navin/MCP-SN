import type { ReactNode } from "react";
export const metadata = { title: "ServiceNow Incident MCP" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ fontFamily: "system-ui", maxWidth: 800, margin: "64px auto", padding: 24 }}>{children}</body></html>;
}
