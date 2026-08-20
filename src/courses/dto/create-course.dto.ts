import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: 'Short summary shown on course cards and lists',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Long-form "about this course" shown on the overview tab',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  about?: string;

  @ApiPropertyOptional({
    description: 'Who this course is for, shown on the overview tab',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  targetAudience?: string;
}
