import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

// Shared by PDF, video and quiz: a student can only reach a module's content
// when BOTH layers hold — the course is shared with them (CourseVisibility)
// AND the module itself is marked visible.
@Injectable()
export class ContentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccessibleModule(moduleId: string, user: AuthenticatedUser) {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    if (user.role === Role.STUDENT) {
      if (!module.visible || !module.course.active) {
        throw new NotFoundException('Module not found');
      }
      const visibility = await this.prisma.courseVisibility.findUnique({
        where: {
          courseId_userId: { courseId: module.courseId, userId: user.id },
        },
      });
      if (!visibility) {
        throw new NotFoundException('Module not found');
      }
    }

    return module;
  }
}
