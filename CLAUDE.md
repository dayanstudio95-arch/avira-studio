# CLAUDE.md

Guidance for any Claude/AI session working in this repository.

## Project shape (context for every rule below)

- Frontend: React + Vite, deployed to Vercel. Backend: Supabase (Postgres +
  RLS + Auth + Storage + Edge Functions). No long-running server compute
  anywhere — Edge Functions are capped at ~2s CPU / 150s idle / 400s
  wall-clock. Design around that constraint; don't propose background workers,
  queues, or anything that assumes a persistent server process.
- Multi-tenancy: every tenant-scoped table has a `tenant_id` column + an RLS
  policy gated by `current_tenant_id()` (defined in `0001_init.sql`). This is
  the project's one and only tenant-isolation boundary — never invent a
  parallel concept (`workspace_id`, `org_id`, etc.) for a new feature; reuse
  `tenant_id`.
- Role model: `profiles.role` (`owner | admin | studio_manager | photographer
  | editor | album_manager | lead_coordinator`). Role-based authorization is
  enforced at two layers that must never drift apart: RLS policies (DB layer,
  the real security boundary) and frontend route/UI gating (`App.jsx`,
  `src/lib/permissions.js`, `Layout.jsx`'s `scopedNavItemsByRole`) — UI hiding
  alone is never sufficient, RLS must independently enforce the same rule.
- Public/no-login pages (`/contract/:leadId`, `/questionnaire/:id`, and now
  `/album/:token`) are real attack surface. Never trust client-supplied IDs
  as authorization — validate ownership/scope server-side (Edge Function +
  service-role client) on every request.

## Wedding Albums module — isolation, security, data-integrity rules

This module (album orders, sketch review, purchase wizard, print delivery —
see the "Wedding Albums module" section of the project's working plan for the
full design) is intentionally built as a **self-contained addition**, not a
refactor of anything existing. These rules govern it specifically:

### Isolation
- **Never touch the pre-existing simple album marker**: `events.album_status`,
  `events.album_sketch_link`, `events.album_reminder_sent`,
  `events.album_reminder_sent_at`, or `runAlbumReminder()` in
  `supabase/functions/automation-engine/index.ts`. This is a separate,
  already-shipped feature. The new module does not read from it, write to it,
  or attempt to consolidate with it. If a future pass ever wants to merge
  them, that is a deliberate, separately-scoped decision — not an incidental
  side effect of this module's code.
- New tables, new Storage bucket (`album-files`), new Edge Functions, new
  pages. Do not repurpose an existing table (e.g. the photography `packages`
  table) for album pricing even if it looks superficially similar — album
  pricing has its own catalog tables (`album_products`/`album_covers`/
  `album_addons`) because the existing `packages` table is tightly coupled to
  photography-specific columns.

### Multi-tenancy
- Every new table gets `tenant_id` + the standard `current_tenant_id()` RLS
  policy, with no exceptions. Admin/`album_manager`-only write tables (catalog
  tables, `print_access_links`) additionally get the EXISTS-subquery
  role-gated write policy pattern already established in
  `0018_admin_role_gated_writes.sql`.
- The public portal (`/album/:token`) and the print-shop download page never
  use a real Supabase session — they go through dedicated Edge Functions
  using a service-role client, scoped explicitly by the validated token's
  `tenant_id`/`album_order_id`, exactly like `get-lead-public` does today.

### Security
- **Portal tokens (`album_orders.portal_token_hash`,
  `print_access_links.token_hash`) are SHA-256 hashed at rest, never stored
  raw.** SHA-256 (deterministic) is used deliberately instead of bcrypt: these
  tokens must be looked up directly by hash value on every request, which a
  salted bcrypt hash cannot support. This is a stricter model than
  `/contract/:leadId`'s UUID-as-secret pattern — don't downgrade to that
  pattern for this module.
- Never log a raw token (URL, request body, or otherwise) server-side.
- Revocation must be real: `portal_token_revoked_at` /
  `print_access_links.revoked_at` must be checked on every lookup, not just
  at creation time.
- Rate-limit the public token-validation Edge Function the same way existing
  public endpoints do (`_shared/rateLimit.ts`'s `checkRateLimitForKey`).

### Data integrity
- **Snapshot every commercial selection.** `album_order_selections` and
  `album_order_addons` store the catalog item's name *and* price at the
  moment the couple selects it (`product_name_snapshot`,
  `product_price_snapshot`, etc.) — never join back to the live catalog table
  to compute a historical order's total. Editing a price in the catalog
  settings screen must never retroactively change any existing order.
- Enforce real constraints at the DB level, not just in the frontend form:
  `UNIQUE(tenant_id, album_order_id, version_number)`,
  `UNIQUE(tenant_id, version_id, sequence_number)`,
  `UNIQUE(review_round_id, spread_id)`, `check (total_amount >= 0)`,
  `check (base_price >= 0)`, `check (quantity > 0)`,
  `check (point_x between 0 and 100)`, `check (point_y between 0 and 100)`.
- Review/approval happens **once per order**, not once per physical album
  copy. "Family set (3 albums) vs. couple-only album (1 album)" is a
  **post-approval purchase-wizard choice** (an `album_products` row
  selection), not a pre-approval workflow fork. Do not reintroduce a
  per-physical-album review pipeline.

### Iron rules (do not silently change without asking the user)
- Payment in v1 is **manual bank transfer only**. Do not implement a real
  Green Invoice payment-form/webhook integration from memory — the exact API
  contract could not be verified against current docs (repeated fetch
  failures against Green Invoice's Apiary docs). If this is revisited, it
  needs a dedicated verification pass with either a real browser or the
  user's own Green Invoice developer-portal access first.
- Print-shop file delivery is a **client-side ZIP**, assembled in the print
  shop's own browser (e.g. via a streaming library like `client-zip`) — never
  build a server-side ZIP in an Edge Function; the CPU/wall-clock caps make
  that unreliable for 30-40+ full-resolution files.
- No watermark/preview compositing in v1 — Supabase Storage's Image
  Transformations only resize on read, they don't composite. Don't build a
  separate preview-generation pipeline unless explicitly asked.
  **Superseded for plain preview thumbnails, 2026-08-24 (explicitly asked):**
  the "one full-resolution file per spread serves both preview (via resize)
  and print" design doesn't work in practice — confirmed by calling
  Supabase's image-render endpoint directly, which returns `{"error":
  "InvalidRequest","message":"The source image file is too large to
  process"}` for every spread in a real order (this studio's real
  full-resolution wedding photography exports are consistently 25-30MB, all
  over Supabase's hard source-file-size cap on that endpoint — not a bug to
  patch, resize-on-read cannot work for this content at all). Fix, approved
  by the user as a deliberate exception to this rule: `album_spreads` now
  also gets a small JPEG `thumb_file_key`, generated **100% client-side**
  (browser canvas resize, `src/lib/imageCompress.js`) at upload time and
  lazily backfilled for legacy spreads on first admin view
  (`AlbumOrderDetail.jsx`'s `toggleExpandVersion`) — see
  `0043_album_spread_thumbnails.sql`. This is NOT a server-side
  pipeline/Edge Function/background compute, so it doesn't reintroduce the
  CPU/wall-clock constraints this rule protects against. The original
  `file_key` is untouched and remains the sole source for print/full-res
  access. Watermark/preview *compositing* itself is still out of scope —
  this only changes how a plain (uncomposited) preview is produced.
- Revision rounds are never blocking. The first round is free; 2nd+ rounds
  are shown as informational cost only — never gate the couple from
  submitting another round or reaching the purchase wizard over an unpaid
  revision fee, unless the user explicitly changes this decision.
- Catalog pricing (`album_products`/`album_covers`/`album_addons`) ships with
  **no seed data**. The user fills in real prices via the admin UI — don't
  invent placeholder prices in a migration.
