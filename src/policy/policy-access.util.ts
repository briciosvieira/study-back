import { ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

// ADMIN always has full policy-management access, unconditionally — never
// stored as a revocable grant (see UsersService.setPermission). Mirrors
// audit-access.util.ts's pattern exactly, kept as a separate small function
// rather than importing the audit-flavored name into policy code.
export function hasPolicyManagementPermission(
  user: AuthenticatedUser,
  permission: Permission,
): boolean {
  return user.role === Role.ADMIN || user.permissions.includes(permission);
}

export function assertPolicyManagementPermission(
  user: AuthenticatedUser,
  permission: Permission,
): void {
  if (!hasPolicyManagementPermission(user, permission)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
