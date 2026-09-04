# CADO — Production Deployment Readiness Audit

## Executive Summary

CADO is a **substantial, well-architected browser-based 2D CAD product** with an Angular 20 frontend (zoneless, signals, standalone components), NestJS 11 backend, Postgres + S3 storage, and Clerk auth. The core CAD editor is feature-rich with 39+ draw tools, 20+ modify tools, DXF import/export, layouts, blocks, dimensions, hatches, AI assistant, and PDF/SVG plotting.

**Build & typecheck pass cleanly. The app runs.** But there are **critical gaps** that would block or embarrass a production deployment.

---

## ✅ What's Working Well

| Area | Status | Notes |
|---|---|---|
| **TypeScript compilation** | ✅ Pass | `tsc --noEmit` — zero errors |
| **Production build** | ✅ Pass | Zero warnings, 321 kB initial / 93 kB transferred |
| **Dev server** | ✅ Running | http://localhost:4200 serves correctly |
| **Editor standalone mode** | ✅ Works | `clerkPublishableKey: ''` bypasses auth, editor loads |
| **CAD core engine** | ✅ Solid | Pure TS geometry model, framework-agnostic |
| **Drawing tools** | ✅ Rich | Line, rect, circle, arc, ellipse, polyline, spline, polygon, xline, point, text, hatch, leader, dim (7 types), table, image, mview, viewport |
| **Modify tools** | ✅ Rich | Move, rotate, scale, mirror, stretch, trim, extend, offset, fillet, chamfer, blend, join, copy, paste, array, matchprop, draw-order |
| **DXF import/export** | ✅ Works | Web Worker-based parser, full DXF writer |
| **PDF/SVG export** | ✅ Implemented | Plot dialog with page setups, plot stamps |
| **Undo/redo** | ✅ Works | Command stack pattern |
| **Layers, blocks, dim styles** | ✅ Full | Panels for all three |
| **Themes** | ✅ 12 themes | 8 dark, 4 light, persisted to localStorage |
| **Object snaps** | ✅ 12 snaps | Endpoint, midpoint, center, etc. |
| **AI drafting assistant** | ✅ Implemented | Ollama (local) + OpenRouter, tool-calling architecture |
| **Backend API** | ✅ Solid | Drawings CRUD, versions, folders, trash, uploads, thumbnails |
| **Auth (Clerk)** | ✅ Integrated | Sign-in/up, guards, onboarding, webhooks |
| **Concurrency-safe saves** | ✅ Designed | `If-Match` / ETag, 409 on conflict |
| **Docker** | ✅ Both images | Frontend (nginx) + API (Node), docker-compose.prod.yml |
| **CI pipeline** | ✅ GitHub Actions | Typecheck → build → test for both frontend and API |
| **Security headers** | ✅ nginx | X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| **Rate limiting** | ✅ Throttler | 300/min global, 30/min on presign/upload, 120/min webhooks |
| **Env validation** | ✅ Zod | Fail-fast on boot with readable errors |
| **Health checks** | ✅ Both | `/healthz` on nginx + API, Docker HEALTHCHECK |
| **Documentation** | ✅ Thorough | README, ARCHITECTURE, INTEGRATION, MIGRATION, CHANGELOG |

---

## 🔴 CRITICAL — Must Fix Before Deployment

### 1. **19 Failing Unit Tests (Pre-existing)**
- **126 specs total, 19 fail, 107 pass**
- Root cause: zoneless Angular (`NG0908: Angular requires Zone.js`) in test harness
- Affected: `AiPreviewService` (6), `CadContextService` (4), `Vector` (2), `DraftingLine` (2), `DraftingCanvasContext` (2), `Transform` (1), `Point` (1), `HatchRendererService` (1)
- **Fix**: Add `provideZonelessChangeDetection()` (or `provideZoneChangeDetection()`) to each failing TestBed, or configure Karma to use the zoneless provider globally

