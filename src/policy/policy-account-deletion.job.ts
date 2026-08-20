import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PolicyAcceptanceStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountDeletionService } from './account-deletion.service';

// Hourly — this doesn't need minute-level precision, and running it more
// often just adds load for no benefit (see spec: "não precisa rodar a cada
// minuto"). Never deletes an ADMIN account on its own: an expired rejection
// for an admin only raises ADMIN_DELETION_REQUESTED so another admin can
// act deliberately via the reauth-protected manual deletion flow.
@Injectable()
export class PolicyAccountDeletionJob {
  private readonly logger = new Logger(PolicyAccountDeletionJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const candidates = await this.prisma.userPolicyAcceptance.findMany({
      where: {
        status: PolicyAcceptanceStatus.REJECTED,
        deletionPausedAt: null,
        scheduledDeletionAt: { lte: new Date() },
      },
      include: { user: true },
    });

    let deletedCount = 0;
    let adminFlaggedCount = 0;

    for (const candidate of candidates) {
      // Re-checked immediately before acting — narrows (an hourly batch job
      // can't fully eliminate without raw row-level locking) the window
      // where a user accepts at almost the exact moment the job runs.
      const fresh = await this.prisma.userPolicyAcceptance.findUnique({
        where: { id: candidate.id },
      });
      if (
        !fresh ||
        fresh.status !== PolicyAcceptanceStatus.REJECTED ||
        fresh.deletionPausedAt ||
        !fresh.scheduledDeletionAt ||
        fresh.scheduledDeletionAt.getTime() > Date.now()
      ) {
        continue;
      }

      const { user } = candidate;
      if (!user.active) continue; // isActive keeps absolute priority even here — an inactive user's countdown should already be paused

      if (user.role === Role.ADMIN) {
        const alreadyFlagged = await this.prisma.auditEvent.findFirst({
          where: {
            eventType: 'ADMIN_DELETION_REQUESTED',
            targetUserId: user.id,
            createdAt: { gte: fresh.rejectedAt ?? fresh.updatedAt },
          },
        });
        if (alreadyFlagged) continue; // already raised for this rejection episode — idempotent

        await this.auditService.record({
          eventType: 'ADMIN_DELETION_REQUESTED',
          category: 'POLICY',
          severity: 'HIGH',
          targetUserId: user.id,
          targetName: user.name,
          metadata: { scheduledDeletionAt: fresh.scheduledDeletionAt.toISOString() },
        });
        adminFlaggedCount++;
        continue;
      }

      await this.accountDeletionService.deletePermanently(
        user.id,
        'POLICY_REJECTION',
        'USER_DELETED_POLICY_EXPIRED',
        null,
        'System',
      );
      deletedCount++;
    }

    if (deletedCount > 0 || adminFlaggedCount > 0) {
      this.logger.log(
        `Policy account deletion job completed: ${deletedCount} account(s) deleted, ${adminFlaggedCount} admin account(s) flagged for manual review.`,
      );
    }
  }

  // Consolidated-account review holds NEVER auto-delete — this only detects
  // when a hold's window has passed with no admin decision yet, so it shows
  // up in the audit trail. accessState itself is derived live from
  // policyReviewUntil (see AccountAccessService), so no stored field needs
  // to change here — this is purely a one-time visibility event per episode.
  @Cron(CronExpression.EVERY_HOUR)
  async flagExpiredReviewHolds(): Promise<void> {
    const candidates = await this.prisma.userPolicyAcceptance.findMany({
      where: {
        policyReviewUntil: { lte: new Date() },
        reactivationRequestedAt: null,
      },
      include: { user: { select: { id: true, name: true, active: true } } },
    });

    let flaggedCount = 0;

    for (const candidate of candidates) {
      if (!candidate.user.active) continue; // isActive keeps absolute priority

      const alreadyFlagged = await this.prisma.auditEvent.findFirst({
        where: {
          eventType: 'POLICY_REVIEW_PERIOD_EXPIRED',
          targetUserId: candidate.userId,
          createdAt: { gte: candidate.policyReviewStartedAt ?? candidate.updatedAt },
        },
      });
      if (alreadyFlagged) continue; // already raised for this review episode — idempotent

      await this.auditService.record({
        eventType: 'POLICY_REVIEW_PERIOD_EXPIRED',
        category: 'POLICY',
        severity: 'WARNING',
        targetUserId: candidate.user.id,
        targetName: candidate.user.name,
      });
      flaggedCount++;
    }

    if (flaggedCount > 0) {
      this.logger.log(
        `Policy review hold expiry check: ${flaggedCount} account(s) flagged as PENDING_ADMIN_DECISION.`,
      );
    }
  }
}
