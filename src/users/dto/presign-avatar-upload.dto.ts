import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const ALLOWED_AVATAR_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export class PresignAvatarUploadDto {
  @ApiProperty({ enum: ALLOWED_AVATAR_CONTENT_TYPES })
  @IsIn(ALLOWED_AVATAR_CONTENT_TYPES)
  contentType: string;
}
