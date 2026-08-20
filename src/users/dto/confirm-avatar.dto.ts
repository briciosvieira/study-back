import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class ConfirmAvatarDto {
  @ApiProperty({ description: 'Object key returned by the presign-upload step' })
  @IsString()
  @MinLength(1)
  key: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  fileSize: number;
}
