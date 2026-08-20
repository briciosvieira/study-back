import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { ListStudentsQueryDto } from '../courses/dto/list-students-query.dto';
import { AddCoursesDto } from './dto/add-courses.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { SetPermissionDto } from './dto/set-permission.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // admin-only: this feeds the dedicated "Students" management area, not
  // the (now course-scoped) student picker used by instructors elsewhere
  @Get('students')
  getStudentsOverview(@Query() query: ListStudentsQueryDto) {
    return this.usersService.getStudentsOverview(query);
  }

  // must stay after the 'students' route above — otherwise Nest would match
  // GET /users/students as :id='students' first
  @Get(':id')
  findOne(@Param('id', ParseUuidPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Get(':id/policy-status')
  getPolicyStatus(@Param('id', ParseUuidPipe) id: string) {
    return this.usersService.getPolicyStatus(id);
  }

  @Get(':id/courses')
  getCourses(@Param('id', ParseUuidPipe) id: string) {
    return this.usersService.getCourses(id);
  }

  @Get(':id/available-courses')
  getAvailableCourses(
    @Param('id', ParseUuidPipe) id: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.getAvailableCourses(id, search);
  }

  @Post(':id/courses')
  addCourses(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AddCoursesDto,
  ) {
    return this.usersService.addCourses(id, dto);
  }

  @Delete(':id/courses/:courseId')
  removeCourse(
    @Param('id', ParseUuidPipe) id: string,
    @Param('courseId', ParseUuidPipe) courseId: string,
  ) {
    return this.usersService.removeCourse(id, courseId);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, user);
  }

  // also open to INSTRUCTOR — UsersService.resetPassword enforces the
  // instructor-cannot-target-an-admin rule against the target fetched from
  // the DB, not anything the client sends
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.resetPassword(id, dto, user);
  }

  // ADMIN-only, backend-enforced regardless of target role — see
  // UsersService.setPermission for the "cannot touch an admin" guard.
  @Patch(':id/permissions')
  setPermission(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: SetPermissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.setPermission(id, dto.permission, dto.grant, user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: DeleteUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.remove(id, dto, user);
  }
}
