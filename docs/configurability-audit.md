# Configurability Audit — Journal

**Purpose:** evidence log for the "make the system configurable from Settings/Admin instead of via code+deploy" initiative.
**Status:** in progress. Started 2026-08-26.
**Guiding principle:** *Code builds capabilities. Configuration controls the behavior of existing capabilities.*
**This file is documentation only.** No behavior change, no migrations, no schema change originates here.

> If a session runs out of context, a new session should read this file top-to-bottom and continue from "Open Questions".

---

## 0. System shape (baseline facts)

- Repo root: `avira-studio-v31-copy-23960b65/`
- Frontend: React + Vite → Vercel. ~43k LOC under `src/`.
- Backend: Supabase (Postgres + RLS + Auth + Storage + Edge Functions). No long-running compute.
- 45 migrations (`supabase/migrations/0001`–`0045`), 55 Edge Functions (`supabase/functions/`).
- Tenant isolation: single `tenant_id` column + RLS via `current_tenant_id()` (`0001_init.sql`). One and only boundary.
- Roles: `profiles.role` ∈ owner | admin | studio_manager | photographer | editor | album_manager | lead_coordinator.
- Project rules of record live in `CLAUDE.md` (album module iron rules, tenancy rules, public-page rules).

### Table inventory (40)

`tenants`, `profiles`, `app_settings`, `tenant_secrets`, `audit_logs`, `rate_limit_hits`, `notifications`,
`leads`, `events`, `staff_members`, `packages`, `discount_presets`,
`automations`, `event_automations`, `pending_automations`, `automation_runs`, `automation_message_logs`,
`google_calendar_accounts`, `event_calendar_syncs`, `staff_availability_requests`,
`ai_assistant_messages`,
Album module: `album_orders`, `album_versions`, `album_spreads`, `album_review_rounds`, `album_spread_decisions`,
`album_products`, `album_covers`, `album_addons`, `album_engraving_colors`, `album_engraving_fonts`,
`album_order_selections`, `album_order_addons`, `album_guide_content`, `album_guide_faq_items`,
`album_guide_cover_previews`, `album_guide_sketch_examples`, `album_guide_sketch_example_images`,
`print_access_links`, `print_access_events`.

---

## 1. Findings — Configuration layer

### 1.1 `app_settings` mechanism
- Flat key/value table, `UNIQUE(tenant_id, key)`, single text `value` column. Tenant-scoped via `current_tenant_id()`.
- Write path: `base44.entities.AppSetting.create/update()` (Base44-compat shim, `src/api/entities.js`).
- Role gate: owner/admin/studio_manager (`0018_admin_role_gated_writes.sql`).
- **~25 non-secret keys in use.** Secrets were correctly split out into `tenant_secrets` (`0019`), admin-only RLS.
- **No schema, no typing, no validation, no defaults registry, no audit of setting changes.** Every consumer
  re-implements its own parse + fallback. This is the single biggest structural weakness of the config layer.

### 1.2 Settings UI inventory — what IS already configurable today
`src/pages/Settings.jsx`, 10 tabs:
| Tab | Controls | Storage |
|---|---|---|
| workspace | tenant name, timezone, currency | `tenants` |
| users | invite/list/deactivate users, assign role | `profiles` + invite Edge Fns |
| contract | full master contract HTML (rich text) | `app_settings.defaultContractTerms` |
| pricing | packages, discount presets, staff rates, album catalog | `packages`, `discount_presets`, `staff_members`, `album_*` |
| team | staff roster CRUD + retroactive rate propagation | `staff_members` |
| templates | **8 WhatsApp message templates w/ variable substitution** | `app_settings` |
| integrations | Green API instance/URL, Google Calendar OAuth, bank details | `tenant_secrets`, `tenants` |
| notifications | alert phone, monthly backup email | `app_settings` |
| data | events backup PDF export | — |
| audit | audit log viewer (admin only) | `audit_logs` |

