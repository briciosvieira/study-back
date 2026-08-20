import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModuleType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
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

  @ApiPropertyOptional({
    description: 'Study priority from 1 (low) to 5 (high), used by the study-schedule recommendation algorithm',
    minimum: 1,
    maximum: 5,
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  studyPriority?: number;
}
