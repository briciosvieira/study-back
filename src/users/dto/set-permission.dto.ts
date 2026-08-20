import { ApiProperty } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

export class SetPermissionDto {
  @ApiProperty({ enum: Permission })
  @IsEnum(Permission)
  permission: Permission;

  @ApiProperty()
  @IsBoolean()
  grant: boolean;
}
