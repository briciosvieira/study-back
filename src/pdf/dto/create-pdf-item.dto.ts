import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({
    example: '1.1',
    description: 'Omit to append automatically after the last item',
  })
  @IsOptional()
  @IsString()
  orderLabel?: string;
}
