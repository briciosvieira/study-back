import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ReorderVideoDto {
  @ApiProperty({ example: '1.1' })
  @IsString()
  orderLabel: string;
}
