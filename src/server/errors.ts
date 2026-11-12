/**
 * Typed application errors. Anything that is not an AppError is treated as an
 * internal failure and reported to clients as a generic 500 without details.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: Record<string, string[]>) => new AppError(400, "BAD_REQUEST", message, details);

export const validationError = (details: Record<string, string[]>) => new AppError(422, "VALIDATION_FAILED", "Some fields need attention.", details);

export const unauthorized = (message = "Sign in to continue.") => new AppError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "FORBIDDEN", message);

/** Used for cross-tenant and other-apartment lookups so existence is not leaked. */
export const notFound = (entity = "Record") => new AppError(404, "NOT_FOUND", `${entity} not found.`);

export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);

export const tooManyRequests = () => new AppError(429, "RATE_LIMITED", "Too many requests. Please slow down and try again.");

/** Raised by the table layer when a conditional write's condition is not met. */
export class ConditionFailedError extends Error {
  constructor(readonly failedIndex: number | null = null) {
    super("Conditional check failed");
    this.name = "ConditionFailedError";
  }
}

export function isConditionFailed(err: unknown): err is ConditionFailedError {
  return err instanceof ConditionFailedError;
}
