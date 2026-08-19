import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(
    helmet({
      // course covers are served by this same backend and embedded via
      // <img> from the frontend's own origin (different port = different
      // origin) — helmet's default same-origin CORP silently blocks that
      // at the browser level even though the HTTP response itself is a
      // clean 200. This scopes the exception to the static-asset case
      // without weakening CORS on the JSON API.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: configService.get<string>('frontendUrl'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('StudyJA API')
    .setDescription(
      'StudyJA (by LF Code Studio) — courses, modules, PDF/video content and quizzes',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get<number>('port') ?? 3100;
  // binds all interfaces, not just loopback — required for the container
  // network to reach this process when deployed behind a reverse proxy
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
