import { Permission, Role, User } from '@prisma/client';
import { buildAvatarUrl } from '../../common/utils/avatar-url.util';
import type { AccountAccessState } from '../../policy/account-access.service';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  accessState: AccountAccessState;
  permissions: Permission[];
}

// avatarPublicUrl is the same storage.publicUrl config value StorageService
// uses, and accessState is PolicyService.resolveAccessState()'s output —
// both plumbed in explicitly so this stays a pure function callable from the
// passport strategies without pulling in the storage/policy modules here.
export function toAuthenticatedUser(
  user: User,
  avatarPublicUrl: string,
  accessState: AccountAccessState,
): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    avatarUrl: buildAvatarUrl(user.avatarStorageKey, avatarPublicUrl),
    accessState,
    permissions: user.permissions,
  };
}
