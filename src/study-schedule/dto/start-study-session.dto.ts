import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class StartStudySessionDto {
  @ApiProperty()
  @IsUUID()
  moduleId: string;

  // Individual PDF/VIDEO the session is actually about, when the module has
  // one — resolved by the study-schedule recommendation, or picked directly
  // by the user. At most one of the two should be set (the module's own
  // `type` says which); optional so a plain module-level session (or a
  // QUIZ module) keeps working exactly as before.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pdfItemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoItemId?: string;
}
