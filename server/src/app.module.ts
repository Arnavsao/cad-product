import { Module, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { AuthModule } from './auth/auth.module';
import { ApiException } from './common/errors/api-error';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { Env, validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
// ---------------------------------------------------------------------------
// Domain modules (added by the drawings/folders work) — import here:
// import { DrawingsModule } from './drawings/drawings.module';
// import { FoldersModule } from './folders/folders.module';
// ---------------------------------------------------------------------------

/** Default throttle: 300 requests / minute / IP. Routes override with `@Throttle`. */
const DEFAULT_THROTTLE = { name: 'default', ttl: 60_000, limit: 300 };

/** Flattens class-validator errors (incl. nested) to `{ field, message }[]`. */
function flattenValidationErrors(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    for (const message of Object.values(err.constraints ?? {})) {
      out.push({ field, message });
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children, field));
    }
  }
  return out;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: { ignore: (req) => req.url === '/healthz' },
            customProps: (req) => {
              const user = (req as { user?: { id?: string } }).user;
              return user?.id ? { userId: user.id } : {};
            },
            transport:
              env === 'development'
                ? {
                    target: 'pino-pretty',
                    options: { colorize: true, singleLine: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
                  }
                : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRoot({ throttlers: [DEFAULT_THROTTLE] }),
    PrismaModule,
    AuthModule,
    UsersModule,
    StorageModule,
    WebhooksModule,
    // DrawingsModule,
    // FoldersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guards run in registration order: rate-limit first, then authenticate.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
          exceptionFactory: (errors: ValidationError[]) => {
            const details = flattenValidationErrors(errors);
            return new ApiException(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Validation failed', { details });
          },
        }),
    },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    {
      provide: APP_FILTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new HttpExceptionFilter(config.get('NODE_ENV', { infer: true }) === 'production'),
    },
  ],
})
export class AppModule {}
