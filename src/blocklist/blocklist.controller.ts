import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { EmailEligibilityService } from './email-eligibility.service';
import { ListBlocklistQueryDto } from './dto/list-blocklist-query.dto';

// ADMIN-only in full, per spec — not delegated to a permission in this
// first version.
@ApiTags('email-blocklist')
@Roles(Role.ADMIN)
@Controller('email-blocklist')
export class BlocklistController {
  constructor(private readonly emailEligibilityService: EmailEligibilityService) {}

  @Get()
  list(@Query() query: ListBlocklistQueryDto) {
    return this.emailEligibilityService.list(query);
  }

  @Delete(':id')
  remove(@Param('id', ParseUuidPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.emailEligibilityService.remove(id, user.id, user.name);
  }
}
