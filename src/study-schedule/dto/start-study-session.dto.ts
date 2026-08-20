import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartStudySessionDto {
  @ApiProperty()
  @IsUUID()
  moduleId: string;
}
