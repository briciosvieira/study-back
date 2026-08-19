import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
  role: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  // narrow, read-only listing so instructors can pick students for course
  // visibility without needing full user-management access (admin-only)
  findStudents() {
    return this.prisma.user.findMany({
      where: { role: Role.STUDENT, active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          username: dto.username,
          role: dto.role,
          passwordHash,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw this.mapUniqueConstraintError(error);
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOneOrThrow(id);

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      email: dto.email,
      username: dto.username,
      role: dto.role,
      active: dto.active,
    };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw this.mapUniqueConstraintError(error);
    }
  }

  async remove(id: string) {
    const target = await this.findOneOrThrow(id);
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('An admin cannot delete another admin');
    }
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  private async findOneOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private mapUniqueConstraintError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ');
      return new ConflictException(`${target ?? 'Field'} already in use`);
    }
    return error;
  }
}
