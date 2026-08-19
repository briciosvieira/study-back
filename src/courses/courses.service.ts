import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CourseCoverStorageService } from './course-cover-storage.service';
import { AddStudentsDto } from './dto/add-students.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

const PAGINATED_STUDENT_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverStorage: CourseCoverStorageService,
  ) {}

  findAllForStaff() {
    return this.prisma.course.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findMineForStudent(studentId: string) {
    return this.prisma.course.findMany({
      where: {
        active: true,
        visibilities: { some: { userId: studentId } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (user.role === Role.STUDENT) {
      const isVisible = await this.prisma.courseVisibility.findUnique({
        where: { courseId_userId: { courseId: id, userId: user.id } },
      });
      if (!isVisible || !course.active) {
        throw new NotFoundException('Course not found');
      }
    }

    return course;
  }

  create(dto: CreateCourseDto, createdById: string) {
    return this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description,
        createdById,
      },
    });
  }

  async update(id: string, dto: UpdateCourseDto) {
    await this.findOrThrow(id);
    return this.prisma.course.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const course = await this.findOrThrow(id);
    await this.prisma.course.delete({ where: { id } });
    if (course.coverUrl) {
      await this.coverStorage.delete(course.coverUrl);
    }
    return { deleted: true };
  }

  async uploadCover(id: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected field "file")');
    }
    const course = await this.findOrThrow(id);

    const newKey = await this.coverStorage.save(file.buffer, file.mimetype);

    try {
      const updated = await this.prisma.course.update({
        where: { id },
        data: { coverUrl: newKey },
      });
      // only remove the previous file once the new one is confirmed saved
      if (course.coverUrl) {
        await this.coverStorage.delete(course.coverUrl);
      }
      return updated;
    } catch (error) {
      await this.coverStorage.delete(newKey);
      throw error;
    }
  }

  async removeCover(id: string) {
    const course = await this.findOrThrow(id);
    const updated = await this.prisma.course.update({
      where: { id },
      data: { coverUrl: null },
    });
    if (course.coverUrl) {
      await this.coverStorage.delete(course.coverUrl);
    }
    return updated;
  }

  // Enrolled students for this course — paginated, searchable by
  // name/email/username. Never a full replace: see addStudents/removeStudent.
  async getEnrolledStudents(id: string, query: ListStudentsQueryDto) {
    await this.findOrThrow(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.CourseVisibilityWhereInput = {
      courseId: id,
      ...(search && {
        user: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { username: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.courseVisibility.count({ where }),
      this.prisma.courseVisibility.findMany({
        where,
        include: { user: { select: PAGINATED_STUDENT_SELECT } },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => ({ ...row.user, assignedAt: row.assignedAt })),
      total,
      page,
      limit,
    };
  }

  // STUDENT users who do NOT yet have access to this course.
  async getAvailableStudents(id: string, query: ListStudentsQueryDto) {
    await this.findOrThrow(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
      active: true,
      visibilities: { none: { courseId: id } },
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: PAGINATED_STUDENT_SELECT,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  // Grants access one at a time via createMany+skipDuplicates — this is the
  // fix for the destructive delete-all-then-recreate bug: adding students
  // here can never touch an existing enrollment row.
  async addStudents(id: string, dto: AddStudentsDto) {
    await this.findOrThrow(id);

    const students = await this.prisma.user.findMany({
      where: { id: { in: dto.userIds } },
      select: { id: true, role: true },
    });
    if (students.length !== dto.userIds.length) {
      throw new BadRequestException('One or more userIds do not exist');
    }
    if (students.some((student) => student.role !== Role.STUDENT)) {
      throw new BadRequestException(
        'Access can only be granted to users with the STUDENT role',
      );
    }

    await this.prisma.courseVisibility.createMany({
      data: dto.userIds.map((userId) => ({ courseId: id, userId })),
      skipDuplicates: true,
    });

    return { added: dto.userIds.length };
  }

  // Removes exactly one student's access — every other enrollment row for
  // this course is untouched.
  async removeStudent(id: string, userId: string) {
    await this.findOrThrow(id);
    await this.prisma.courseVisibility.deleteMany({
      where: { courseId: id, userId },
    });
    return { removed: true };
  }

  private async findOrThrow(id: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return course;
  }
}
