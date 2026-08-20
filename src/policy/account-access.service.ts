import { Injectable } from '@nestjs/common';
import { PolicyAcceptanceStatus } from '@prisma/client';

export type AccountAccessState =
  | 'ACCOUNT_INACTIVE'
  | 'POLICY_PENDING'
  | 'POLICY_REJECTED_RECOVERABLE'
  | 'POLICY_REJECTED_EXPIRED'
  | 'POLICY_REVIEW_HOLD'
  | 'REACTIVATION_REQUESTED'
  | 'PENDING_ADMIN_DECISION'
  | 'POLICY_ACCEPTED';

export interface AccountAccessAcceptance {
  status: PolicyAcceptanceStatus;
  policyVersionId: string;
  scheduledDeletionAt: Date | null;
  deletionPausedAt: Date | null;
  // Consolidated-account review hold — see PolicyService.transitionToRejected.
  // Non-null for the entire hold episode (POLICY_REVIEW_HOLD ->
  // REACTIVATION_REQUESTED -> PENDING_ADMIN_DECISION); cleared only by an
  // explicit admin decision, never by the user's own accept/reject.
  policyReviewUntil: Date | null;
  reactivationRequestedAt: Date | null;
}

export interface AccountAccessInput {
  active: boolean;
  acceptance: AccountAccessAcceptance | null;
  activePolicyVersionId: string | null; // null = no policy configured yet, nobody is gated
  requiresReacceptance: boolean;
}

// The single, pure decision function behind login, refresh, and the guard —
// exists specifically so those three call sites can never diverge on what
// "PENDING vs REJECTED vs expired" actually means. isActive always wins
// first, no matter what the policy state says.
@Injectable()
export class AccountAccessService {
  resolve(input: AccountAccessInput): AccountAccessState {
    if (!input.active) return 'ACCOUNT_INACTIVE';

    if (!input.activePolicyVersionId) return 'POLICY_ACCEPTED'; // no policy published — nothing to gate

    if (!input.acceptance) return 'POLICY_PENDING';

    // Consolidated-account review hold takes priority over the normal
    // ACCEPTED/REJECTED interpretation of `status` — it spans a status
    // change (REJECTED while awaiting reconsideration, then ACCEPTED again
    // once the user requests reactivation) and is only cleared by an admin.
    if (input.acceptance.policyReviewUntil) {
      if (input.acceptance.reactivationRequestedAt) return 'REACTIVATION_REQUESTED';
      return input.acceptance.policyReviewUntil.getTime() > Date.now()
        ? 'POLICY_REVIEW_HOLD'
        : 'PENDING_ADMIN_DECISION';
    }

    if (input.acceptance.status === PolicyAcceptanceStatus.REJECTED) {
      if (input.acceptance.deletionPausedAt) return 'POLICY_REJECTED_RECOVERABLE';
      if (!input.acceptance.scheduledDeletionAt) return 'POLICY_REJECTED_RECOVERABLE';
      return input.acceptance.scheduledDeletionAt.getTime() > Date.now()
        ? 'POLICY_REJECTED_RECOVERABLE'
        : 'POLICY_REJECTED_EXPIRED';
    }

    if (input.acceptance.status === PolicyAcceptanceStatus.PENDING) return 'POLICY_PENDING';

    // ACCEPTED — but for a policy version other than the currently active
    // one, and that active version demands reacceptance
    if (
      input.acceptance.policyVersionId !== input.activePolicyVersionId &&
      input.requiresReacceptance
    ) {
      return 'POLICY_PENDING';
    }

    return 'POLICY_ACCEPTED';
  }
}
