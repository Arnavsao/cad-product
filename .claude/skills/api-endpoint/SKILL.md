---
name: api-endpoint
description: Add or change a route, service, DTO, or Prisma model in the NestJS API under server/ — the module layout, @CurrentActor + access levels, ApiException codes and the response envelope, class-validator DTOs, Prisma 7 migrations with the generated client, Zod env additions, jest-mock-extended unit specs and the docker-backed e2e suite. Use when asked for a new API endpoint, a schema change, a new server env var, or a server test.
---

# Server work (`server/`, own npm package)

NestJS 11 + Prisma 7 + Postgres, S3-compatible storage (MinIO locally, R2 in prod). Every route except `GET /healthz` sits under `/api/v1` and behind `SupabaseAuthGuard`. Run server commands with `npm --prefix server run <script>` from the repo root.

## Feature module layout

```
server/src/<feature>/
  <feature>.module.ts
  <feature>.controller.ts     thin: decorators, actor, delegate
  <feature>.service.ts        all invariants live here
  <feature>.mapper.ts         Prisma row → DTO
  <feature>.service.spec.ts   unit spec, Prisma mocked
  dto/<feature>.dto.ts        class-validator input DTOs + response interfaces + limits
```

Copy `folders/` as the template. Register the module in `app.module.ts`.

## Controller conventions

```ts
@Controller('folders')
export class FoldersController {
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<FolderDto> {
    return this.folders.get(actor, id);
  }
  @Post() @HttpCode(HttpStatus.CREATED) create(...)
}
```

- `@CurrentActor()` yields `{ userId, email }` (email lowercased; shares are addressed by email).
- Ids are CUIDs; validate with `ParseCuidPipe`.
- Boolean query flags parse via `isTruthyFlag` from `drawings/dto/list-drawings.dto.ts`.
- Document each handler with the route, response type and the error codes it can raise, as the existing controllers do.
- Presign/upload style routes get a tighter `@Throttle` than the 300/min global.

## Errors and the envelope

Throw `ApiException` (`common/errors/api-error.ts`) with a **stable machine-readable code**: `ApiException.notFound()`, `.conflict('NAME_TAKEN', …)`, `.unprocessable('FOLDER_CYCLE', …)`, `.payloadTooLarge(limit)`. Extra payload merges into the body (`409 VERSION_CONFLICT` carries `{ currentVersion }`). Ownership violations return 404, never 403, so existence does not leak.

Success bodies are wrapped as `{ success: true, data }` by `response-envelope.interceptor.ts`; return the plain DTO from the handler. The Angular `HttpManagerService` unwraps exactly this shape.

## Access control

`common/access.ts` defines `AccessLevel = 'view' | 'edit' | 'manage'` and the helpers that resolve how an actor reaches a drawing or folder (owner, organisation, share). Use them; do not re-derive ownership with ad-hoc `where` clauses.

## Prisma

- Schema: `server/prisma/schema.prisma`. Client is generated into `server/src/generated/prisma`; import from `'../generated/prisma/client'`.
- New migration: edit the schema, then `npm run db:migrate` (root) which runs `prisma migrate dev`; name it in snake_case like the existing folders. Commit the migration directory. `prisma migrate deploy` runs on API boot in prod.
- Postgres treats NULL `parent_id` values as distinct in unique indexes, hence service-level pre-checks that produce a usable 409.
- Postgres holds metadata only. Drawing payloads and thumbnails go to object storage via `storage/`.
- Saves are concurrency-safe by construction: conditional `UPDATE … WHERE currentVersion = expected` plus the unique `(drawingId, version)` index. Keep that pattern for anything versioned.

## New environment variables

1. Add to `config/env.schema.ts` (Zod). The process refuses to boot on a bad value; optional keys must have a safe "off" default (billing and mail already work this way).
2. Document in `server/.env.example` with the same comment style.
3. Add to `deploy/azure/provision.sh` as a Container App secret or env var. Blank optional keys are omitted, not set to `""`.
4. Never touch `server/.env` in a commit; it is gitignored and holds live credentials.

## Tests

Unit (`*.spec.ts` next to the code, Jest):

```ts
const prisma = mockDeep<PrismaService>();
const svc = new FoldersService(prisma as unknown as PrismaService, …);
```

Test the invariants the service owns (uniqueness pre-checks, cycles, workspace boundaries), not Prisma. Use the `rejection()` helper pattern to assert `ApiException.code`.

e2e (`server/test/*.e2e-spec.ts`, supertest): needs `npm run db:up` and `prisma migrate deploy`; tokens are minted HS256 via `test/support/jwt.ts`. Runs `--runInBand` with a raised `RATE_LIMIT_LIMIT` so suites share one throttle budget.

See the verify skill for the exact commands.
