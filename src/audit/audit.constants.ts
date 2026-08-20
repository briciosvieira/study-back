export const AUDIT_CATEGORIES = [
  'USER',
  'AUTHENTICATION',
  'SECURITY',
  'POLICY',
  'ADMINISTRATION',
  'CONTENT',
  'BLOCKLIST',
  'SYSTEM',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_SEVERITIES = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

// Central registry of every event type this app records — kept as a union
// type (not a DB enum) so the column stays a plain string, but call sites
// still get autocomplete/typo-checking.
export type AuditEventType =
  // policy
  | 'POLICY_PENDING'
  | 'POLICY_MODAL_DISMISSED'
  | 'POLICY_ACCEPTED'
  | 'POLICY_REJECTED'
  | 'POLICY_ACCEPTANCE_REVOKED'
  | 'POLICY_DELETION_SCHEDULED'
  | 'POLICY_DELETION_PAUSED'
  | 'POLICY_DELETION_RESUMED'
  | 'POLICY_DELETION_CANCELLED'
  | 'USER_DELETED_POLICY_EXPIRED'
  | 'USER_DELETION_REQUESTED'
  | 'ADMIN_DELETION_REQUESTED'
  // consolidated-account policy review hold
  | 'POLICY_REVIEW_HOLD_STARTED'
  | 'POLICY_REACTIVATION_REQUESTED'
  | 'POLICY_REACTIVATION_APPROVED'
  | 'POLICY_REACTIVATION_DENIED'
  | 'POLICY_REVIEW_PERIOD_EXPIRED'
  | 'POLICY_REVIEW_ACCOUNT_DELETED'
  // users
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'USER_DELETED'
  | 'EMAIL_CHANGED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'AVATAR_UPDATED'
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_REVOKED'
  // content (generic — see resourceType)
  | 'RESOURCE_CREATED'
  | 'RESOURCE_DELETED'
  // authentication / security
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_INACTIVE'
  | 'POLICY_REQUIRED'
  | 'EMAIL_BLOCKED'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'REPEATED_FORBIDDEN_ACCESS'
  | 'REPEATED_SERVER_ERROR'
  // blocklist
  | 'EMAIL_BLOCKLIST_ADDED'
  | 'EMAIL_BLOCKLIST_REMOVED'
  // audit itself
  | 'AUDIT_LOG_EXPORTED';
