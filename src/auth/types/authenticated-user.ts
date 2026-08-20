import { Role, User } from '@prisma/client';
import { buildAvatarUrl } from '../../common/utils/avatar-url.util';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
}

// avatarPublicUrl is the same storage.publicUrl config value StorageService
// uses — plumbed in explicitly so this stays a pure function callable from
// the passport strategies without pulling in the whole storage module.
export function toAuthenticatedUser(
  user: User,
  avatarPublicUrl: string,
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
  };
}
