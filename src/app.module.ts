import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'path';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './auth/auth.module';
import { CoursesModule } from './courses/courses.module';
import { HealthController } from './health/health.controller';
import { ModulesModule } from './modules/modules.module';
import { PdfModule } from './pdf/pdf.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuizModule } from './quiz/quiz.module';
import { StorageModule } from './storage/storage.module';
import { StudyScheduleModule } from './study-schedule/study-schedule.module';
import { TemplateLibraryModule } from './template-library/template-library.module';
import { UsersModule } from './users/users.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          username: configService.get<string>('redis.username'),
          password: configService.get<string>('redis.password'),
          tls: configService.get<boolean>('redis.tls') ? {} : undefined,
        },
      }),
    }),
    // exposes uploads.dir at /uploads/* as plain static files — this runs as
    // Express middleware ahead of Nest's router, so it bypasses the global
    // auth/rate-limit guards below (course covers are meant to be publicly
    // readable via <img>, same as the S3/R2-backed PDF and video files)
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          rootPath: resolve(configService.get<string>('uploads.dir')!),
          serveRoot: '/uploads',
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    ModulesModule,
    StorageModule,
    PdfModule,
    VideoModule,
    QuizModule,
    StudyScheduleModule,
    TemplateLibraryModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
