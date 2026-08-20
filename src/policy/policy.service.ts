import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PolicyAcceptanceStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { markAudited } from '../audit/audited-exception.util';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityIncidentService } from '../security/security-incident.service';
import { AccountAccessService, type AccountAccessState } from './account-access.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class PolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountAccessService: AccountAccessService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly securityIncidentService: SecurityIncidentService,
  ) {}

  getActivePolicyVersion() {
    return this.prisma.policyVersion.findFirst({ where: { isActive: true } });
  }

  private reconsiderationDays(): number {
    return this.configService.get<number>('policy.reconsiderationDays')!;
  }

  private establishedAccountDays(): number {
    return this.configService.get<number>('policy.establishedAccountDays')!;
  }

  private reviewHoldDays(): number {
    return this.configService.get<number>('policy.reviewHoldDays')!;
  }

  // Exposed to the frontend so it can display the exact date an account
  // would be scheduled for deletion *before* the user commits to an
  // irreversible reject/revoke action — never hardcode this on the client.
  getReconsiderationDays(): number {
    return this.reconsiderationDays();
  }

  getReviewHoldDays(): number {
    return this.reviewHoldDays();
  }

  // "Consolidated" per the complementary spec: an account this old never
  // enters the short auto-delete flow on rejection, only an administrative
  // review hold. Exposed publicly so the frontend can show the *correct*
  // warning copy in the revoke-confirmation dialog before the user commits —
  // it must never guess this client-side.
  async isEstablishedAccount(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user) return false;
    const ageMs = Date.now() - user.createdAt.getTime();
    return ageMs >= this.establishedAccountDays() * MS_PER_DAY;
  }

  async resolveAccessState(userId: string, active: boolean): Promise<AccountAccessState> {
    const [activeVersion, acceptance] = await Promise.all([
      this.getActivePolicyVersion(),
      this.prisma.userPolicyAcceptance.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return this.accountAccessService.resolve({
      active,
      acceptance: acceptance
        ? {
            status: acceptance.status,
            policyVersionId: acceptance.policyVersionId,
            scheduledDeletionAt: acceptance.scheduledDeletionAt,
            deletionPausedAt: acceptance.deletionPausedAt,
            policyReviewUntil: acceptance.policyReviewUntil,
            reactivationRequestedAt: acceptance.reactivationRequestedAt,
          }
        : null,
      activePolicyVersionId: activeVersion?.id ?? null,
      requiresReacceptance: activeVersion?.requiresReacceptance ?? false,
    });
  }

  // What the "Meu Perfil" / first-access modal reads: the currently active
  // version's text plus this user's decision on it specifically (a decision
  // recorded against an older, superseded version doesn't count here).
  async getCurrentPolicyForUser(userId: string) {
    const policyVersion = await this.getActivePolicyVersion();
    if (!policyVersion) return { policyVersion: null, acceptance: null };

    const acceptance = await this.prisma.userPolicyAcceptance.findUnique({
      where: { userId_policyVersionId: { userId, policyVersionId: policyVersion.id } },
    });

    return { policyVersion, acceptance };
  }

  // Admin-facing: the user's latest decision regardless of which version it
  // was made against (an admin should see "REJECTED, deadline X" even if a
  // newer policy version has since been published).
  async getUserPolicyStatusForAdmin(userId: string) {
    const [policyVersion, acceptance] = await Promise.all([
      this.getActivePolicyVersion(),
      this.prisma.userPolicyAcceptance.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: { policyVersion: { select: { version: true, title: true } } },
      }),
    ]);
    return { currentPolicyVersion: policyVersion, acceptance };
  }

  async accept(user: AuthenticatedUser) {
    if (!user.active) {
      throw markAudited(new ForbiddenException('ACCOUNT_INACTIVE'));
    }

    const policyVersion = await this.getActivePolicyVersion();
    if (!policyVersion) {
      throw new BadRequestException('No active policy to accept');
    }

    const existing = await this.prisma.userPolicyAcceptance.findUnique({
      where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
    });

    // Consolidated-account review hold: re-accepting never restores access
    // by itself, regardless of how much of the review window is left — it
    // only records a reactivation request for an admin (or
    // MANAGE_POLICY_REACTIVATION holder) to decide on.
    if (existing?.policyReviewUntil) {
      return this.requestReactivation(user, policyVersion, existing);
    }

    // A deadline that has already passed is no longer "recoverable" — the
    // account is awaiting the deletion job (or, for an admin, awaiting
    // another admin's manual intervention), and self-accept can't undo that.
    if (
      existing?.status === PolicyAcceptanceStatus.REJECTED &&
      !existing.deletionPausedAt &&
      existing.scheduledDeletionAt &&
      existing.scheduledDeletionAt.getTime() <= Date.now()
    ) {
      throw markAudited(new ForbiddenException('DELETION_PENDING_EXECUTION'));
    }

    const wasRejected = existing?.status === PolicyAcceptanceStatus.REJECTED;

    const acceptance = await this.prisma.userPolicyAcceptance.upsert({
      where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
      update: {
        status: PolicyAcceptanceStatus.ACCEPTED,
        acceptedAt: new Date(),
        rejectedAt: null,
        scheduledDeletionAt: null,
        deletionPausedAt: null,
        deletionRemainingSeconds: null,
      },
      create: {
        userId: user.id,
        policyVersionId: policyVersion.id,
        status: PolicyAcceptanceStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    await this.auditService.record({
      eventType: 'POLICY_ACCEPTED',
      category: 'POLICY',
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
      metadata: { policyVersion: policyVersion.version },
    });
    if (wasRejected) {
      await this.auditService.record({
        eventType: 'POLICY_DELETION_CANCELLED',
        category: 'POLICY',
        severity: 'INFO',
        actorUserId: user.id,
        actorName: user.name,
      });
    }

    return { policyVersion, acceptance };
  }

  // First rejection of the currently presented policy (PENDING -> REJECTED).
  async reject(user: AuthenticatedUser) {
    return this.transitionToRejected(user, 'POLICY_REJECTED', null);
  }

  // Withdrawal from the Profile page (ACCEPTED -> REJECTED) — same deadline
  // mechanics as reject(), different starting precondition and audit trail.
  async revokeAcceptance(user: AuthenticatedUser) {
    if (!user.active) {
      throw markAudited(new ForbiddenException('ACCOUNT_INACTIVE'));
    }
    const policyVersion = await this.getActivePolicyVersion();
    if (!policyVersion) {
      throw new BadRequestException('No active policy to revoke');
    }
    const existing = await this.prisma.userPolicyAcceptance.findUnique({
      where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
    });
    if (existing?.status !== PolicyAcceptanceStatus.ACCEPTED) {
      throw new BadRequestException('Policy has not been accepted, nothing to revoke');
    }

    return this.transitionToRejected(user, 'POLICY_ACCEPTANCE_REVOKED', 'USER_DELETION_REQUESTED');
  }

  // Modal closed via the X — no decision, no deadline, just a record that it
  // was shown and dismissed.
  async dismissModal(user: AuthenticatedUser): Promise<void> {
    await this.auditService.record({
      eventType: 'POLICY_MODAL_DISMISSED',
      category: 'POLICY',
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
    });
  }

  private async transitionToRejected(
    user: AuthenticatedUser,
    primaryEvent: 'POLICY_REJECTED' | 'POLICY_ACCEPTANCE_REVOKED',
    secondaryEvent: 'USER_DELETION_REQUESTED' | null,
  ) {
    const policyVersion = await this.getActivePolicyVersion();
    if (!policyVersion) {
      throw new BadRequestException('No active policy');
    }

    const existing = await this.prisma.userPolicyAcceptance.findUnique({
      where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
    });

    // Idempotent: rejecting/revoking again must never push either deadline
    // forward — the first decision is the one that counts. A REJECTED status
    // covers the short-flow (and a review hold reached via reject()); the
    // policyReviewUntil check separately catches REACTIVATION_REQUESTED,
    // whose status is ACCEPTED, not REJECTED.
    if (existing?.status === PolicyAcceptanceStatus.REJECTED) {
      return { policyVersion, acceptance: existing };
    }
    if (existing?.policyReviewUntil) {
      return { policyVersion, acceptance: existing };
    }

    const rejectedAt = new Date();
    const established = await this.isEstablishedAccount(user.id);

    if (established) {
      const policyReviewUntil = new Date(rejectedAt.getTime() + this.reviewHoldDays() * MS_PER_DAY);

      const acceptance = await this.prisma.userPolicyAcceptance.upsert({
        where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
        update: {
          status: PolicyAcceptanceStatus.REJECTED,
          rejectedAt,
          acceptedAt: null,
          scheduledDeletionAt: null,
          deletionPausedAt: null,
          deletionRemainingSeconds: null,
          policyReviewStartedAt: rejectedAt,
          policyReviewUntil,
          reactivationRequestedAt: null,
          reactivatedAt: null,
        },
        create: {
          userId: user.id,
          policyVersionId: policyVersion.id,
          status: PolicyAcceptanceStatus.REJECTED,
          rejectedAt,
          policyReviewStartedAt: rejectedAt,
          policyReviewUntil,
        },
      });

      await this.auditService.record({
        eventType: primaryEvent,
        category: 'POLICY',
        severity: 'INFO',
        actorUserId: user.id,
        actorName: user.name,
        metadata: { policyReviewUntil: policyReviewUntil.toISOString(), establishedAccount: true },
      });
      await this.auditService.record({
        eventType: 'POLICY_REVIEW_HOLD_STARTED',
        category: 'POLICY',
        severity: 'WARNING',
        actorUserId: user.id,
        actorName: user.name,
        metadata: { policyReviewUntil: policyReviewUntil.toISOString() },
      });
      if (secondaryEvent) {
        await this.auditService.record({
          eventType: secondaryEvent,
          category: 'POLICY',
          severity: 'WARNING',
          actorUserId: user.id,
          actorName: user.name,
        });
      }

      return { policyVersion, acceptance };
    }

    const scheduledDeletionAt = new Date(
      rejectedAt.getTime() + this.reconsiderationDays() * MS_PER_DAY,
    );

    const acceptance = await this.prisma.userPolicyAcceptance.upsert({
      where: { userId_policyVersionId: { userId: user.id, policyVersionId: policyVersion.id } },
      update: {
        status: PolicyAcceptanceStatus.REJECTED,
        rejectedAt,
        scheduledDeletionAt,
        acceptedAt: null,
        deletionPausedAt: null,
        deletionRemainingSeconds: null,
      },
      create: {
        userId: user.id,
        policyVersionId: policyVersion.id,
        status: PolicyAcceptanceStatus.REJECTED,
        rejectedAt,
        scheduledDeletionAt,
      },
    });

    await this.auditService.record({
      eventType: primaryEvent,
      category: 'POLICY',
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
      metadata: { scheduledDeletionAt: scheduledDeletionAt.toISOString() },
    });
    await this.auditService.record({
      eventType: 'POLICY_DELETION_SCHEDULED',
      category: 'POLICY',
      severity: 'WARNING',
      actorUserId: user.id,
      actorName: user.name,
      metadata: { scheduledDeletionAt: scheduledDeletionAt.toISOString() },
    });
    if (secondaryEvent) {
      await this.auditService.record({
        eventType: secondaryEvent,
        category: 'POLICY',
        severity: 'WARNING',
        actorUserId: user.id,
        actorName: user.name,
      });
    }

    return { policyVersion, acceptance };
  }

  // Re-accepting during a consolidated-account review hold never restores
  // access by itself (section 10 of the review-hold spec) — it only records
  // the request for an admin/authorized reviewer to act on.
  private async requestReactivation(
    user: AuthenticatedUser,
    policyVersion: { id: string },
    existing: { id: string; reactivationRequestedAt: Date | null },
  ) {
    if (existing.reactivationRequestedAt) {
      // Idempotent: a request is already pending, don't reset its timestamp.
      const acceptance = await this.prisma.userPolicyAcceptance.findUniqueOrThrow({
        where: { id: existing.id },
      });
      return { policyVersion, acceptance };
    }

    const acceptance = await this.prisma.userPolicyAcceptance.update({
      where: { id: existing.id },
      data: {
        status: PolicyAcceptanceStatus.ACCEPTED,
        acceptedAt: new Date(),
        reactivationRequestedAt: new Date(),
      },
    });

    await this.auditService.record({
      eventType: 'POLICY_REACTIVATION_REQUESTED',
      category: 'POLICY',
      severity: 'WARNING',
      actorUserId: user.id,
      actorName: user.name,
    });
    // Surfaces the request on the notification bell for ADMIN + delegated
    // MANAGE_POLICY_REACTIVATION holders — WARNING severity, so it never
    // triggers the red/pulsing HIGH-CRITICAL treatment for a routine request.
    void this.securityIncidentService.recordReactivationRequested(user.id);

    return { policyVersion, acceptance };
  }

  // Accounts currently under a consolidated review hold, regardless of which
  // sub-state they're in (POLICY_REVIEW_HOLD / REACTIVATION_REQUESTED /
  // PENDING_ADMIN_DECISION) — the queue an ADMIN or MANAGE_POLICY_REACTIVATION
  // holder reviews.
  listReactivationRequests() {
    return this.prisma.userPolicyAcceptance.findMany({
      where: { policyReviewUntil: { not: null } },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findActiveReviewHold(targetUserId: string) {
    const acceptance = await this.prisma.userPolicyAcceptance.findFirst({
      where: { userId: targetUserId, policyReviewUntil: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!acceptance) {
      throw new BadRequestException('This account is not under policy review');
    }
    return acceptance;
  }

  // Restores full access — the ONLY way a consolidated account leaves
  // POLICY_REVIEW_HOLD/REACTIVATION_REQUESTED/PENDING_ADMIN_DECISION back to
  // normal. Never automatic, regardless of how the user got here.
  async approveReactivation(targetUserId: string, actor: AuthenticatedUser) {
    const existing = await this.findActiveReviewHold(targetUserId);

    const acceptance = await this.prisma.userPolicyAcceptance.update({
      where: { id: existing.id },
      data: {
        status: PolicyAcceptanceStatus.ACCEPTED,
        acceptedAt: new Date(),
        policyReviewStartedAt: null,
        policyReviewUntil: null,
        reactivationRequestedAt: null,
        reactivatedAt: new Date(),
      },
    });

    await this.auditService.record({
      eventType: 'POLICY_REACTIVATION_APPROVED',
      category: 'POLICY',
      severity: 'INFO',
      actorUserId: actor.id,
      actorName: actor.name,
      targetUserId,
    });

    return acceptance;
  }

  // Keeps the account blocked — clears only the pending request (if any) so
  // the user can request again later; the review hold itself stays active.
  // Never deletes anything by itself (see section 20 of the review-hold spec).
  async denyReactivation(targetUserId: string, actor: AuthenticatedUser) {
    const existing = await this.findActiveReviewHold(targetUserId);

    const acceptance = await this.prisma.userPolicyAcceptance.update({
      where: { id: existing.id },
      data: { reactivationRequestedAt: null },
    });

    await this.auditService.record({
      eventType: 'POLICY_REACTIVATION_DENIED',
      category: 'POLICY',
      severity: 'WARNING',
      actorUserId: actor.id,
      actorName: actor.name,
      targetUserId,
    });

    return acceptance;
  }

  // Called by UsersService when an ADMIN flips isActive to false — pauses
  // any running reconsideration deadline so it can't expire while the user
  // is administratively blocked from reconsidering.
  async pauseDeadlineForUser(userId: string): Promise<void> {
    const acceptance = await this.prisma.userPolicyAcceptance.findFirst({
      where: {
        userId,
        status: PolicyAcceptanceStatus.REJECTED,
        scheduledDeletionAt: { not: null },
        deletionPausedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!acceptance || !acceptance.scheduledDeletionAt) return;
    if (acceptance.scheduledDeletionAt.getTime() <= Date.now()) return; // already expired — nothing to pause

    const remainingSeconds = Math.max(
      0,
      Math.floor((acceptance.scheduledDeletionAt.getTime() - Date.now()) / 1000),
    );

    await this.prisma.userPolicyAcceptance.update({
      where: { id: acceptance.id },
      data: {
        deletionPausedAt: new Date(),
        deletionRemainingSeconds: remainingSeconds,
        scheduledDeletionAt: null,
      },
    });

    await this.auditService.record({
      eventType: 'POLICY_DELETION_PAUSED',
      category: 'POLICY',
      severity: 'INFO',
      targetUserId: userId,
      metadata: { deletionRemainingSeconds: remainingSeconds },
    });
  }

  // Called by UsersService when an ADMIN flips isActive back to true —
  // resumes a paused deadline with exactly the time that remained.
  async resumeDeadlineForUser(userId: string): Promise<void> {
    const acceptance = await this.prisma.userPolicyAcceptance.findFirst({
      where: {
        userId,
        status: PolicyAcceptanceStatus.REJECTED,
        deletionPausedAt: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!acceptance || acceptance.deletionRemainingSeconds === null) return;

    const scheduledDeletionAt = new Date(
      Date.now() + acceptance.deletionRemainingSeconds * 1000,
    );

    await this.prisma.userPolicyAcceptance.update({
      where: { id: acceptance.id },
      data: {
        scheduledDeletionAt,
        deletionPausedAt: null,
        deletionRemainingSeconds: null,
      },
    });

    await this.auditService.record({
      eventType: 'POLICY_DELETION_RESUMED',
      category: 'POLICY',
      severity: 'INFO',
      targetUserId: userId,
      metadata: { scheduledDeletionAt: scheduledDeletionAt.toISOString() },
    });
  }
}
