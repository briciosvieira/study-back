import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CourseCoverStorageService } from './course-cover-storage.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

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
    // staff also gets the current visibility list — the frontend needs it
    // to pre-check students in the visibility modal without a second round trip
    const isStaff = user.role === Role.ADMIN || user.role === Role.INSTRUCTOR;
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: isStaff
        ? { visibilities: { select: { userId: true } } }
        : undefined,
    });
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

  async setVisibility(id: string, dto: SetVisibilityDto) {
    await this.findOrThrow(id);

    if (dto.studentIds.length > 0) {
      const students = await this.prisma.user.findMany({
        where: { id: { in: dto.studentIds } },
        select: { id: true, role: true },
      });
      if (students.length !== dto.studentIds.length) {
        throw new BadRequestException('One or more studentIds do not exist');
      }
      if (students.some((student) => student.role !== Role.STUDENT)) {
        throw new BadRequestException(
          'Visibility can only be granted to users with the STUDENT role',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.courseVisibility.deleteMany({ where: { courseId: id } }),
      this.prisma.courseVisibility.createMany({
        data: dto.studentIds.map((userId) => ({ courseId: id, userId })),
      }),
    ]);

    return this.prisma.courseVisibility.findMany({ where: { courseId: id } });
  }

  private async findOrThrow(id: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return course;
  }
}
