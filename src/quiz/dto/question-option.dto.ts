import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Length, MinLength } from 'class-validator';

export class QuestionOptionDto {
  @ApiProperty({ example: 'A' })
  @IsString()
  @Length(1, 1)
  letter: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  text: string;

  @ApiProperty()
  @IsBoolean()
  correct: boolean;
}
