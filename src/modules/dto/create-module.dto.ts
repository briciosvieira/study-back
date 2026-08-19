import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModuleType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class CreateModuleDto {
  @ApiProperty({ enum: ModuleType })
  @IsEnum(ModuleType)
  type: ModuleType;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  coverUrl?: string;
}
