import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Object key returned by the presign-upload step' })
  @IsString()
  @MinLength(1)
  key: string;

  @ApiProperty({ description: 'Original file name as selected by the uploader' })
  @IsString()
  @MinLength(1)
  originalName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  mimeType: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  fileSize: number;
}
