import { Role, User } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  active: boolean;
}

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    active: user.active,
  };
}
