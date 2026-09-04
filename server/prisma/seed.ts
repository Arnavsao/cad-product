/**
 * Development seed: enough realistic data to exercise the dashboard's paging,
 * sorting, folders, trash, Owner/Shared columns and organization switcher.
 *
 * Currently DISABLED: `npm run db:seed` prints a notice and writes nothing.
 * Every invocation needs `SEED_ENABLE=1` (see the bottom of this file).
 *
 *   SEED_ENABLE=1 npm run db:seed                  # attach to the newest user
 *   SEED_ENABLE=1 SEED_USER_EMAIL=me@example.com npm run db:seed
 *   SEED_ENABLE=1 SEED_RESET=1 npm run db:seed     # delete seeded rows first
 *
 * Design decisions:
 *
 * - **It attaches to an existing user rather than inventing one.** You sign in
 *   normally and immediately see a full workspace; a seed that made its own
 *   account would need a minted token to be worth anything.
 *
 * - **Deterministic, cuid-shaped ids, so re-running is idempotent.** Every row
 *   this script creates has an id starting `cseed`, which is what makes
 *   `SEED_RESET` able to remove exactly its own rows and nothing of yours. They
 *   have to look like real cuids: `ParseCuidPipe` 404s any other `:id`.
 *
 * - **Real objects in storage.** Each drawing gets an actual DXF written to
 *   MinIO at the key the API would have used, plus its `drawing_versions` row,
 *   so opening and downloading a seeded drawing works instead of 404ing.
 *
 * - **Planned sequentially, written concurrently.** Every random choice is made
 *   up front in a fixed order, so the data set is byte-identical between runs;
 *   only the ~700 round-trips to Postgres and MinIO fan out (`WRITE_CONCURRENCY`).
 *
 * - **Sequential-looking, pseudo-random data from a fixed seed.** The mulberry32
 *   PRNG below means sizes and dates vary but never change between runs, so a
 *   screenshot taken today matches one taken tomorrow.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '../src/generated/prisma/client';
import { DrawingFormat, NotificationKind, OrgRole, Units, UserRole } from '../src/generated/prisma/client';
import { blankDxf, insunitsForUnit } from '../src/drawings/templates/blank-dxf';
import { drawingVersionKey } from '../src/storage/storage-keys';

// ---------------------------------------------------------------------------
// Shape of the seeded workspace
// ---------------------------------------------------------------------------

const PERSONAL_DRAWINGS = 390;
const TRASHED_DRAWINGS = 45;
const NOTIFICATIONS = 90;
/** Live drawings per organization, and how many of them sit in its trash. */
const ORG_DRAWINGS = 120;
const ORG_TRASHED = 9;

/**
 * How many drawings are written to storage at once.
 *
 * The rows are *planned* sequentially (see `planDrawing`) so the data is
 * identical between runs; only the IO fans out. Twelve keeps MinIO and Postgres
 * busy without opening so many sockets that the pool starts queueing.
 */
const WRITE_CONCURRENCY = 12;

/**
 * Prefix on every id this script writes; `SEED_RESET` deletes by it.
 *
 * It has to be a valid `cuid()` prefix — `ParseCuidPipe` rejects any `:id` that
 * is not `c` + 24 lowercase base-36 chars with a 404, so ids like `seed_org_acme`
 * would make every seeded row unreachable through the API even though the rows
 * themselves are fine.
 */
const P = 'cseed';

/** Prefix used before ids were made cuid-shaped; `reset` clears it as well. */
const LEGACY_P = 'seed_';

/**
 * A deterministic, cuid-shaped id for a seed label.
 *
 * SHA-256 keeps it collision-free across the couple of hundred rows here and
 * stable between runs (so re-seeding upserts rather than duplicating), while the
 * hex digest is a subset of base-36 and therefore passes the cuid check.
 */
function seedId(label: string): string {
  return (P + createHash('sha256').update(label).digest('hex')).slice(0, 25);
}

