import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuestionOptionDto } from './question-option.dto';

export class CreateQuestionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  statement: string;

  @ApiPropertyOptional({
    default: 205,
    description: 'Time limit in seconds (default 3min25s)',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  timeLimitSec?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiProperty({ type: [QuestionOptionDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options: QuestionOptionDto[];
}
