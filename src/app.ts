import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { env } from './config/env';

export const API_PREFIX = 'api/v1';

/** Applies middleware, CORS, prefix and docs. Shared by `main.ts` and e2e tests. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = env();
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.setGlobalPrefix(API_PREFIX);

  if (config.STORAGE_DRIVER === 'local') {
    app.useStaticAssets(resolve(config.UPLOAD_DIR), { prefix: '/uploads', maxAge: '1h' });
  }

  const docConfig = new DocumentBuilder()
    .setTitle('TenantKit API')
    .setDescription(
      'Multi-tenant SaaS API. Authenticate with a Bearer access token and select the active workspace with the `X-Workspace-Id` header.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'X-Workspace-Id',
      in: 'header',
      required: false,
      description: 'Active workspace id (required on tenant-scoped routes)',
    })
    .build();
  const document = SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document), {
    jsonDocumentUrl: 'api/docs/json',
  });
  return app;
}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  configureApp(app);
  return app;
}
