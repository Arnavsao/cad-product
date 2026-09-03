import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { Env } from './config/env.schema';

/** Global URL prefix for every route except `/healthz`. */
export const API_PREFIX = 'api/v1';

/**
 * Express-level configuration shared by `main.ts` and the e2e harness.
 *
 * Design — per-route body parsers: the app is created with `bodyParser: false`
 * and parsers are mounted here in a deliberate order:
 *
 *  1. `express.text()` for DXF saves (`text/plain`, 6 MB — 5 MB payload plus
 *     headroom; the service enforces the exact limit and answers 413 itself).
 *  2. `express.raw({ type: 'image/png' })` for thumbnails (600 KB / 512 KB).
 *  3. JSON: 6 MB only for `POST /api/v1/drawings` (may carry `initialDxf`),
 *     1 MB everywhere else so a bulky body cannot tie up the JSON parser.
 *  4. `urlencoded` 100 KB for completeness (nothing uses it).
 *
 * Two-layer limits: nginx in front must allow ≥ 8 MB (`client_max_body_size`).
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- body parsers (order matters, see above) -------------------------------
  app.use(`/${API_PREFIX}/drawings/:id/content`, express.text({ type: 'text/plain', limit: '6mb' }));
  app.use(`/${API_PREFIX}/drawings/:id/thumbnail`, express.raw({ type: 'image/png', limit: '600kb' }));

  const largeJson = express.json({ limit: '6mb' });
  const defaultJson = express.json({ limit: '1mb' });
  const createDrawingPath = `/${API_PREFIX}/drawings`;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.endsWith('/') && req.path.length > 1 ? req.path.slice(0, -1) : req.path;
    if (req.method === 'POST' && path === createDrawingPath) {
      return largeJson(req, res, next);
    }
    return defaultJson(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // --- security / CORS -------------------------------------------------------
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match'],
    exposedHeaders: ['ETag'],
    maxAge: 600,
  });

  // --- routing ---------------------------------------------------------------
  app.setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'healthz', method: RequestMethod.GET }] });

  return app;
}
