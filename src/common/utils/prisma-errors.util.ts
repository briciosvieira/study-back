import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Shared by UsersService/ProfileService: turns a Postgres unique-constraint
// violation into a clean 409 instead of a raw Prisma error leaking out.
export function mapUniqueConstraintError(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const target = (error.meta?.target as string[] | undefined)?.join(', ');
    return new ConflictException(`${target ?? 'Field'} already in use`);
  }
  return error;
}