Also configurable: studio identity/branding/signature (`0021`), financial defaults incl. **`tenants.default_vat_percent`**
and deposit (`0037`, `FinancialDefaultsCard.jsx`), quiet hours (`QuietHoursCard.jsx`), bank transfer details (`0044`).

### 1.3 User-editable catalog tables
`packages`, `discount_presets`, `staff_members` (incl. `rates_by_role` JSONB), `album_products`, `album_covers`,
`album_addons` (+ `album_engraving_colors`/`_fonts`, `album_guide_*`). All edited from `PricingManagement.jsx`,
`StaffRatesEditor.jsx`, `AlbumCatalogSettings.jsx`, `AlbumGuideSettings.jsx`. Album catalog ships with **no seed data** by design.

### 1.4 `src/lib/` config-like constants — and their duplication status
| File | Nature | Duplicated? |
|---|---|---|
| `app-params.js` | genuine code (URL/localStorage param plumbing) | no |
| `staffRates.js` | genuine code (rate lookup helper; rates are DB) | no |
| `staffRoles.js` | **hardcoded role enums + role→team-slot map** | **YES ×3**: frontend const + DB CHECK constraint (`0001`) + hand-mirrored `supabase/functions/_shared/staffRoles.ts` |
| `permissions.js` | **hardcoded role hierarchy** (OWNER_ONLY/ADMIN/CREW) | **YES ×3**: frontend + `profiles.role` CHECK + `_shared/permissions.ts` + inline in RLS policies |
| `productionQuestionnaireFields.js` | **hardcoded ~20-question field list** | **YES ×2**: frontend + `_shared/productionQuestionnaireFields.ts` |
| `defaultContractTerms.js` | 310-line hardcoded Hebrew HTML bootstrap default | **YES**: also lives in `app_settings.defaultContractTerms` (fallback-vs-live drift) |
| `packageDetails.js` | 4 static Hebrew package description blocks | no DB equivalent (cosmetic) |
| `financialCalculations.js` | **VAT_RATE=1.18, DROR_EDITOR_COST=1200, profit thresholds 25%/35%** | **YES for VAT**: `tenants.default_vat_percent` exists (`0037`) but the hardcoded constant still shadows it in places |

> The **Deno/React module split** is the root cause of the ×2 mirroring: Edge Functions cannot import from `src/lib/`,
> so `_shared/*.ts` are hand-maintained copies. Any "make X configurable" plan must solve *this* or it will just
> add a fourth copy.

### 1.5 Environment configuration
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_OAUTH_CLIENT_ID`, legacy `VITE_BASE44_*`.
- Edge: `SUPABASE_*`, `GOOGLE_OAUTH_CLIENT_ID/SECRET/STATE_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
  `AUTOMATION_ENGINE_CRON_SECRET` (+ per-webhook cron secrets).
- **Correctly placed.** Legacy `GREEN_API_*` / `MORNING_API_*` env vars are vestigial — those moved to `tenant_secrets`.
- Verdict: nothing per-tenant is stuck in env vars. No action needed here.

## 2. Findings — Hardcoded business logic

### 2.1 Lead statuses — VERIFIED FIRST-HAND
- DB truth: `0001_init.sql:106` — `check (status in ('חדש','נשלחה הצעה','פולו-אפ','נסגר/חתימה','חוזה','לא רלוונטי'))` → **6 values**.
- Frontend truth: `src/components/leads/LeadFormDialog.jsx:13` — `STATUSES = [...]` → **5 values, omits `'חוזה'`**.
- **CONFIRMED DRIFT.** `sign-lead-public` writes `'חוזה'`; the edit dialog cannot select or restore it.
  `UnifiedSidePanel.jsx` special-cases `['חוזה','נסגר/חתימה']` to avoid regressing it. This bug exists *today*,
  independent of any configurability work.
