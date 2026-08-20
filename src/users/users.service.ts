import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { ListStudentsQueryDto } from '../courses/dto/list-students-query.dto';
import { buildAvatarUrl } from '../common/utils/avatar-url.util';
import { normalizeEmail } from '../common/utils/normalize-email.util';
import { mapUniqueConstraintError } from '../common/utils/prisma-errors.util';
import { AddCoursesDto } from './dto/add-courses.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
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
  avatarStorageKey: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const COURSE_SUMMARY_SELECT = {
  id: true,
  title: true,
  description: true,
  coverUrl: true,
  active: true,
} satisfies Prisma.CourseSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toPublicUser(user));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicUser(user);
  }

  // Courses this user currently has access to — same CourseVisibility
  // relation the course-side "enrolled students" view reads from, just
  // queried from the other direction.
  async getCourses(userId: string) {
    await this.findOneOrThrow(userId);
    const rows = await this.prisma.courseVisibility.findMany({
      where: { userId },
      include: { course: { select: COURSE_SUMMARY_SELECT } },
      orderBy: { assignedAt: 'desc' },
    });
    return rows.map((row) => ({ ...row.course, assignedAt: row.assignedAt }));
  }

  // Courses NOT yet assigned to this user, for the "add course" picker.
  async getAvailableCourses(userId: string, search?: string) {
    await this.findOneOrThrow(userId);
    const trimmed = search?.trim();
    return this.prisma.course.findMany({
      where: {
        visibilities: { none: { userId } },
        ...(trimmed && { title: { contains: trimmed, mode: 'insensitive' } }),
      },
      select: COURSE_SUMMARY_SELECT,
      orderBy: { title: 'asc' },
    });
  }

  // Grants access via createMany+skipDuplicates — never touches this user's
  // existing course access, same guarantee as CoursesService.addStudents.
  async addCourses(userId: string, dto: AddCoursesDto) {
    const user = await this.findOneOrThrow(userId);
    if (user.role !== Role.STUDENT) {
      throw new BadRequestException(
        'Course access can only be granted to users with the STUDENT role',
      );
    }

    const courses = await this.prisma.course.findMany({
      where: { id: { in: dto.courseIds } },
      select: { id: true },
    });
    if (courses.length !== dto.courseIds.length) {
      throw new BadRequestException('One or more courseIds do not exist');
    }

    await this.prisma.courseVisibility.createMany({
      data: dto.courseIds.map((courseId) => ({ courseId, userId })),
      skipDuplicates: true,
    });

    return { added: dto.courseIds.length };
  }

  // Removes exactly one course's access — every other course this user has
  // access to is untouched.
  async removeCourse(userId: string, courseId: string) {
    await this.findOneOrThrow(userId);
    await this.prisma.courseVisibility.deleteMany({
      where: { userId, courseId },
    });
    return { removed: true };
  }

  // Paginated/searchable STUDENT list for the admin "Students" area, each
  // row carrying a small course preview (for the table's badge column) plus
  // the real total — same CourseVisibility relation the course-side and
  // per-user views already read from, just previewed here.
  async getStudentsOverview(query: ListStudentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          avatarStorageKey: true,
          _count: { select: { visibilities: true } },
          visibilities: {
            take: 2,
            orderBy: { assignedAt: 'desc' },
            select: { course: { select: { id: true, title: true } } },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const avatarBaseUrl = this.configService.get<string>('storage.publicUrl')!;
    return {
      items: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        avatarUrl: buildAvatarUrl(user.avatarStorageKey, avatarBaseUrl),
        totalCourses: user._count.visibilities,
        courses: user.visibilities.map((v) => v.course),
      })),
      total,
      page,
      limit,
    };
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: normalizeEmail(dto.email),
          username: dto.username,
          role: dto.role,
          passwordHash,
        },
        select: PUBLIC_USER_SELECT,
      });
      return this.toPublicUser(user);
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  // actor is the ADMIN making the call — required to enforce "can't
  // deactivate yourself" / "can't deactivate the last active admin" only
  // when active is actually being flipped to false.
  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    const target = await this.findOneOrThrow(id);

    if (dto.active === false && target.active) {
      if (target.id === actor.id) {
        throw new ForbiddenException('You cannot deactivate your own account');
      }
      if (target.role === Role.ADMIN) {
        const activeAdmins = await this.prisma.user.count({
          where: { role: Role.ADMIN, active: true },
        });
        if (activeAdmins <= 1) {
          throw new ForbiddenException(
            'Cannot deactivate the last active admin',
          );
        }
      }
    }

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      email: dto.email !== undefined ? normalizeEmail(dto.email) : undefined,
      username: dto.username,
      role: dto.role,
      active: dto.active,
    };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    try {
      const user = await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_USER_SELECT,
      });
      return this.toPublicUser(user);
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  // Admin-or-instructor administrative reset — never requires the target's
  // old password. Role check is against the TARGET fetched from the DB, not
  // anything the client claims, so this can't be bypassed by calling the API
  // directly.
  async resetPassword(
    id: string,
    dto: AdminResetPasswordDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.findOneOrThrow(id);

    if (actor.role === Role.INSTRUCTOR && target.role === Role.ADMIN) {
      throw new ForbiddenException(
        'Instructors cannot reset an admin password',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    return { reset: true };
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

  private toPublicUser<T extends { avatarStorageKey: string | null }>(
    user: T,
  ): Omit<T, 'avatarStorageKey'> & { avatarUrl: string | null } {
    const { avatarStorageKey, ...rest } = user;
    return {
      ...rest,
      avatarUrl: buildAvatarUrl(
        avatarStorageKey,
        this.configService.get<string>('storage.publicUrl')!,
      ),
    };
  }
}
