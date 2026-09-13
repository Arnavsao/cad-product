import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AdminOnly } from '../admin.decorators';

/** What the System page reports. */
export interface SystemInfoDto {
  version: string;
  nodeVersion: string;
  environment: string;
  uptimeSeconds: number;
  auth: { configured: boolean; mode: 'jwks' | 'hs256' | 'unconfigured' };
  mail: { transport: 'resend' | 'log'; from: string | null };
  billing: { configured: boolean; mode: 'test' | 'live' | 'off'; webhookConfigured: boolean };
  storage: { bucket: string; reachable: boolean; endpoint: string };
  database: { reachable: boolean; latencyMs: number; keepaliveSeconds: number };
  limits: {
    rateLimit: number;
    adminRateLimit: number;
    maxUploadBytes: number;
    maxInlineContentBytes: number;
    maxVersionsPerDrawing: number;
  };
}

/**
 * `GET /admin/system` — "what is this deployment actually configured to do".
 *
 * Exists because the answers currently live in three dashboards and an env
 * file, and the first question in any incident is whether mail is really
 * sending, whether billing is in test mode, and which build is running. It
 * reports **modes and reachability, never secrets**: a key's presence is a
 * boolean here, and no value from the environment is echoed back.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@AdminOnly()
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async info(): Promise<SystemInfoDto> {
    const startedAt = Date.now();
    const dbReachable = await this.prisma.ping();
    const dbLatency = Date.now() - startedAt;

    const supabaseUrl = this.config.get('SUPABASE_URL', { infer: true });
    const jwtSecret = this.config.get('SUPABASE_JWT_SECRET', { infer: true });
    const dodoKey = this.config.get('DODO_API_KEY', { infer: true });
    const resendKey = this.config.get('RESEND_API_KEY', { infer: true });
    const mailFrom = this.config.get('MAIL_FROM', { infer: true });

    return {
      version: this.config.get('APP_VERSION', { infer: true }) ?? 'dev',
      nodeVersion: process.version,
      environment: this.config.get('NODE_ENV', { infer: true }),
      uptimeSeconds: Math.round(process.uptime()),
      auth: {
        configured: Boolean(supabaseUrl),
        mode: !supabaseUrl ? 'unconfigured' : jwtSecret ? 'hs256' : 'jwks',
      },
      mail: {
        transport: resendKey && mailFrom ? 'resend' : 'log',
        from: mailFrom ?? null,
      },
      billing: {
        configured: Boolean(dodoKey),
        mode: !dodoKey ? 'off' : dodoKey.startsWith('sk_test_') ? 'test' : 'live',
        webhookConfigured: Boolean(this.config.get('DODO_WEBHOOK_KEY', { infer: true })),
      },
      storage: {
        bucket: this.config.get('S3_BUCKET', { infer: true }),
        endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
        reachable: await this.storageReachable(),
      },
      database: {
        reachable: dbReachable,
        latencyMs: dbLatency,
        keepaliveSeconds: this.config.get('DB_KEEPALIVE_SECONDS', { infer: true }),
      },
      limits: {
        rateLimit: this.config.get('RATE_LIMIT_LIMIT', { infer: true }),
        adminRateLimit: this.config.get('ADMIN_RATE_LIMIT_LIMIT', { infer: true }),
        maxUploadBytes: this.config.get('MAX_UPLOAD_BYTES', { infer: true }),
        maxInlineContentBytes: this.config.get('MAX_INLINE_CONTENT_BYTES', { infer: true }),
        maxVersionsPerDrawing: this.config.get('MAX_VERSIONS_PER_DRAWING', { infer: true }),
      },
    };
  }

  /** A failed probe is an answer, not an error: the page's job is to show it. */
  private async storageReachable(): Promise<boolean> {
    try {
      return await this.storage.healthy();
    } catch {
      return false;
    }
  }
}