- **Coupling breadth (measured):** 22 files contain hardcoded status literals, ~60 occurrences.
  Hot spots: `src/pages/Leads.jsx` (14), `supabase/functions/sync-lead-followups` (5),
  `UnifiedSidePanel.jsx` (5), `FollowUpReminderDialog.jsx` (4), `healthScore.jsx` (3),
  `RecentLeadsCard.jsx` (3), `LeadImageImportReviewDialog.jsx` (3), plus 5 Edge Functions and 3 migrations.
- What actually breaks if statuses become dynamic rows:
  1. ~20 `status === '<literal>'` business-logic branches (e.g. `=== 'נסגר/חתימה'` → triggers `syncLeadToEvent`).
  2. Two *semantic sets* that are re-derived ad hoc in several places: "closed" = {נסגר/חתימה, חוזה, לא רלוונטי},
     "contract-eligible" = {חדש, נשלחה הצעה, פולו-אפ}. **These sets are the real business rule, not the labels.**
  3. Status→color/badge maps in 3+ UI files.
  4. Dashboard counters / `Leads.jsx` filters / `healthScore.jsx` grouping.
  5. Edge Functions that *write* a specific status: `sign-lead-public`, `sync-lead-to-event`,
     `sync-all-signed-leads`, `fix-missing-event-for-lead`, `sync-lead-followups`.
  6. The DB CHECK constraint itself, and `0013_lead_status_automation.sql`.

> **Key architectural insight:** the code does not really depend on the *list* of statuses — it depends on a handful
> of *semantic predicates* (is-closed, is-contract-eligible, is-signed). Making labels configurable is cheap;
> making semantics configurable is where the risk lives.

