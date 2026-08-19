import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AnswerQuestionDto {
  @ApiProperty()
  @IsUUID()
  questionId: string;

  @ApiPropertyOptional({
    description: 'Chosen option letter, or null/omitted if time ran out',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  chosenOption?: string | null;
}
