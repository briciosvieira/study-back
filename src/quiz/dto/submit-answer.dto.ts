import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class SubmitAnswerDto {
  @ApiPropertyOptional({
    description:
      'Id of the selected option, or null/omitted to clear the answer',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  selectedOptionId?: string | null;
}
