import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // bodyParser:false — parsers are mounted per route in configureApp() so the
  // Svix webhook sees raw bytes and DXF saves get their own text limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  app.get(Logger).log(`CADOnline API listening on http://localhost:${port}/${API_PREFIX} (health: /healthz)`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Logger may not be ready if the module graph failed to build.
  console.error('Fatal: API failed to start', error);
  process.exit(1);
});
