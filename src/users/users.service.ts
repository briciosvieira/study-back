import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Permission, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { EmailEligibilityService } from '../blocklist/email-eligibility.service';
import { buildAvatarUrl } from '../common/utils/avatar-url.util';
import { normalizeEmail } from '../common/utils/normalize-email.util';
import { mapUniqueConstraintError } from '../common/utils/prisma-errors.util';
import { ListStudentsQueryDto } from '../courses/dto/list-students-query.dto';
import { AccountDeletionService } from '../policy/account-deletion.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddCoursesDto } from './dto/add-courses.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
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
  permissions: true,
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
    private readonly auditService: AuditService,
    private readonly policyService: PolicyService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly emailEligibilityService: EmailEligibilityService,
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

  async getPolicyStatus(id: string) {
    await this.findOneOrThrow(id);
    return this.policyService.getUserPolicyStatusForAdmin(id);
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

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    const normalizedEmail = normalizeEmail(dto.email);
    await this.emailEligibilityService.assertEligible(normalizedEmail);

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: normalizedEmail,
          username: dto.username,
          role: dto.role,
          passwordHash,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }

    await this.auditService.record({
      eventType: 'USER_CREATED',
      category: 'USER',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      targetUserId: user.id,
      targetName: user.name,
      metadata: { role: user.role },
    });

    return this.toPublicUser(user);
  }

  // actor is the ADMIN making the call — required to enforce "can't
  // deactivate yourself" / "can't deactivate the last active admin" only
  // when active is actually being flipped to false, and to pause/resume the
  // policy reconsideration deadline in step with isActive.
  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    const target = await this.findOneOrThrow(id);

    const activating = dto.active === true && !target.active;
    const deactivating = dto.active === false && target.active;

    if (deactivating) {
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

    const normalizedEmail = dto.email !== undefined ? normalizeEmail(dto.email) : undefined;
    const emailChanging = normalizedEmail !== undefined && normalizedEmail !== target.email;
    if (emailChanging) {
      await this.emailEligibilityService.assertEligible(normalizedEmail);
    }

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      email: normalizedEmail,
      username: dto.username,
      role: dto.role,
      active: dto.active,
    };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    let user;
    try {
      user = await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }

    if (emailChanging) {
      await this.auditService.record({
        eventType: 'EMAIL_CHANGED',
        category: 'USER',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
      });
    }
    if (dto.password) {
      await this.auditService.record({
        eventType: 'PASSWORD_CHANGED',
        category: 'USER',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
      });
    }

    if (deactivating) {
      await this.policyService.pauseDeadlineForUser(id);
      await this.auditService.record({
        eventType: 'USER_DEACTIVATED',
        category: 'ADMINISTRATION',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
      });
    } else if (activating) {
      await this.policyService.resumeDeadlineForUser(id);
      await this.auditService.record({
        eventType: 'USER_ACTIVATED',
        category: 'ADMINISTRATION',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
      });
    } else if (dto.name !== undefined || dto.username !== undefined || dto.role !== undefined) {
      await this.auditService.record({
        eventType: 'USER_UPDATED',
        category: 'USER',
        severity: 'INFO',
        actorUserId: actor.id,
        actorName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
      });
    }

    return this.toPublicUser(user);
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

    await this.auditService.record({
      eventType: 'PASSWORD_RESET',
      category: actor.role === Role.ADMIN ? 'ADMINISTRATION' : 'USER',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      targetUserId: target.id,
      targetName: target.name,
    });

    return { reset: true };
  }

  // ADMIN-only, backend-enforced regardless of the frontend: an ADMIN can
  // never grant/revoke stored permissions on another ADMIN (their access is
  // role-based and always full, never a stored grant to add or remove).
  async setPermission(
    id: string,
    permission: Permission,
    grant: boolean,
    actor: AuthenticatedUser,
  ) {
    const target = await this.findOneOrThrow(id);
    if (target.role === Role.ADMIN) {
      throw new BadRequestException(
        'Admins already have full audit access — permissions cannot be changed for an admin account',
      );
    }

    const nextPermissions = grant
      ? Array.from(new Set([...target.permissions, permission]))
      : target.permissions.filter((p) => p !== permission);

    const user = await this.prisma.user.update({
      where: { id },
      data: { permissions: nextPermissions },
      select: PUBLIC_USER_SELECT,
    });

    await this.auditService.record({
      eventType: grant ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
      category: 'ADMINISTRATION',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      targetUserId: user.id,
      targetName: user.name,
      metadata: { permission },
    });

    return this.toPublicUser(user);
  }

  // Deletion is irreversible and shared with the automatic policy-expiry
  // job (see AccountDeletionService) — this method's job is authorization:
  // deciding whether *this* actor may delete *this* target at all.
  async remove(id: string, dto: DeleteUserDto, actor: AuthenticatedUser) {
    const target = await this.findOneOrThrow(id);

    if (target.role === Role.ADMIN) {
      if (target.id === actor.id) {
        throw new ForbiddenException('An admin cannot delete their own account');
      }

      const actorRow = await this.prisma.user.findUnique({ where: { id: actor.id } });
      const reauthOk =
        !!dto.currentPassword &&
        !!actorRow &&
        (await bcrypt.compare(dto.currentPassword, actorRow.passwordHash));
      if (!reauthOk) {
        throw new UnauthorizedException(
          'Your current password is required to delete an admin account',
        );
      }

      if (target.active) {
        const activeAdmins = await this.prisma.user.count({
          where: { role: Role.ADMIN, active: true },
        });
        if (activeAdmins <= 1) {
          throw new ForbiddenException('Cannot delete the last active admin');
        }
      }
    }

    await this.accountDeletionService.deletePermanently(
      id,
      'ADMIN_DELETION',
      'USER_DELETED',
      actor.id,
      actor.name,
    );
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
