import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { AllowWithoutPolicyAcceptance } from './decorators/policy-exempt.decorator';
import { assertPolicyManagementPermission } from './policy-access.util';
import { PolicyService } from './policy.service';

// Reachable regardless of the caller's policy acceptance state (PENDING/
// REJECTED included) — see PolicyAccountGuard. isActive is still enforced
// (an inactive user gets ACCOUNT_INACTIVE before ever reaching here).
@ApiTags('policy')
@AllowWithoutPolicyAcceptance()
@Controller('policy')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get('me')
  async getCurrentPolicy(@CurrentUser() user: AuthenticatedUser) {
    const { policyVersion, acceptance } = await this.policyService.getCurrentPolicyForUser(user.id);
    return {
      policyVersion,
      acceptance,
      accessState: user.accessState,
      reconsiderationDays: this.policyService.getReconsiderationDays(),
      reviewHoldDays: this.policyService.getReviewHoldDays(),
      isEstablishedAccount: await this.policyService.isEstablishedAccount(user.id),
    };
  }

  @Post('accept')
  accept(@CurrentUser() user: AuthenticatedUser) {
    return this.policyService.accept(user);
  }

  @Post('reject')
  reject(@CurrentUser() user: AuthenticatedUser) {
    return this.policyService.reject(user);
  }

  @Post('revoke')
  revokeAcceptance(@CurrentUser() user: AuthenticatedUser) {
    return this.policyService.revokeAcceptance(user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('dismiss')
  async dismiss(@CurrentUser() user: AuthenticatedUser) {
    await this.policyService.dismissModal(user);
    return { dismissed: true };
  }

  // Consolidated-account review-hold management — permission-gated (not
  // @Roles), same pattern as AuditController, so an ADMIN can delegate this
  // to a non-admin MANAGE_POLICY_REACTIVATION holder without also handing
  // them the broader ADMIN-only /users/* surface.
  @Get('reactivation-requests')
  listReactivationRequests(@CurrentUser() user: AuthenticatedUser) {
    assertPolicyManagementPermission(user, Permission.MANAGE_POLICY_REACTIVATION);
    return this.policyService.listReactivationRequests();
  }

  @Get('users/:id/review-status')
  getReviewStatus(@Param('id', ParseUuidPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    assertPolicyManagementPermission(user, Permission.MANAGE_POLICY_REACTIVATION);
    return this.policyService.getUserPolicyStatusForAdmin(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:id/reactivation/approve')
  approveReactivation(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertPolicyManagementPermission(user, Permission.MANAGE_POLICY_REACTIVATION);
    return this.policyService.approveReactivation(id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:id/reactivation/deny')
  denyReactivation(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertPolicyManagementPermission(user, Permission.MANAGE_POLICY_REACTIVATION);
    return this.policyService.denyReactivation(id, user);
  }
}
