import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { toAuthenticatedUser } from '../auth/types/authenticated-user';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { mapUniqueConstraintError } from '../common/utils/prisma-errors.util';
import { normalizeEmail } from '../common/utils/normalize-email.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { ConfirmAvatarDto } from './dto/confirm-avatar.dto';
import { PresignAvatarUploadDto } from './dto/presign-avatar-upload.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

const SALT_ROUNDS = 10;
const AVATAR_KEY_PREFIX = 'avatars';
export const AVATAR_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Generic, non-personal placeholder names — StorageService.presignUpload
// appends a random UUID ahead of whatever fileName it's given, so this is
// enough to keep the resulting key fully opaque (no name/email/username
// ever reaches the R2 path).
const AVATAR_FILE_NAME_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'avatar.jpg',
  'image/png': 'avatar.png',
  'image/webp': 'avatar.webp',
};

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly configService: ConfigService,
  ) {}

  async updateProfile(
    actor: AuthenticatedUser,
    dto: UpdateMyProfileDto,
  ): Promise<AuthenticatedUser> {
    const current = await this.findOrThrow(actor.id);
    const normalizedEmail = dto.email ? normalizeEmail(dto.email) : undefined;
    const emailChanging =
      normalizedEmail !== undefined && normalizedEmail !== current.email;

    if (emailChanging) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'Current password is required to change your email',
        );
      }
      const matches = await bcrypt.compare(
        dto.currentPassword,
        current.passwordHash,
      );
      if (!matches) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }

    // explicit field mapping — never data: dto, so nothing beyond
    // name/email can ever be touched through this endpoint
    try {
      const updated = await this.prisma.user.update({
        where: { id: actor.id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(emailChanging && { email: normalizedEmail }),
        },
      });
      return toAuthenticatedUser(updated, this.publicUrl(), actor.accessState);
    } catch (error) {
      throw mapUniqueConstraintError(error);
    }
  }

  async changePassword(
    actor: AuthenticatedUser,
    dto: ChangeMyPasswordDto,
  ): Promise<AuthenticatedUser> {
    const current = await this.findOrThrow(actor.id);
    const matches = await bcrypt.compare(
      dto.currentPassword,
      current.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    // clears mustChangePassword too: this same endpoint is what the forced
    // "set a new password" screen calls after an admin/instructor reset —
    // successfully proving the current (temporary) password is enough to
    // close out that requirement, no separate flow needed
    const updated = await this.prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash, mustChangePassword: false },
    });
    return toAuthenticatedUser(updated, this.publicUrl(), actor.accessState);
  }

  async presignAvatarUpload(dto: PresignAvatarUploadDto) {
    return this.storage.presignUpload({
      keyPrefix: AVATAR_KEY_PREFIX,
      fileName: AVATAR_FILE_NAME_BY_TYPE[dto.contentType],
      contentType: dto.contentType,
    });
  }

  async confirmAvatar(
    actor: AuthenticatedUser,
    dto: ConfirmAvatarDto,
  ): Promise<AuthenticatedUser> {
    if (!dto.key.startsWith(`${AVATAR_KEY_PREFIX}/`)) {
      throw new BadRequestException('Invalid avatar key');
    }
    if (dto.fileSize > AVATAR_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Avatar exceeds the maximum allowed size of ${AVATAR_MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }
    const exists = await this.storage.objectExists(dto.key);
    if (!exists) {
      throw new BadRequestException(
        'Uploaded object not found in storage — upload it before confirming',
      );
    }

    const current = await this.findOrThrow(actor.id);
    const updated = await this.prisma.user.update({
      where: { id: actor.id },
      data: { avatarStorageKey: dto.key },
    });

    // only remove the previous object once the new one is confirmed saved —
    // a failure above leaves the old avatar intact instead of the user
    // ending up with neither
    if (current.avatarStorageKey) {
      await this.storage.delete(current.avatarStorageKey);
    }

    return toAuthenticatedUser(updated, this.publicUrl(), actor.accessState);
  }

  async removeAvatar(actor: AuthenticatedUser): Promise<AuthenticatedUser> {
    const current = await this.findOrThrow(actor.id);
    const updated = await this.prisma.user.update({
      where: { id: actor.id },
      data: { avatarStorageKey: null },
    });
    if (current.avatarStorageKey) {
      await this.storage.delete(current.avatarStorageKey);
    }
    return toAuthenticatedUser(updated, this.publicUrl(), actor.accessState);
  }

  private async findOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private publicUrl(): string {
    return this.configService.get<string>('storage.publicUrl')!;
  }
}