const FOLDERS = [
  { key: 'site', name: 'Site Plans' },
  { key: 'details', name: 'Construction Details' },
  { key: 'elevations', name: 'Elevations' },
  { key: 'sections', name: 'Sections' },
  { key: 'mep', name: 'MEP Coordination' },
  { key: 'structural', name: 'Structural' },
  { key: 'landscape', name: 'Landscape' },
  { key: 'asbuilt', name: 'As-Built Records' },
  { key: 'civil', name: 'Civil & Drainage' },
  { key: 'fire', name: 'Fire Strategy' },
  { key: 'surveys', name: 'Surveys' },
  { key: 'schedules', name: 'Schedules' },
  // Two nested levels, to prove breadcrumbs and the folder tree.
  { key: 'site-north', name: 'North Parcel', parent: 'site' },
  { key: 'site-south', name: 'South Parcel', parent: 'site' },
  { key: 'details-doors', name: 'Doors & Windows', parent: 'details' },
  { key: 'details-roof', name: 'Roof Assemblies', parent: 'details' },
  { key: 'mep-hvac', name: 'HVAC', parent: 'mep' },
  { key: 'mep-electrical', name: 'Electrical', parent: 'mep' },
  { key: 'structural-steel', name: 'Steelwork', parent: 'structural' },
  { key: 'elevations-detail', name: 'Bay Studies', parent: 'elevations' },
];

/**
 * Name fragments combined into plausible drawing titles.
 *
 * The pool has to be comfortably larger than the number of drawings that land
 * in any one folder, or `planDrawing` exhausts it and everything after that
 * becomes "X (2)", "X (3)" — which is a poor advertisement for a file list.
 */
const SUBJECTS = [
  'Ground Floor', 'First Floor', 'Second Floor', 'Third Floor', 'Roof Plan', 'Basement',
  'Mezzanine', 'Site Layout', 'Site Sections', 'North Elevation', 'South Elevation',
  'East Elevation', 'West Elevation', 'Courtyard Elevation', 'Section A-A', 'Section B-B',
  'Section C-C', 'Stair Core', 'Stair 2 Details', 'Lift Shaft', 'Lift Lobby', 'Curtain Wall',
  'Cladding Details', 'Foundation Plan', 'Pile Layout', 'Drainage', 'Below-Ground Drainage',
  'Ductwork', 'Ventilation Risers', 'Lighting Layout', 'Emergency Lighting', 'Power Layout',
  'Small Power', 'Sprinkler Layout', 'Fire Strategy', 'Ceiling Grid', 'Reflected Ceiling',
  'Door Schedule', 'Window Schedule', 'Ironmongery Schedule', 'Parking Deck', 'Ramp Details',
  'Retaining Wall', 'Boundary Survey', 'Topographic Survey', 'Landscape Plan', 'Planting Plan',
  'Balustrade Details', 'Roof Build-Up', 'Waterproofing Details', 'Steel Frame', 'Column Grid',
  'Slab Reinforcement', 'Services Coordination', 'Riser Layout', 'Plant Room', 'Substation',
  'Bike Store', 'Refuse Store', 'Signage Layout',
];
const QUALIFIERS = [
  '', ' Rev A', ' Rev B', ' Rev C', ' Rev D', ' (Issued)', ' (Draft)', ' (For Comment)',
  ' (Superseded)', ' Detail', ' Overlay', ' Coordination', ' Markup', ' GA',
];

/** Demo teammates, so Owner and the members list show real names. */
const TEAMMATES = [
  { key: 'rk', firstName: 'Riya', lastName: 'Kapoor', role: OrgRole.ADMIN },
  { key: 'ms', firstName: 'Marcus', lastName: 'Silva', role: OrgRole.MEMBER },
  { key: 'ln', firstName: 'Lena', lastName: 'Novak', role: OrgRole.MEMBER },
  { key: 'ph', firstName: 'Priya', lastName: 'Haldar', role: OrgRole.MEMBER },
  { key: 'to', firstName: 'Tomas', lastName: 'Oduya', role: OrgRole.MEMBER },
  { key: 'ac', firstName: 'Aiko', lastName: 'Chen', role: OrgRole.ADMIN },
  { key: 'dp', firstName: 'Diego', lastName: 'Pereira', role: OrgRole.MEMBER },
  { key: 'ef', firstName: 'Ewa', lastName: 'Fischer', role: OrgRole.MEMBER },
];

