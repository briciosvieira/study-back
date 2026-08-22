import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from '../courses/courses.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StudyTreeNodeView, StudyTreeView } from './study-tree.types';

const CHECK_DURATION_MS = 5 * 24 * 60 * 60 * 1000; // 5 days, always from the server clock

// Domain logic for the shared tree + the caller's own check state. Never
// duplicates the tree per user (StudyTreeNode is fetched once and reused for
// everyone — see getTreeForUser) and never keeps a checkbox's history (see
// checkNode/uncheckNode: INSERT/UPSERT and DELETE, nothing in between).
@Injectable()
export class StudyTreeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly auditService: AuditService,
  ) {}

  async getTreeForUser(courseId: string, user: AuthenticatedUser): Promise<StudyTreeView | null> {
    await this.coursesService.findOne(courseId, user);

    const tree = await this.prisma.studyTree.findUnique({
      where: { courseId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!tree) return null;

    const nodes = await this.prisma.studyTreeNode.findMany({
      where: { treeId: tree.id },
      orderBy: { order: 'asc' },
    });

    // A check past its expiry is never treated as active, even if the hourly
    // cleanup job hasn't run yet — see spec section 33. Best-effort removal
    // of this user's own expired rows piggybacks on this same request; it's
    // never required for correctness (the query below already excludes them).
    const now = new Date();
    void this.prisma.userTreeCheck
      .deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } })
      .catch(() => undefined);

    const leafNodeIds = nodes.filter((n) => !nodes.some((c) => c.parentId === n.id)).map((n) => n.id);
    const activeChecks = leafNodeIds.length
      ? await this.prisma.userTreeCheck.findMany({
          where: { userId: user.id, nodeId: { in: leafNodeIds }, expiresAt: { gt: now } },
        })
      : [];
    const checkByNodeId = new Map(activeChecks.map((c) => [c.nodeId, c]));

    const childrenByParent = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const bucket = childrenByParent.get(node.parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    }

    const buildView = (node: (typeof nodes)[number]): StudyTreeNodeView => {
      const children = childrenByParent.get(node.id) ?? [];
      if (children.length === 0) {
        const check = checkByNodeId.get(node.id);
        return {
          id: node.id,
          title: node.title,
          order: node.order,
          isLeaf: true,
          checked: !!check,
          checkedAt: check ? check.checkedAt.toISOString() : null,
          expiresAt: check ? check.expiresAt.toISOString() : null,
        };
      }
      return {
        id: node.id,
        title: node.title,
        order: node.order,
        isLeaf: false,
        children: children.map(buildView),
      };
    };

    const roots = childrenByParent.get(null) ?? [];

    return {
      id: tree.id,
      createdAt: tree.createdAt.toISOString(),
      createdBy: tree.createdBy ? { id: tree.createdBy.id, name: tree.createdBy.name } : null,
      nodeCount: nodes.length,
      roots: roots.map(buildView),
    };
  }

  async deleteTree(courseId: string, actor: AuthenticatedUser): Promise<void> {
    await this.coursesService.findOne(courseId, actor);

    const tree = await this.prisma.studyTree.findUnique({
      where: { courseId },
      include: { course: { select: { title: true } }, _count: { select: { nodes: true } } },
    });
    if (!tree) {
      throw new NotFoundException('Este curso não possui uma Árvore de Estudos.');
    }

    // Captured before the cascade delete removes the nodes — see spec
    // section 80 (audit must capture nodeCount before the rows are gone).
    const nodeCount = tree._count.nodes;

    await this.prisma.studyTree.delete({ where: { id: tree.id } });

    await this.auditService.record({
      eventType: 'STUDY_TREE_DELETED',
      category: 'CONTENT',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      resourceType: 'STUDY_TREE',
      resourceId: tree.id,
      metadata: { courseId, courseTitle: tree.course.title, nodeCount },
    });
  }

  async checkNode(courseId: string, nodeId: string, user: AuthenticatedUser) {
    await this.coursesService.findOne(courseId, user);
    const node = await this.getNodeForCourseOrThrow(courseId, nodeId);

    const hasChildren = await this.prisma.studyTreeNode.count({ where: { parentId: node.id } });
    if (hasChildren > 0) {
      throw new BadRequestException(
        'Não é possível marcar um item que possui subtópicos — apenas o item final da cadeia pode ser marcado.',
      );
    }

    const checkedAt = new Date();
    const expiresAt = new Date(checkedAt.getTime() + CHECK_DURATION_MS);

    // Idempotent by design: marking an already-checked leaf again just
    // refreshes its 5-day window instead of erroring or duplicating —
    // userId+nodeId is unique, so this can never create a second row.
    const check = await this.prisma.userTreeCheck.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId: node.id } },
      update: { checkedAt, expiresAt },
      create: { userId: user.id, nodeId: node.id, checkedAt, expiresAt },
    });

    return {
      checked: true,
      checkedAt: check.checkedAt.toISOString(),
      expiresAt: check.expiresAt.toISOString(),
    };
  }

  async uncheckNode(courseId: string, nodeId: string, user: AuthenticatedUser) {
    await this.coursesService.findOne(courseId, user);
    await this.getNodeForCourseOrThrow(courseId, nodeId);

    // Idempotent: deleting a check that doesn't exist is not an error — see
    // spec section 31.
    await this.prisma.userTreeCheck.deleteMany({ where: { userId: user.id, nodeId } });

    return { checked: false };
  }

  private async getNodeForCourseOrThrow(courseId: string, nodeId: string) {
    const node = await this.prisma.studyTreeNode.findUnique({
      where: { id: nodeId },
      include: { tree: { select: { courseId: true } } },
    });
    // Same "not found" whether the node truly doesn't exist or it belongs to
    // a different course — never leaks which case it was (see spec section 59).
    if (!node || node.tree.courseId !== courseId) {
      throw new NotFoundException('Node not found');
    }
    return node;
  }
}
