import { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../src/app';

let app: NestExpressApplication | undefined;

/** Boots one Nest app per test file, exactly as production does. */
export async function getApp(): Promise<NestExpressApplication> {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}

export async function closeApp() {
  await app?.close();
  app = undefined;
}