### 2. **Share Links — Schema Only, No Endpoints**
- The Prisma schema has a full `ShareLink` model (token, permissions, expiry, revocation)
- The [share-dialog.component.ts](file:///Users/arnavsao/Desktop/CAD%20product/src/app/features/cad-editor/components/share-dialog/share-dialog.component.ts) generates **mock/fake links** (`Math.random()` IDs)
- **No server-side share controller, service, or routes exist**
- Comment in schema: `"Schema only in 1.1.0 — endpoints are phase 2"`

> [!CAUTION]
> Users will see a "Share" button that produces non-functional links. Either implement the share API or **remove/hide the share UI** before launch.

### 3. **`server/.env` Contains a Real CLERK_JWT_KEY**
- [server/.env](file:///Users/arnavsao/Desktop/CAD%20product/server/.env) has a full RSA public key on line 28
- `.gitignore` excludes `.env` files, but the key is still present locally
- The `.env` file should **never** be in the repo; only `.env.example` with blank values

### 4. **No `robots.txt` or `sitemap.xml`**
- Critical for SEO and to prevent search engines from indexing API routes
- The nginx config has no `robots.txt` location block

### 5. **No HTTPS / TLS Configuration**
- `nginx.conf` listens on port 80 only — no SSL/TLS
- Production CAD software handling user data **must** use HTTPS
- Need either: TLS termination at load balancer, or nginx SSL config with cert

### 6. **No CSP (Content-Security-Policy) Header**
- Helmet is used server-side but nginx serves the frontend without CSP
- The Clerk SDK loads from CDN, fonts from Google — CSP must whitelist these
- Without CSP, XSS vulnerabilities are unmitigated on the frontend

---

## 🟠 HIGH PRIORITY — Should Fix Before Deployment

### 7. **No Error/Crash Monitoring (APM)**
- No Sentry, Datadog, or equivalent integration
- `GlobalErrorHandler` logs to console only — invisible in production
- Server uses `pino` (good), but no external log aggregation configured

### 8. **No Database Backups Strategy**
- README says prod uses Neon (managed Postgres) — but no backup/PITR config documented
- No pg_dump script, no WAL archiving mentioned

### 9. **No Email/Notification System**
- No email sending for: account verification, password reset, share link invitations, storage quota warnings
- Clerk handles auth emails, but share invites and system notifications need a solution

### 10. **Missing Favicon and PWA Manifest**
- `public/` has `favicon.ico` (15 KB) and `favicon.png` (86 KB) ✅
- But **no `manifest.json`** for PWA / Add to Home Screen
- No Apple touch icons, no Open Graph meta tags for social sharing

### 11. **No Terms of Service / Privacy Policy / Cookie Banner**
- Required by law (GDPR, CCPA) for a product handling user data
- Clerk sets cookies — need a cookie policy at minimum
- Landing page has no legal links

### 12. **AI Agent Sends Data to External LLMs**
- `LlmGatewayService` talks to Ollama (local) or OpenRouter (external)
- Drawing content is sent to the LLM — **no data processing agreement, no user consent**
- The audit log is local-only (IndexedDB) — good, but the LLM call itself sends CAD data

### 13. **No File Size / Storage Quota Enforcement (UI)**
- Backend has limits (`MAX_INLINE_CONTENT_BYTES: 5MB`, `MAX_UPLOAD_BYTES: 50MB`, `MAX_VERSIONS_PER_DRAWING: 50`)
- But no per-user storage quota, no "you've used X of Y GB" dashboard
- Free-tier abuse is possible

### 14. **Missing `og:image` and Social Sharing Meta**
- [index.html](file:///Users/arnavsao/Desktop/CAD%20product/src/index.html) has a basic meta description but no:
  - `og:title`, `og:description`, `og:image`, `og:url`
  - `twitter:card`, `twitter:image`
  - When shared on social media, the link will look bare

---

## 🟡 MEDIUM PRIORITY — Should Add for Product Completeness

### 15. **No Keyboard Shortcut Documentation / Help Dialog**
- AutoCAD has `F1` for help — no help system exists here
- No keyboard shortcut overlay or cheatsheet
- New users have no way to discover shortcuts

### 16. **No Pricing / Plans / Billing**
- No Stripe/payment integration
- No plan tiers (Free/Pro/Enterprise)
- No way to monetize the product

### 17. **No Collaboration / Real-time Editing**
- Share links are non-functional (see #2)
- No WebSocket/CRDT real-time collaboration
- AutoCAD has collaboration — this is a competitive gap

### 18. **No Drawing Templates**
- `defaultTemplate: 'blank'` in user preferences, but no actual template system
- AutoCAD has A0–A4 templates, ANSI templates, etc.
- No template gallery or template creation

### 19. **No Print Dialog (Browser Print)**
- PDF export exists, but no `window.print()` integration
- Users expect Ctrl+P to work in a CAD app

### 20. **No DWG Support (Read)**
- Schema has `DrawingFormat.DWG` enum but no DWG parser
- DWG is the dominant format — most real-world files are DWG
- Consider: libredwg/WASM or a conversion service

### 21. **No Mobile / Touch Support**
- No touch gesture handling for pan/zoom/draw
- No responsive editor layout for tablets
- `<meta name="viewport">` is set but the editor is desktop-only

### 22. **No Analytics**
- No Google Analytics, PostHog, or Mixpanel
- Can't measure: user activation, feature usage, retention

### 23. **Autosave Interval Not User-Configurable (UI)**
- `autosaveIntervalSec: 30` in Prisma schema, but I didn't find a settings UI for it
- Users should be able to set 15s / 30s / 60s / disabled

### 24. **No Export to PNG/JPG**
- PDF and SVG export exist, but no raster image export
- Users often need PNG screenshots for presentations

---

## 🔵 LOW PRIORITY — Nice to Have

| # | Item |
|---|---|
| 25 | **Undo history panel** — visual list of undo steps (AutoCAD has this) |
| 26 | **Measurement unit display** — always show current units in status bar |
| 27 | **Command history export** — export command log for audit |
| 28 | **Multi-language / i18n** — all strings are hardcoded English |
| 29 | **Accessibility audit** — ARIA labels on toolbar buttons, keyboard navigation |
| 30 | **Bundle size optimization** — Clerk chunk alone is 1.56 MB / 495 kB transferred |
| 31 | **Service Worker / offline mode** — cache the app shell for offline use |
| 32 | **Drawing version history UI** — backend supports versions, but no UI to browse/restore old versions |
| 33 | **Folder nesting limit** — no depth limit on folder tree, could create pathological breadcrumbs |
| 34 | **Permanent delete confirmation** — ensure double confirmation before permanent delete from trash |

---

## Verification Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run build` | ✅ Pass — 321 kB initial, zero warnings |
| `npm start` (dev server) | ✅ Running on :4200 |
| `npm run test:ci` | ⚠️ 107 pass / 19 fail (pre-existing) |
| `npm --prefix server run typecheck` | ✅ Pass |
| `curl http://localhost:4200/` | ✅ 200 OK |
| `curl http://localhost:4200/editor` | ✅ 200 OK |
| Node version | ✅ v24.2.0 |
| npm version | ✅ 11.3.0 |

---

## Recommended Priority Order for Deployment

1. **Fix the 19 failing tests** — quick, unblocks CI green status
2. **Remove or disable the Share dialog** — fake links are worse than no feature
3. **Add HTTPS/TLS** — non-negotiable for production
4. **Add CSP headers** to nginx
5. **Add `robots.txt`** and `sitemap.xml`
6. **Add OG/social meta tags** to index.html
7. **Set up error monitoring** (Sentry or equivalent)
8. **Add Terms of Service / Privacy Policy** pages
9. **Add a PWA manifest** for installability
10. **Document the backup strategy**

> [!IMPORTANT]
> Items 1–5 are **deployment blockers**. Items 6–10 are strongly recommended for launch day. Everything else can follow in subsequent releases.

## Open Questions

1. **Where are you deploying?** (Vercel, AWS, GCP, self-hosted?) — affects TLS, CDN, and monitoring choices
2. **Do you have a Clerk production instance?** — `pk_live_` key needed for `environment.prod.ts`
3. **What's your storage backend in prod?** — Cloudflare R2, AWS S3, or self-hosted MinIO?
4. **Do you want to monetize from day 1?** — affects whether billing/plans are a launch blocker
5. **Do you want the Share feature at launch?** — if yes, the API endpoints need to be built
