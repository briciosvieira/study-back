import { Body, Controller, Delete, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AllowWithoutPolicyAcceptance } from '../policy/decorators/policy-exempt.decorator';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { ConfirmAvatarDto } from './dto/confirm-avatar.dto';
import { PresignAvatarUploadDto } from './dto/presign-avatar-upload.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ProfileService } from './profile.service';

// Self-service only — every method acts on @CurrentUser()'s own id, never a
// param or body-supplied userId. Open to every authenticated role: this
// controller carries no @Roles() at all, deliberately not nested under
// UsersController (which defaults every route to ADMIN-only).
@ApiTags('profile')
@Controller('users/me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Patch()
  updateProfile(
    @Body() dto: UpdateMyProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.updateProfile(user, dto);
  }

  // Exempt from the policy gate: this is also what the forced
  // mustChangePassword screen calls, and a user can be PENDING/REJECTED
  // *and* required to set a real password at the same time (e.g. an admin
  // reset a brand-new user's password before they ever accepted the
  // policy) — they must be able to reach this regardless of policy state.
  @AllowWithoutPolicyAcceptance()
  @Patch('password')
  changePassword(
    @Body() dto: ChangeMyPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.changePassword(user, dto);
  }

  @Post('avatar/presign')
  presignAvatarUpload(@Body() dto: PresignAvatarUploadDto) {
    return this.profileService.presignAvatarUpload(dto);
  }

  @Post('avatar/confirm')
  confirmAvatar(
    @Body() dto: ConfirmAvatarDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.confirmAvatar(user, dto);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.removeAvatar(user);
  }
}
