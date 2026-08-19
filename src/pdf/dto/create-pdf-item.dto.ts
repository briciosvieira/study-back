import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreatePdfItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({
    description: 'Object key returned by the presign-upload step',
  })
  @IsString()
  @MinLength(1)
  key: string;

  @ApiProperty({ example: '1.1' })
  @IsString()
  orderLabel: string;
}
