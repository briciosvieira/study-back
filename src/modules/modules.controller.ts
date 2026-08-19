import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CreateModuleDto } from './dto/create-module.dto';
import { SetModuleVisibilityDto } from './dto/set-module-visibility.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ModulesService } from './modules.service';

@ApiTags('modules')
@Controller()
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Get('courses/:courseId/modules')
  findAllForCourse(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.modulesService.findAllForCourse(courseId, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post('courses/:courseId/modules')
  create(
    @Param('courseId', ParseUuidPipe) courseId: string,
    @Body() dto: CreateModuleDto,
  ) {
    return this.modulesService.create(courseId, dto);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch('modules/:id')
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateModuleDto) {
    return this.modulesService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('modules/:id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.modulesService.remove(id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch('modules/:id/visibility')
  setVisibility(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SetModuleVisibilityDto,
  ) {
    return this.modulesService.setVisibility(id, dto);
  }
}