const ORGS = [
  { key: 'acme', name: 'Acme Design Studio', slug: 'acme-design-studio', joinCode: 'ACME2026', members: ['rk', 'ms', 'ln', 'ph'] },
  { key: 'bridge', name: 'Bridgeworks Civil', slug: 'bridgeworks-civil', joinCode: 'BRDG2026', members: ['to', 'ac', 'dp', 'ef'] },
];

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and identical across runs for a given seed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260903);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number): number => Math.floor(min + rand() * (max - min));

// ---------------------------------------------------------------------------
// Storage (a thin S3 client — the seed does not boot Nest)
// ---------------------------------------------------------------------------

const BUCKET = process.env.S3_BUCKET ?? 'drawings';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
});

const DXF_BY_UNIT = new Map<string, string>();
function dxfFor(unit: string): string {
  const cached = DXF_BY_UNIT.get(unit);
  if (cached) {
    return cached;
  }
  const dxf = blankDxf(insunitsForUnit(unit));
  DXF_BY_UNIT.set(unit, dxf);
  return dxf;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Removes everything a previous run created — rows by their id prefix, objects
 * by listing the bucket for the same prefix inside each user's tree.
 * Deliberately narrow: it must never touch drawings you made by hand.
 *
 * `LEGACY_P` is swept too, so a database seeded before ids became cuid-shaped
 * is cleaned up rather than left with unreachable rows.
 */
async function reset(): Promise<void> {
  const prefixes = [P, LEGACY_P];
  const idIn = { OR: prefixes.map((prefix) => ({ id: { startsWith: prefix } })) };

  const drawings = await prisma.drawing.findMany({ where: idIn, select: { storageKey: true } });
  await prisma.drawing.deleteMany({ where: idIn });
  await prisma.folder.deleteMany({ where: idIn });
  await prisma.organization.deleteMany({ where: idIn });
  await prisma.user.deleteMany({ where: idIn });
  await prisma.notification.deleteMany({ where: idIn });

  // Objects: drop the version keys we know about, then sweep the prefix for
  // any stragglers (a partially-failed earlier run).
  const keys = new Set(drawings.map((d) => d.storageKey).filter(Boolean));
  for (const drawing of drawings) {
    const prefix = drawing.storageKey.replace(/v\d+\.dxf$/, '');
    if (!prefix) continue;
    const listed = await s3
      .send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }))
      .catch(() => null);
    for (const object of listed?.Contents ?? []) {
      if (object.Key) keys.add(object.Key);
    }
  }
  const batch = [...keys];
  for (let i = 0; i < batch.length; i += 1000) {
    await s3
      .send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      )
      .catch(() => undefined);
  }
  console.log(`  reset: removed ${drawings.length} seeded drawings and ${batch.length} objects`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.SEED_RESET === '1') {
    await reset();
  }

  // ── the account to attach to ───────────────────────────────────────────────
  const email = process.env.SEED_USER_EMAIL;
  const user = email
    ? await prisma.user.findFirst({ where: { email } })
    : await prisma.user.findFirst({
        where: { id: { not: { startsWith: P } }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

  if (!user) {
    console.error(
      email
        ? `No user with email ${email}. Sign in once, then re-run.`
        : 'No users in the database yet. Sign in to the app once, then re-run this seed.',
    );
    process.exit(1);
  }
  console.log(`Seeding for ${user.email} (${user.id})`);

  const prefs = await prisma.userPreferences.upsert({
    where: { userId: user.id },
    create: { userId: user.id, units: Units.MM, role: UserRole.ENGINEER },
    update: {},
  });
  const unit = prefs.units.toLowerCase();

  // ── teammates ──────────────────────────────────────────────────────────────
  for (const mate of TEAMMATES) {
    const id = seedId(`user:${mate.key}`);
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        // Distinct from any real Supabase subject, so these can never collide
        // with a genuine sign-in.
        authId: `seed_auth_${mate.key}`,
        email: `${mate.firstName.toLowerCase()}.${mate.lastName.toLowerCase()}@example.com`,
        firstName: mate.firstName,
        lastName: mate.lastName,
        onboardedAt: new Date(),
      },
      update: {},
    });
  }

  // ── organizations ──────────────────────────────────────────────────────────
  for (const org of ORGS) {
    const id = seedId(`org:${org.key}`);
    await prisma.organization.upsert({
      where: { id },
      create: { id, name: org.name, slug: org.slug, joinCode: org.joinCode, createdById: user.id },
      update: { name: org.name },
    });
    // You own both, so the whole admin surface is reachable.
    await prisma.orgMembership.upsert({
      where: { organizationId_userId: { organizationId: id, userId: user.id } },
      create: { id: seedId(`mem:${org.key}:me`), organizationId: id, userId: user.id, role: OrgRole.OWNER },
      update: { role: OrgRole.OWNER },
    });
    for (const key of org.members) {
      const mate = TEAMMATES.find((m) => m.key === key)!;
      await prisma.orgMembership.upsert({
        where: { organizationId_userId: { organizationId: id, userId: seedId(`user:${key}`) } },
        create: {
          id: seedId(`mem:${org.key}:${key}`),
          organizationId: id,
          userId: seedId(`user:${key}`),
          role: mate.role,
        },
        update: { role: mate.role },
      });
    }
  }

  // One open invite per org, so the invites list is not empty.
  for (const org of ORGS) {
    const id = seedId(`inv:${org.key}`);
    await prisma.orgInvite.upsert({
      where: { id },
      create: {
        id,
        organizationId: seedId(`org:${org.key}`),
        email: `pending.${org.key}@example.com`,
        role: OrgRole.MEMBER,
        token: `seed_token_${org.key}`,
        expiresAt: new Date(Date.now() + 10 * DAY_MS),
        createdById: user.id,
      },
      update: {},
    });
  }

  // ── folders, in every workspace ────────────────────────────────────────────
  type Workspace = { key: string; organizationId: string | null };
  const workspaces: Workspace[] = [
    { key: 'personal', organizationId: null },
    ...ORGS.map((o) => ({ key: o.key, organizationId: seedId(`org:${o.key}`) })),
  ];

  const folderIds = new Map<string, string>();
  for (const ws of workspaces) {
    for (const folder of FOLDERS) {
      const id = seedId(`fold:${ws.key}:${folder.key}`);
      const parentId = folder.parent ? (folderIds.get(`${ws.key}_${folder.parent}`) ?? null) : null;
      await prisma.folder.upsert({
        where: { id },
        create: { id, ownerId: user.id, organizationId: ws.organizationId, parentId, name: folder.name },
        update: { name: folder.name },
      });
      folderIds.set(`${ws.key}_${folder.key}`, id);
    }
  }

  // ── drawings ───────────────────────────────────────────────────────────────
  const dxf = dxfFor(unit);
  const byteSizeBase = Buffer.byteLength(dxf, 'utf8');

  /**
   * Creates one drawing row + version row + object.
   *
   * Names are made unique per (workspace, folder) here rather than relying on
   * the API's auto-suffix, because the partial unique indexes are live: a
   * collision would abort the seed instead of quietly renaming.
   */
  const usedNames = new Set<string>();

  /** Everything about one drawing, decided before any IO happens. */
  interface DrawingSpec {
    id: string;
    ownerId: string;
    organizationId: string | null;
    folderId: string | null;
    name: string;
    format: DrawingFormat;
    storageKey: string;
    byteSize: number;
    lastOpenedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }

  const specs: DrawingSpec[] = [];

  /**
   * Decides one drawing's data and queues it. Pure planning — every `rand()`
   * call happens here, in call order, so the whole data set is identical
   * between runs even though the writes below are concurrent.
   *
   * Names are made unique per (workspace, folder) here rather than relying on
   * the API's auto-suffix, because the partial unique indexes are live: a
   * collision would abort the seed instead of quietly renaming.
   */
  function planDrawing(params: {
    id: string;
    ownerId: string;
    organizationId: string | null;
    folderId: string | null;
    ageDays: number;
    trashed?: boolean;
  }): void {
    const { id, ownerId, organizationId, folderId, ageDays, trashed } = params;

    let name = `${pick(SUBJECTS)}${pick(QUALIFIERS)}`;
    const scope = `${organizationId ?? 'personal'}|${folderId ?? 'root'}|`;
    if (!trashed) {
      let n = 2;
      const base = name;
      while (usedNames.has(scope + name)) {
        name = `${base} (${n++})`;
      }
      usedNames.add(scope + name);
    }

    const updatedAt = new Date(Date.now() - ageDays * DAY_MS - between(0, DAY_MS));
    specs.push({
      id,
      ownerId,
      organizationId,
      folderId,
      name,
      format: rand() < 0.12 ? DrawingFormat.DWG : DrawingFormat.DXF,
      storageKey: drawingVersionKey(ownerId, id, 1),
      byteSize: byteSizeBase + between(0, 400_000),
      // Two thirds have been opened, so "Recent" is populated but not total.
      lastOpenedAt: rand() < 0.66 ? new Date(updatedAt.getTime() + between(0, DAY_MS)) : null,
      deletedAt: trashed ? new Date(Date.now() - between(0, 20) * DAY_MS) : null,
      createdAt: new Date(updatedAt.getTime() - between(1, 60) * DAY_MS),
      updatedAt,
    });
  }

  /** The IO half: row, version row, object. Safe to run concurrently. */
  async function writeDrawing(spec: DrawingSpec): Promise<void> {
    const { id, storageKey, byteSize } = spec;
    await prisma.drawing.upsert({ where: { id }, create: { ...spec, currentVersion: 1 }, update: {} });
    await prisma.drawingVersion.upsert({
      where: { drawingId_version: { drawingId: id, version: 1 } },
      create: { id: seedId(`ver:${id}`), drawingId: id, version: 1, storageKey, byteSize },
      update: {},
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        Body: dxf,
        ContentType: 'text/plain; charset=utf-8',
      }),
    );
  }

  const folderKeys = FOLDERS.map((f) => f.key);

  // Personal: mostly in folders, a healthy number at the root so the top level
  // paginates on its own.
  for (let i = 0; i < PERSONAL_DRAWINGS; i++) {
    const atRoot = i % 4 === 0;
    planDrawing({
      id: seedId(`draw:personal:${i}`),
      ownerId: user.id,
      organizationId: null,
      folderId: atRoot ? null : (folderIds.get(`personal_${pick(folderKeys)}`) ?? null),
      ageDays: Math.floor((i / PERSONAL_DRAWINGS) * 90),
    });
  }

  for (let i = 0; i < TRASHED_DRAWINGS; i++) {
    planDrawing({
      id: seedId(`draw:trash:${i}`),
      ownerId: user.id,
      organizationId: null,
      folderId: null,
      ageDays: 40 + i,
      trashed: true,
    });
  }

  // Org drawings, split between you and the teammates so the Owner column has
  // more than one value and "Shared" is populated.
  for (const org of ORGS) {
    const orgId = seedId(`org:${org.key}`);
    const owners = [user.id, ...org.members.map((k) => seedId(`user:${k}`))];
    for (let i = 0; i < ORG_DRAWINGS; i++) {
      // The owner cycles on `i` and the root/folder split on `i % 7`, so the two
      // never line up. Using `i % 5` for both — with 5 owners — put every
      // root-level drawing under the same person, which is exactly where the
      // Owner column is read.
      planDrawing({
        id: seedId(`draw:${org.key}:${i}`),
        ownerId: owners[i % owners.length],
        organizationId: orgId,
        folderId: i % 7 === 0 ? null : (folderIds.get(`${org.key}_${pick(folderKeys)}`) ?? null),
        ageDays: Math.floor((i / ORG_DRAWINGS) * 60),
      });
    }
    // A few trashed rows per org, so org Trash is not empty either.
    for (let i = 0; i < ORG_TRASHED; i++) {
      planDrawing({
        id: seedId(`draw:${org.key}:trash:${i}`),
        // Offset so the trash is not always owned by the same first few people.
        ownerId: owners[(i + 2) % owners.length],
        organizationId: orgId,
        folderId: null,
        ageDays: 30 + i,
        trashed: true,
      });
    }
  }

  // ── write them ─────────────────────────────────────────────────────────────
  // Fixed-size worker pool over the planned specs. Sequentially this is ~700
  // round-trips to Postgres and MinIO; a dozen in flight turns minutes into
  // seconds without needing a batching API for the object writes.
  let created = 0;
  let nextSpec = 0;
  process.stdout.write(`Writing ${specs.length} drawings `);
  await Promise.all(
    Array.from({ length: WRITE_CONCURRENCY }, async () => {
      for (let i = nextSpec++; i < specs.length; i = nextSpec++) {
        await writeDrawing(specs[i]);
        created++;
        if (created % 50 === 0) {
          process.stdout.write('.');
        }
      }
    }),
  );
  process.stdout.write(' done\n');

  // ── notifications ──────────────────────────────────────────────────────────
  // Prisma enum members are SCREAMING_CASE; only the column values are
  // lowercase (via `@map`), so the client needs the members here.
  const KINDS = [
    NotificationKind.SYSTEM,
    NotificationKind.DRAWING,
    NotificationKind.STORAGE,
    NotificationKind.ACCOUNT,
  ] as const;
  const TITLES: Record<NotificationKind, string[]> = {
    [NotificationKind.SYSTEM]: [
      'Scheduled maintenance on Sunday',
      'New in CADO: layout tabs',
      'Improved DXF import',
    ],
    [NotificationKind.DRAWING]: [
      'Riya Kapoor edited Ground Floor',
      'Marcus Silva shared Section A-A',
      'Your export finished',
    ],
    [NotificationKind.STORAGE]: ['You have used 68% of your storage', 'Large upload completed'],
    [NotificationKind.ACCOUNT]: ['Welcome to CADO', 'Your profile was updated', 'New sign-in from Chrome'],
  };
  for (let i = 0; i < NOTIFICATIONS; i++) {
    const kind = pick(KINDS);
    await prisma.notification.upsert({
      where: { id: seedId(`notif:${i}`) },
      create: {
        id: seedId(`notif:${i}`),
        userId: user.id,
        kind,
        title: pick(TITLES[kind]),
        body: 'Seeded notification for local development.',
        linkUrl: '/dashboard',
        // The newest handful stay unread so the header badge shows a count.
        readAt: i < 6 ? null : new Date(Date.now() - i * 0.5 * DAY_MS),
        createdAt: new Date(Date.now() - i * 0.5 * DAY_MS),
      },
      update: {},
    });
  }

  const liveCount = await prisma.drawing.count({ where: { ownerId: user.id, deletedAt: null, organizationId: null } });
  console.log(
    [
      `\nDone. Created/verified ${created} drawings with real objects in "${BUCKET}".`,
      `  personal (live):   ${liveCount}`,
      `  personal (trash):  ${TRASHED_DRAWINGS}`,
      `  folders:           ${FOLDERS.length} per workspace`,
      `  organizations:     ${ORGS.length} (${ORGS.map((o) => o.name).join(', ')})`,
      `                     ${ORG_DRAWINGS} drawings + ${ORG_TRASHED} trashed each`,
      `  teammates:         ${TEAMMATES.length}`,
      `  notifications:     ${NOTIFICATIONS}`,
      '',
      'Re-run any time — it is idempotent. `SEED_RESET=1 npm run db:seed` clears it first.',
    ].join('\n'),
  );
}

/**
 * Sample data is switched off.
 *
 * The generator below is left intact and typechecked rather than commented out
 * — commenting out 600 lines would rot silently against the schema, and this
 * way turning it back on is one environment variable. Run
 * `SEED_ENABLE=1 npm run db:seed` to populate a workspace again.
 *
 * Note when re-enabling: `SEED_RESET=1` deletes seeded folders, and
 * `Drawing.folder` is `onDelete: SetNull`, so any drawing *you* made inside a
 * seeded folder is moved to the workspace root — where it can collide with an
 * existing name under `drawings_personal_name_key` and abort the reset. Move
 * your own drawings out of seeded folders first.
 */
if (process.env.SEED_ENABLE === '1') {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
} else {
  console.log(
    [
      'Sample data is disabled — nothing was written.',
      '',
      'To generate it:  SEED_ENABLE=1 npm run db:seed',
      'To clear it:     SEED_ENABLE=1 SEED_RESET=1 npm run db:seed',
    ].join('\n'),
  );
  void prisma.$disconnect();
}
