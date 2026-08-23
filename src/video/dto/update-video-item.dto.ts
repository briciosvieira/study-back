import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateVideoItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Object key of a newly uploaded replacement file, from presign-replace. Omit to keep the current file.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  fileKey?: string;
}
