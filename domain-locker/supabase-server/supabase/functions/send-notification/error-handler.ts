export class NotificationError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = "NotificationError";
  }
}

export function handleError(error: any, context?: string): void {
  const errorMessage = context
    ? `[${context}] ${error.message}`
    : error.message;

  console.error(errorMessage, error.details ?? error);

  // Optionally log to external systems here (e.g., Sentry, GlitchTip)
  throw new NotificationError(
    "NOTIFICATION_ERROR",
    errorMessage,
    error.details,
  );
}
