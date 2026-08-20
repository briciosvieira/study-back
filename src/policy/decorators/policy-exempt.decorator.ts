import { SetMetadata } from '@nestjs/common';

export const POLICY_EXEMPT_KEY = 'policyExempt';

// Marks a route reachable by an authenticated user regardless of their
// policy acceptance state (PENDING/REJECTED included) — policy read/accept/
// reject/dismiss, auth/me, and logout. Everything else requires
// POLICY_ACCEPTED once a policy is published. isActive is never exempt —
// AccountStatusGuard blocks that before this decorator is even consulted.
export const AllowWithoutPolicyAcceptance = () => SetMetadata(POLICY_EXEMPT_KEY, true);
