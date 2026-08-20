import { ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

// ADMIN always has full audit access, unconditionally — it is never stored
// as a revocable grant (see UsersService.setPermission). Everyone else needs
// the explicit permission.
export function hasAuditPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.role === Role.ADMIN || user.permissions.includes(permission);
}

export function assertAuditPermission(user: AuthenticatedUser, permission: Permission): void {
  if (!hasAuditPermission(user, permission)) {
    throw new ForbiddenException('Insufficient audit permissions');
  }
}

// AuditNotification is shared infrastructure for two different audiences:
// security incidents (VIEW_AUDIT_LOGS) and policy reactivation requests
// (MANAGE_POLICY_REACTIVATION — see SecurityIncidentService.
// recordReactivationRequested). Either permission unlocks the notification
// endpoints specifically; the full event/incident tables and PDF export
// stay VIEW_AUDIT_LOGS/EXPORT_AUDIT_LOGS-only, unchanged.
export function assertNotificationAccess(user: AuthenticatedUser): void {
  const hasAccess =
    hasAuditPermission(user, Permission.VIEW_AUDIT_LOGS) ||
    user.permissions.includes(Permission.MANAGE_POLICY_REACTIVATION);
  if (!hasAccess) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
