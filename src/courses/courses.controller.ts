import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { CoursesService } from './courses.service';
import { MAX_COVER_SIZE_BYTES } from './course-cover-storage.service';
import { AddStudentsDto } from './dto/add-students.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@ApiTags('courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get()
  findAll() {
    return this.coursesService.findAllForStaff();
  }

  @Roles(Role.STUDENT)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.coursesService.findMineForStudent(user.id);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coursesService.findOne(id, user);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post()
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.coursesService.create(dto, user.id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Patch(':id')
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateCourseDto) {
    return this.coursesService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseUuidPipe) id: string) {
    return this.coursesService.remove(id);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get(':id/students')
  getStudents(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListStudentsQueryDto,
  ) {
    return this.coursesService.getEnrolledStudents(id, query);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Get(':id/available-students')
  getAvailableStudents(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListStudentsQueryDto,
  ) {
    return this.coursesService.getAvailableStudents(id, query);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/students')
  addStudents(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AddStudentsDto,
  ) {
    return this.coursesService.addStudents(id, dto);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Delete(':id/students/:userId')
  removeStudent(
    @Param('id', ParseUuidPipe) id: string,
    @Param('userId', ParseUuidPipe) userId: string,
  ) {
    return this.coursesService.removeStudent(id, userId);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Post(':id/cover')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_COVER_SIZE_BYTES } }),
  )
  uploadCover(
    @Param('id', ParseUuidPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.coursesService.uploadCover(id, file);
  }

  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @Delete(':id/cover')
  removeCover(@Param('id', ParseUuidPipe) id: string) {
    return this.coursesService.removeCover(id);
  }
}