### 2.2 Other status enums (all DB CHECK constraints, `0001_init.sql`)
| Column | Values | Coupling |
|---|---|---|
| `events.client_payment_status` | Paid / Partially Paid / Unpaid | ~38 refs across 9 files — 2nd most entangled |
| `events.album_status` | pending / sent | low, isolated (legacy simple marker, CLAUDE.md says don't touch) |
| `events.calendar_sync_status` | pending / success / failed | low, informational |
| `leads.package_choice` | **`'חבילה 1'..'חבילה 4'` — only 4 fixed slots** | blocks adding a 5th package without a migration |
| `automations.trigger_type` | days_after_proposal / days_after_event / status_based | engine-coupled |
| `automations.trigger_status` | proposal_sent / event_completed / album_pending | engine-coupled |
| `automation_runs.status`, `automation_message_logs.status`, `pending_automations.status` | internal | leave as code |

**`package_choice` is a notable find:** `packages` pricing is fully DB-driven and editable, but the *slot names*
are CHECK-constrained to exactly four Hebrew literals. A studio adding a 5th package needs a migration.

### 2.3 Roles & permissions — widest duplication in the codebase
- `profiles.role` (7 values) defined in: `0001_init.sql` CHECK + `src/lib/permissions.js` + `_shared/permissions.ts`
  + **~59 RLS policies across 16 migrations that spell out role names inline**.
- `staff_members.role` (4 values) defined in: `0001` CHECK + `src/lib/staffRoles.js` + `_shared/staffRoles.ts` + 4 RLS policies.
- Event team slots (photographer1/2, videographer, videographer2, editor): `src/lib/staffRoles.js`, **no DB constraint**,
  hand-duplicated inside `automation-engine/index.ts`.
- No Postgres ENUM type anywhere — all text + CHECK, so there is no single DDL object to change.
- **Conclusion for the plan: this is duplication, not a missing feature.** The correct fix is consolidation
  (one source of truth), NOT a "permissions builder" UI.

### 2.4 Hardcoded business constants worth attention
| Constant | Where | Owner would change? |
|---|---|---|
| VAT 18% (`VAT_RATE = 1.18`) | `src/lib/financialCalculations.js`, `src/lib/profitCalculations.js` | **YES** — and `tenants.default_vat_percent` already exists (`0037`). This is a **live duplicate source of truth**. |
| `DROR_EDITOR_COST = 1200` | `src/lib/financialCalculations.js` | **YES** — a named vendor's fixed fee hardcoded in app source |
| Profit color thresholds 35% / 25% | `financialCalculations.js`, `profitCalculations.js` | marginal — cosmetic only |
| Default deposit 500₪ | `FinancialDefaultsCard.jsx` fallback | already DB-driven (`tenants.default_deposit_amount`); constant is just a fallback |
| Automation default run time `'09:00'` | `automation-engine/index.ts` | maybe |
| Quiet hours | already DB-driven (`tenants.quiet_hours_*`, `_shared/automationGuards.ts`) | **already configurable — good precedent** |
| Contract terms + cancellation penalties | `defaultContractTerms.js` → overridden by `app_settings` | already configurable |
| Delivery SLA text (30/60 days) | `src/lib/packageDetails.js` | **YES** — but it's inside descriptive HTML, not a rule |
| Follow-up flip window (48h) | `0013_lead_status_automation.sql`, `sync-lead-followups` | **YES** — classic tunable |

### 2.5 Packages & pricing
- Pricing is **fully DB-driven** (`packages` table, edited in `PricingManagement.jsx`). No duplicate price source.
- `src/lib/packageDetails.js` holds only cosmetic default HTML descriptions — a fallback, not a competing truth.
- The only real blocker is the `leads.package_choice` 4-slot CHECK constraint (see 2.2).

## 3. Findings — Automations, conditions, templates

### 3.1 Data model
- `automations`: `type` (8 fixed values), `message_template`, `audience_type`, **`audience_config` JSONB**,
  `frequency`, `run_time`, `selected_staff_ids[]`, `filter_logic` (text, **unused/dead**).
- `event_automations`: `trigger_type` / `trigger_days` / `trigger_status` — **schema exists but NO Edge Function reads it. Dead table.**
- `pending_automations`: approval queue, used by only 2 of 8 types (questionnaire_reminder, payment_reminder).
- `automation_runs`, `automation_message_logs`: observability. Keep as code.

### 3.2 Engine architecture — the crux
`supabase/functions/automation-engine/index.ts` (~1315 lines) dispatches on `automation.type`:
- **7 hardcoded routines** (`runMonthlyStaffSummary`, `runDailyEventBrief`, `runQuestionnaireReminder`,
  `runPaymentReminder`, `runAlbumReminder`, `runQuestionnaireSend`, `runCustomStaffMessage`) — each 30–80 lines
  of compiled-in eligibility logic. Not tunable from the UI at all.
- **1 genuinely data-driven routine**: `type='custom'` → `runCustomAudienceMessage()` reads `audience_type` +
  `audience_config` and evaluates conditions dynamically (`0038_custom_audience_automations.sql`).

**This is the single most important finding of the audit: a working, production, data-driven automation path already exists.**

### 3.3 Extensibility ceiling (concrete)
Today, `audience_config.conditions` supports exactly 4 fields —
`client_payment_status`, `album_status`, `event_date_relative`, `event_month_year` — with ops
`eq` / `neq` / `before_today` / `after_today`, **ANDed only** (no OR).
- ✅ "Message all staff with role X" — no code needed.
- ✅ "Message couples whose event passed AND payment is Unpaid" — no code needed.
- ❌ **"When a lead has been in status פולו-אפ for 7 days, notify the manager" — requires code.**
  Missing: `lead_status` as a condition field, and any duration/"for N days" operator.
- ❌ Cannot retune the 7 fixed types (e.g. change `album_reminder`'s `album_status !== 'sent'` filter).
- ❌ No automation chaining.

### 3.4 Condition-logic duplication — CONFIRMED, and this is the real Phase 0
- **Same condition evaluation implemented twice**: `src/components/automations/CreateCustomAutomationModal.jsx`
  (builds the recipient *preview*) and `automation-engine/index.ts` (does the *live* run).
  Semantics do not diverge *yet*, but every new condition field must be added in both places or the preview lies
  to the user ("will send to 10" → actually sends to 8).
- `src/components/dashboard/DashboardAlerts.jsx` re-implements the "unpaid client" filter independently of
  the `payment_reminder` handler. Same semantics today, duplicated code.
- `supabase/functions/sync-lead-followups/index.ts` hardcodes the 48-hour "נשלחה הצעה → פולו-אפ" rule and is
  **completely outside the automations engine** — no UI, no config.
- ✅ **Good precedent that already works**: quiet hours live in `supabase/functions/_shared/automationGuards.ts`
  and are shared by the engine *and* `approve-pending-automation`. Single source of truth, no drift.
  **This is the pattern to copy.**

### 3.5 Templates
- DB-editable: ~5 `template_*` keys in `app_settings` (questionnaire reminder, final link, raw link,
  album graphic, album couple) + the `message_template` column on each automation row.
- Hardcoded in Edge Function source: fallback templates + Hebrew fragments in `send-questionnaire-reminders`,
  `automation-engine` (`DEFAULT_TEMPLATE` for album_reminder), `send-album-sketch`, `send-to-couple`,
  `send-to-editor`, `daily-event-brief`.
- **Two incompatible substitution syntaxes coexist**: `renderTemplate()` in the engine uses `{key}`;
  the `app_settings` templates use `$key` replaced by hand in each function. No shared renderer.
  A user editing a template in the wrong syntax gets silent non-substitution.
- Notification wording lives in a **Postgres trigger** (see §3b) — a third mechanism.

---

## 3c. Cross-cutting root cause

Three separate mirroring problems all stem from one thing: **`src/lib/*.js` (browser) and
`supabase/functions/_shared/*.ts` (Deno) cannot share modules**, so `staffRoles`, `permissions`, and
`productionQuestionnaireFields` are hand-copied. Any plan that adds new shared business vocabulary must
either (a) put it in the DB and have both sides read it, or (b) accept a 4th copy. **(a) is the only scalable answer.**

## 3b. Findings — Notifications (audited directly, 2026-08-26)

- `app_settings` is a **flat key/value table** (`key`, `value`), read via the Base44-compat shim
  `base44.entities.AppSetting.filter({ key })`. Not JSON-schema'd, not typed, no validation layer.
  Example keys: `notification_phone_number`, `backup_email` (`src/components/settings/NotificationsSettingsTab.jsx`).
- **Only ONE notification type exists: `contract_signed`** (`0026_notifications_trigger.sql`). v1 scope was an
  explicit user choice among contract-signed / payment-received / questionnaire-filled / new-lead.
- **The notification's title and body text are hardcoded inside a Postgres trigger function**
  (`public.trigger_contract_signed_notification`, `0026`). This is the most deploy-hostile possible location
  for message content: changing the wording requires a migration.
- The trigger also hardcodes the project URL (`https://yzurelfhjkgqrluifszz.supabase.co/...`) and a cron-secret
  placeholder that must be pasted in manually post-deploy. Not tenant-portable.
- `NotificationsSettingsTab.jsx` configures only *where* alerts go (phone, backup email) — **not** which events
  produce a notification, nor the wording. Adding "notify me when a payment arrives" = new migration + new trigger.
- Notification visibility is role-gated in RLS to `owner/admin/studio_manager` (hardcoded role list in the policy).
- **Assessment:** high-value, low-risk configurability candidate. Notification *types* + *recipients* + *wording*
  are exactly the kind of thing a studio owner will want to change, and nothing security-critical depends on them.

## 4. Source of Truth map

| Domain | Sources today | # | Verdict |
|---|---|---|---|
| Pricing / packages | `packages` table only (`packageDetails.js` = cosmetic fallback) | 1 | ✅ clean |
| Album catalog | `album_products`/`album_covers`/`album_addons` + snapshots on orders | 1 | ✅ clean (snapshot pattern is correct) |
| Staff & rates | `staff_members` (+ `rates_by_role` JSONB) | 1 | ✅ clean |
| Quiet hours | `tenants.quiet_hours_*` → `_shared/automationGuards.ts` | 1 | ✅ clean — **reference pattern** |
| Studio identity / bank | `tenants` (`0021`, `0044`) | 1 | ✅ clean |
| Integration secrets | `tenant_secrets` (`0019`) | 1 | ✅ clean |
| **VAT** | `tenants.default_vat_percent` (`0037`) **+** `VAT_RATE=1.18` in `financialCalculations.js` **+** `profitCalculations.js` | **3** | 🔴 **money-affecting duplicate** |
| **Lead statuses** | `0001` CHECK **+** `LeadFormDialog.STATUSES` **+** ~60 inline literals in 22 files | **3+** | 🔴 **drifted today** (`'חוזה'` missing from UI) |
| **Roles (profiles)** | `0001` CHECK **+** `src/lib/permissions.js` **+** `_shared/permissions.ts` **+** ~59 inline RLS policies | **4** | 🔴 widest duplication; security-relevant |
| **Staff/team roles** | `0001` CHECK **+** `src/lib/staffRoles.js` **+** `_shared/staffRoles.ts` **+** inline in `automation-engine` | **4** | 🟠 |
| **Questionnaire fields** | `src/lib/productionQuestionnaireFields.js` **+** `_shared/productionQuestionnaireFields.ts` | **2** | 🟠 hand-mirrored |
| **Contract terms** | `defaultContractTerms.js` (bootstrap) **+** `app_settings.defaultContractTerms` (live) | **2** | 🟡 intentional, but no upgrade path for existing tenants |
| **Message templates** | `app_settings.template_*` (`$key`) **+** `automations.message_template` (`{key}`) **+** hardcoded fallbacks in ~6 Edge Fns **+** Postgres trigger text (`0026`) | **4 mechanisms, 2 syntaxes** | 🔴 |
| Package slots | `leads.package_choice` CHECK (4 fixed Hebrew literals) | 1 | 🟠 single source but not extensible |

## 5. Risks

**Critical**
- VAT computed from a hardcoded constant that shadows the per-tenant DB setting → wrong invoices/profit for any
  tenant not on 18%. Correctness bug *today*, not a future risk.
- Roles duplicated into ~59 RLS policies: any role change touched in only 3 of 4 places is a **security** drift,
  not a cosmetic one.

**High**
- Lead-status drift (`'חוזה'`) already causes an unreachable UI state.
- Making statuses fully dynamic would touch 22 files + 5 Edge Functions + a CHECK constraint + existing rows.
  Deleting/renaming a status with live leads pointing at it has no defined behavior today.
- Template syntax split (`{key}` vs `$key`): an owner editing the "wrong" template gets silent non-substitution
  and sends a literal `$couple_names` to a real customer.

**Medium**
- Frontend/backend condition duplication → automation *preview* can disagree with the *actual send*.
- `package_choice` CHECK blocks a 5th package; a migration is needed for a routine business change.
- Notification wording locked inside a Postgres trigger; also hardcodes the project URL (not tenant-portable).

**Low**
- `event_automations` is a dead table (referenced only in a comment in `automation-engine/index.ts:569`).
- `automations.filter_logic` column is dead.
- Profit color thresholds hardcoded (cosmetic only).

## 6. Decisions

- 2026-08-26: Audit-only session. No implementation, no migrations, no schema change.
- 2026-08-26: Confirmed the prior session's "don't build a generic no-code platform" stance. Evidence:
  a data-driven automation path (`type='custom'` + `audience_config`) **already exists and works in production**.
  The gap is its *condition vocabulary*, not its architecture.
- 2026-08-26: `_shared/automationGuards.ts` (quiet hours) is adopted as the reference pattern for all
  shared business predicates — DB-stored config + one shared evaluator used by every caller.

## 6b. Lead-status registry design (validated against call sites, 2026-08-26)

User decision: statuses become tenant-scoped rows carrying **semantic tags**; code checks tags, not Hebrew strings.

**My initial predicate hypothesis was wrong in two places. Corrected, empirically:**
- ❌ **`is_signed` — DO NOT BUILD.** Signedness is already correctly modeled as `leads.signed_at`.
  `ContractPage.jsx:83-87` deliberately abandoned status-based signed-detection; `0026` confirms both signing
  paths set `signed_at`; `sync-lead-to-event/index.ts:9` documents `'חוזה'` as deliberately *blocked* from event
  creation. An `is_signed` tag would re-introduce a bug that was already fixed.
- ❌ `is_contract_eligible` has **no call site**. The real thing is the inverse guard at
  `UnifiedSidePanel.jsx:297` → model as **`is_post_contract`** on {חוזה, נסגר/חתימה}.
- ✅ `is_closed` → rename to **`is_terminal`** ({נסגר/חתימה, לא רלוונטי}). Only 2 sites: `Leads.jsx:396,407`.
- ✅ NEW predicate found: **`counts_as_stale_candidate`** ({חדש, נשלחה הצעה}) —
  `healthScore.jsx:146,237`, `ActionsTab.jsx:130`. Deliberately excludes פולו-אפ.

**Key structural insight:** most status sites are *write destinations*, not predicates. Free booleans are the
wrong shape for those. Model **6 singleton roles** (exactly one status per tenant per role):

| role | current value | notable sites |
|---|---|---|
| `default` | חדש | `0001:106`, `LeadCSVImportDialog.jsx:95`, `LeadFormDialog.jsx:28/65/76`, `Leads.jsx:642+` |
| `on_contract_sent` | נשלחה הצעה | `UnifiedSidePanel.jsx:299`, `sync-lead-followups:34` |
| `on_followup_due` | פולו-אפ | `sync-lead-followups:33`, `FollowUpReminderDialog.jsx:30` |
| `on_public_sign` | חוזה | `sign-lead-public:37` |
| `won` (event-eligible) | נסגר/חתימה | 11 sites incl. `sync-lead-to-event:33`, `sync-all-signed-leads:29`, `fix-missing-event-for-lead:22` |
| `lost` | לא רלוונטי | `cancel-event/index.ts:48` |

**Schema decision:** `leads.status` **stays a text column** (denormalized label mirror). Add
`leads.status_code` + composite FK `(tenant_id, status_code) → lead_statuses(tenant_id, code)` ON DELETE RESTRICT,
plus a bidirectional mirror trigger. Rationale: all ~60 legacy read sites and 5 Edge Functions keep working
unchanged; rename becomes a one-row update instead of rewriting every lead. The composite FK **replaces and is
strictly stronger than** the `0001:106` CHECK (it also enforces tenant scoping, which CHECK never did).

**Deno/React sharing solved by making predicates data, not code:** a `leads_with_status_flags` view
(leads ⋈ lead_statuses). Both the browser and Edge Functions query the view. A 4th hand-mirrored copy becomes
structurally impossible. `color_token` stores a token, never a Tailwind class string (JIT purge + injection).

**Product question surfaced, deliberately NOT auto-fixed:** `'חוזה'` is currently *not* exempt from the dormant/
no-contact-48h nudge (`Leads.jsx:396,407`), so a lead awaiting studio confirmation still gets nagged. Preserve
today's behavior; ask the user separately rather than smuggling a behavior change into a refactor.

## 7. Open questions

1. Lead statuses: does the owner want to genuinely **add/remove** statuses, or mainly **rename/recolor/reorder**?
   The answer changes the design from "semantic-tag registry" (low risk) to "fully dynamic" (high risk).
2. Is adding a 5th/6th package a real business need? (Determines whether the `package_choice` CHECK is dropped.)
3. Which notification types are actually wanted beyond `contract_signed`?
4. Should the 48h follow-up window (`sync-lead-followups`) become a setting, or fold into the automations engine?
5. Is the production questionnaire ever expected to change per-studio, or is it a fixed Avira artifact?
