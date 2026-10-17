import 'reflect-metadata';
import { createApp } from './app';
import { env } from './config/env';

async function bootstrap() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(env().PORT, '0.0.0.0');
}

void bootstrap();
