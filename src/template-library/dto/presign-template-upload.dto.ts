import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class PresignTemplateUploadDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  contentType: string;
}
