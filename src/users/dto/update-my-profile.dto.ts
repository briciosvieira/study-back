import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// Deliberately narrow: only fields a user may change about themselves.
// role/active/mustChangePassword/avatarStorageKey/passwordHash are never
// accepted here — the service maps fields explicitly, this DTO existing is
// just the first layer of defense against mass assignment.
export class UpdateMyProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Required only when email is being changed',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
