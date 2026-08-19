import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ListStudentsQueryDto } from '../courses/dto/list-students-query.dto';
import { AddCoursesDto } from './dto/add-courses.dto';
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

const COURSE_SUMMARY_SELECT = {
  id: true,
  title: true,
  description: true,
  coverUrl: true,
  active: true,
} satisfies Prisma.CourseSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
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

    return {
      items: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
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
