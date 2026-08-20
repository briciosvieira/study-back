import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from '../courses/courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { SetModuleVisibilityDto } from './dto/set-module-visibility.dto';
import { UpdateModuleDto } from './dto/update-module.dto';

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly auditService: AuditService,
  ) {}

  async findAllForCourse(courseId: string, user: AuthenticatedUser) {
    // throws NotFoundException if the course doesn't exist or isn't visible to the student
    await this.coursesService.findOne(courseId, user);

    return this.prisma.module.findMany({
      where: {
        courseId,
        ...(user.role === Role.STUDENT ? { visible: true } : {}),
      },
      orderBy: { order: 'asc' },
    });
  }

  async create(courseId: string, dto: CreateModuleDto, actor: AuthenticatedUser) {
    await this.findCourseOrThrow(courseId);
    const created = await this.prisma.module.create({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        coverUrl: dto.coverUrl,
        studyPriority: dto.studyPriority,
      },
    });
    await this.auditService.record({
      eventType: 'RESOURCE_CREATED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'MODULE',
      resourceId: created.id,
      metadata: { moduleType: created.type },
    });
    return created;
  }

  async update(id: string, dto: UpdateModuleDto) {
    await this.findOrThrow(id);
    return this.prisma.module.update({
      where: { id },
      data: {
        type: dto.type,
        title: dto.title,
        coverUrl: dto.coverUrl,
        order: dto.order,
        studyPriority: dto.studyPriority,
      },
    });
  }

  async remove(id: string, actor: AuthenticatedUser) {
    await this.findOrThrow(id);
    await this.prisma.module.delete({ where: { id } });
    await this.auditService.record({
      eventType: 'RESOURCE_DELETED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'MODULE',
      resourceId: id,
    });
    return { deleted: true };
  }

  async setVisibility(id: string, dto: SetModuleVisibilityDto) {
    await this.findOrThrow(id);
    return this.prisma.module.update({
      where: { id },
      data: { visible: dto.visible },
    });
  }

  private async findOrThrow(id: string) {
    const existingModule = await this.prisma.module.findUnique({
      where: { id },
    });
    if (!existingModule) {
      throw new NotFoundException('Module not found');
    }
    return existingModule;
  }

  private async findCourseOrThrow(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return course;
  }
}
