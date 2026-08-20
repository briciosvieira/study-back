import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common/utils/password.constants';

// No target role/id here — the target is always the :id route param,
// resolved and authorized against the DB in the service, never trusted from
// the request body.
export class AdminResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword: string;
}
