import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { maskEmail, normalizeEmail } from '../common/utils/normalize-email.util';
import { EmailEligibilityService } from '../blocklist/email-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export type DeletionReason = 'POLICY_REJECTION' | 'ADMIN_DELETION' | 'USER_DELETION_REQUEST';

// The single, shared path for permanently deleting an account — used by the
// automatic policy-expiry job and by the admin-initiated (reauth-protected,
// cross-admin) manual deletion flow. Never called directly from a
// controller: the caller is responsible for deciding *whether* this
// particular deletion is authorized (last-admin checks, reauth, etc.)
// before calling in.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailEligibilityService: EmailEligibilityService,
    private readonly storageService: StorageService,
  ) {}

  async deletePermanently(
    targetUserId: string,
    reason: DeletionReason,
    eventType: 'USER_DELETED_POLICY_EXPIRED' | 'USER_DELETED',
    actorUserId: string | null,
    actorName: string | null,
  ): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return; // already gone — idempotent no-op, matters for job re-runs

    // Checked before the transaction — the acceptance row cascade-deletes
    // with the user, so this is the last point it's readable. Used only to
    // decide whether to also log POLICY_REVIEW_ACCOUNT_DELETED below; never
    // blocks the deletion itself (an ADMIN may delete a consolidated account
    // mid-review-hold without waiting out the window — see section 23).
    const activeReviewHold = await this.prisma.userPolicyAcceptance.findFirst({
      where: { userId: targetUserId, policyReviewUntil: { not: null } },
    });

    const snapshot = {
      historicalUserId: target.id,
      displayName: target.name,
      maskedEmail: maskEmail(normalizeEmail(target.email)),
      role: target.role,
    };

    // Best-effort avatar cleanup before the row disappears — a storage
    // failure here must never block the deletion itself; an orphaned R2
    // object is a far smaller problem than an account stuck undeletable.
    if (target.avatarStorageKey) {
      try {
        await this.storageService.delete(target.avatarStorageKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete avatar for user ${target.id} during account deletion: ${(error as Error).message}`,
        );
      }
    }

    const emailHash = this.emailEligibilityService.hashEmail(target.email);

    // Row deletion and blocklist insertion happen atomically — either both
    // succeed or neither does, so the email can never end up available for
    // reuse while the fact that this account existed is otherwise recorded.
    // Content the user created (courses, templates) survives via the
    // nullable/SetNull FK on those models; QuizAttempt/StudySession/
    // CourseVisibility are the user's own data and cascade-delete with them.
    await this.prisma.$transaction([
      this.prisma.auditNotification.deleteMany({ where: { userId: target.id } }),
      this.prisma.emailBlocklist.upsert({
        where: { emailHash },
        update: { removedAt: null, removedById: null, reason },
        create: { emailHash, maskedEmail: snapshot.maskedEmail, reason },
      }),
      this.prisma.user.delete({ where: { id: target.id } }),
    ]);

    await this.auditService.record({
      eventType,
      category: 'POLICY',
      severity: 'WARNING',
      actorUserId,
      actorName,
      targetUserId: snapshot.historicalUserId,
      targetName: snapshot.displayName,
      targetEmailMasked: snapshot.maskedEmail,
      metadata: { reason, role: snapshot.role },
    });

    if (activeReviewHold) {
      await this.auditService.record({
        eventType: 'POLICY_REVIEW_ACCOUNT_DELETED',
        category: 'POLICY',
        severity: 'HIGH',
        actorUserId,
        actorName,
        targetUserId: snapshot.historicalUserId,
        targetName: snapshot.displayName,
        targetEmailMasked: snapshot.maskedEmail,
        metadata: { reason },
      });
    }
  }
}
