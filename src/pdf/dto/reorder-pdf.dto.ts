import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ReorderPdfDto {
  @ApiProperty({ example: '1.1' })
  @IsString()
  orderLabel: string;
}
