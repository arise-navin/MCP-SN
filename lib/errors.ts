export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AppError";
  }
}
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: "INTERNAL_ERROR", message: "The request failed unexpectedly. Contact the server operator using the audit request ID." };
}
