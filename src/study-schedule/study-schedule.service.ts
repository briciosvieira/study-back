import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from '../courses/courses.service';
import { ContentAccessService } from '../modules/content-access.service';
import { ModulesService } from '../modules/modules.service';
import { PrismaService } from '../prisma/prisma.service';
import { STUDY_SESSION_RETENTION_DAYS } from './study-recommendation.constants';
import { StudyRecommendationService } from './study-recommendation.service';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// A studyable unit for the "Iniciar sessão de estudo" picker and the
// recommendation cards — never the module/folder itself. QUIZ has no
// sub-items in the current schema (a QuizAttempt is already scoped to the
// whole module), so the module IS the resource there; PDF/VIDEO resolve
// down to the individual PdfItem/VideoItem.
export interface StudyResource {
  resourceType: 'PDF' | 'VIDEO' | 'QUIZ';
  resourceId: string;
  resourceTitle: string;
  moduleId: string;
  moduleTitle: string;
}

@Injectable()
export class StudyScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly contentAccess: ContentAccessService,
    private readonly modulesService: ModulesService,
    private readonly recommendationService: StudyRecommendationService,
  ) {}

  // Everything selectable in the "Iniciar sessão de estudo" dialog — reuses
  // ModulesService.findAllForCourse for the exact same access/visibility
  // rules already enforced everywhere else (course access check + hides
  // non-visible modules from students), instead of re-querying modules here.
  async listStudyResources(courseId: string, user: AuthenticatedUser): Promise<StudyResource[]> {
    const modules = await this.modulesService.findAllForCourse(courseId, user);
    const moduleById = new Map(modules.map((m) => [m.id, m]));

    const pdfModuleIds = modules.filter((m) => m.type === ModuleType.PDF).map((m) => m.id);
    const videoModuleIds = modules.filter((m) => m.type === ModuleType.VIDEO).map((m) => m.id);

    const [pdfItems, videoItems] = await Promise.all([
      pdfModuleIds.length
        ? this.prisma.pdfItem.findMany({
            where: { moduleId: { in: pdfModuleIds } },
            orderBy: { orderNum: 'asc' },
          })
        : Promise.resolve([]),
      videoModuleIds.length
        ? this.prisma.videoItem.findMany({
            where: { moduleId: { in: videoModuleIds } },
            orderBy: { orderNum: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const resources: StudyResource[] = [];

    for (const item of pdfItems) {
      const mod = moduleById.get(item.moduleId);
      if (!mod) continue;
      resources.push({
        resourceType: 'PDF',
        resourceId: item.id,
        resourceTitle: item.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }

    for (const mod of modules) {
      if (mod.type !== ModuleType.QUIZ) continue;
      resources.push({
        resourceType: 'QUIZ',
        resourceId: mod.id,
        resourceTitle: mod.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }

    for (const item of videoItems) {
      const mod = moduleById.get(item.moduleId);
      if (!mod) continue;
      resources.push({
        resourceType: 'VIDEO',
        resourceId: item.id,
        resourceTitle: item.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }

    return resources;
  }

  async getSchedule(courseId: string, user: AuthenticatedUser) {
    // throws NotFoundException if the course doesn't exist or isn't visible to this user
    await this.coursesService.findOne(courseId, user);

    // Sessions are strictly individual: scoped to userId from the JWT, never a
    // param — one active session per user, across all courses, not per-course.
    const activeSession = await this.prisma.studySession.findFirst({
      where: { userId: user.id, status: 'IN_PROGRESS' },
      include: {
        module: { select: { id: true, title: true, type: true } },
        course: { select: { id: true, title: true } },
        pdfItem: { select: { title: true } },
        videoItem: { select: { title: true } },
      },
    });

    const windowStart = new Date(Date.now() - STUDY_SESSION_RETENTION_DAYS * MS_PER_DAY);
    const completedSessions = await this.prisma.studySession.findMany({
      where: {
        userId: user.id,
        courseId,
        status: 'COMPLETED',
        endedAt: { gte: windowStart },
      },
      include: {
        module: { select: { id: true, title: true, type: true } },
        pdfItem: { select: { title: true } },
        videoItem: { select: { title: true } },
      },
      orderBy: { endedAt: 'desc' },
    });

    const todayKey = new Date().toISOString().slice(0, 10);
    const totalSecondsToday = completedSessions
      .filter((s) => s.endedAt && s.endedAt.toISOString().slice(0, 10) === todayKey)
      .reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);

    const summary = {
      totalSecondsLast14Days: completedSessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
      sessionsCountLast14Days: completedSessions.length,
      modulesStudiedLast14Days: new Set(completedSessions.map((s) => s.moduleId)).size,
      totalSecondsToday,
    };

    const recommendations = await this.recommendationService.getRecommendations(courseId, user.id);

    return {
      activeSession: activeSession
        ? {
            id: activeSession.id,
            moduleId: activeSession.moduleId,
            moduleTitle: activeSession.module.title,
            moduleType: activeSession.module.type,
            courseId: activeSession.courseId,
            courseTitle: activeSession.course.title,
            startedAt: activeSession.startedAt,
            ...this.resolveSessionResource(activeSession),
          }
        : null,
      summary,
      history: this.groupByDay(completedSessions),
      recommendations,
    };
  }

  async startSession(
    courseId: string,
    moduleId: string,
    user: AuthenticatedUser,
    pdfItemId?: string,
    videoItemId?: string,
  ) {
    await this.coursesService.findOne(courseId, user);
    const targetModule = await this.contentAccess.getAccessibleModule(moduleId, user);
    if (targetModule.courseId !== courseId) {
      throw new BadRequestException('Module does not belong to the given course');
    }

    // The resource id (when given) must actually belong to this module — an
    // id from a different module/course must never be trusted from the client.
    if (pdfItemId) {
      const pdfItem = await this.prisma.pdfItem.findUnique({ where: { id: pdfItemId } });
      if (!pdfItem || pdfItem.moduleId !== moduleId) {
        throw new BadRequestException('pdfItemId does not belong to the given module');
      }
    }
    if (videoItemId) {
      const videoItem = await this.prisma.videoItem.findUnique({ where: { id: videoItemId } });
      if (!videoItem || videoItem.moduleId !== moduleId) {
        throw new BadRequestException('videoItemId does not belong to the given module');
      }
    }

    const existing = await this.prisma.studySession.findFirst({
      where: { userId: user.id, status: 'IN_PROGRESS' },
    });
    if (existing) {
      // The frontend already has (or can refetch) the active session's id via
      // GET .../study-schedule, so this only needs to carry a clear message —
      // the shared HttpExceptionFilter only ever surfaces `.message` anyway.
      throw new ConflictException(
        'You already have an active study session — finish it before starting a new one',
      );
    }

    return this.prisma.studySession.create({
      data: {
        userId: user.id,
        courseId,
        moduleId,
        pdfItemId: pdfItemId ?? null,
        videoItemId: videoItemId ?? null,
        startedAt: new Date(),
        status: 'IN_PROGRESS',
      },
    });
  }

  async finishSession(sessionId: string, user: AuthenticatedUser) {
    const session = await this.prisma.studySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Study session not found');
    }
    if (session.userId !== user.id) {
      throw new ForbiddenException("You cannot modify another user's study session");
    }
    if (session.status !== 'IN_PROGRESS') {
      // finishing twice is a no-op that returns the already-completed session,
      // rather than erroring on a duplicate/late click
      return session;
    }

    const endedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    );

    return this.prisma.studySession.update({
      where: { id: sessionId },
      data: { endedAt, durationSeconds, status: 'COMPLETED' },
    });
  }

  // Old sessions have neither pdfItem nor videoItem (moduleId-only, per the
  // backward-compatibility requirement) — resourceTitle/resourceType then
  // just fall back to the module itself, exactly like before this fix.
  private resolveSessionResource(session: {
    module: { type: string; title: string };
    pdfItem: { title: string } | null;
    videoItem: { title: string } | null;
  }) {
    if (session.pdfItem) {
      return { resourceType: 'PDF' as const, resourceTitle: session.pdfItem.title };
    }
    if (session.videoItem) {
      return { resourceType: 'VIDEO' as const, resourceTitle: session.videoItem.title };
    }
    if (session.module.type === 'QUIZ') {
      return { resourceType: 'QUIZ' as const, resourceTitle: session.module.title };
    }
    return { resourceType: null, resourceTitle: session.module.title };
  }

  private groupByDay(
    sessions: Array<{
      id: string;
      moduleId: string;
      module: { title: string; type: string };
      pdfItem: { title: string } | null;
      videoItem: { title: string } | null;
      startedAt: Date;
      endedAt: Date | null;
      durationSeconds: number | null;
    }>,
  ) {
    const byDay = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const key = (session.endedAt ?? session.startedAt).toISOString().slice(0, 10);
      const bucket = byDay.get(key) ?? [];
      bucket.push(session);
      byDay.set(key, bucket);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, daySessions]) => ({
        date,
        totalSeconds: daySessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
        sessions: daySessions.map((s) => ({
          id: s.id,
          moduleId: s.moduleId,
          moduleTitle: s.module.title,
          moduleType: s.module.type,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationSeconds: s.durationSeconds,
          ...this.resolveSessionResource(s),
        })),
      }));
  }
}
