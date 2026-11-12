import { BadRequestException, ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });

  configureApp(app);
  return app;
}

export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: () =>
        new BadRequestException({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
        }),
    }),
  );
}
