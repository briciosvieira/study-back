import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DeleteUserDto {
  @ApiPropertyOptional({
    description: 'Required only when the target account is an ADMIN',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
