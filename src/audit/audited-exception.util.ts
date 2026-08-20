// Marks an exception as already recorded by the explicit call site that
// threw it (e.g. AuthService logging INVALID_PASSWORD with full context) —
// the global HttpExceptionFilter checks this and skips its own generic
// logging for that exception, so a login failure doesn't produce two
// AuditEvents (one specific, one generic).
export function markAudited<T extends object>(exception: T): T {
  Object.defineProperty(exception, '__audited', { value: true, enumerable: false });
  return exception;
}

export function isAudited(exception: unknown): boolean {
  return !!(
    exception &&
    typeof exception === 'object' &&
    (exception as Record<string, unknown>).__audited
  );
}
