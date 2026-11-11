# Kato — AI Software Factory request intake

Kato is the conversational intake and demand-management portal for the Cassava Technologies AI Software Factory. Business users from any OpCo describe a need in plain language. Kato's AI business analyst asks follow-up questions and builds a standardised Business Requirements Document (BRD) live beside the chat, including a mandatory USD financial impact on revenue, EBITDA and cash flow.

On submission Kato assesses each request's business value and the development route it should take (Autonomous, AI-assisted or Human-led), and publishes the BRD to Confluence. IT reviewers then triage, approve or reject requests in Kato, and an approval creates the Jira Epic or Story automatically.

```
 Requester ──chat──▶ /request ──▶ /api/chat ──redact──▶ LLM (Claude / OpenAI)
                        ▲                │  updateBRD tool
                        │ live BRD       ▼
                        └──────── FeatureRequest.draftBrd (Postgres)
                                         │ submit → BRDDocument v1 (immutable)
                                         ├──▶ BullMQ ──▶ worker: value + route assessment (LLM + fixed rules)
                                         └──▶ BullMQ ──▶ worker: publish BRD page ──▶ Confluence (system of record)
 IT reviewer ──▶ /admin/dashboard ── start review → approve (choose route) / reject
                                         │ approve (one transaction)
                                         ▼
                                  JiraSyncTask (outbox) ──▶ BullMQ ──▶ worker ──▶ Jira REST v3
                                                              │ retries (exp. backoff)
                                                              └─▶ DLQ + admin alert + retry button
```

## Deliverables map

| # | Deliverable | Location |
|---|---|---|
| 1 | Prisma data model (`User`, `FeatureRequest`, `BRDDocument`, `ApprovalLog`, `JiraSyncTask`, plus `ConversationMessage` and `Notification`) | [prisma/schema.prisma](prisma/schema.prisma), [migrations](prisma/migrations) |
| 2 | Kato system prompt (persona, BRD rules, follow-up logic) | [src/lib/kato-prompt.ts](src/lib/kato-prompt.ts) |
| 3a | Chat page with live BRD split view | [src/app/request/page.tsx](src/app/request/page.tsx), [kato-workspace.tsx](src/app/request/kato-workspace.tsx) |
| 3b | Admin demand management and approval dashboard | [src/app/admin/dashboard/page.tsx](src/app/admin/dashboard/page.tsx), [admin-actions.tsx](src/app/admin/dashboard/admin-actions.tsx) |
| 4 | Jira integration service and resilience queue | [src/lib/jira.ts](src/lib/jira.ts), [src/lib/queue.ts](src/lib/queue.ts), [src/worker/index.ts](src/worker/index.ts) |
| 5 | Production Dockerfile and docker-compose | [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml) |

Value, route and Confluence: assessment engine [src/lib/assessment.ts](src/lib/assessment.ts), route metadata [src/lib/routes.ts](src/lib/routes.ts), Confluence publisher [src/lib/confluence.ts](src/lib/confluence.ts).

Supporting modules: lifecycle state machine [src/lib/lifecycle.ts](src/lib/lifecycle.ts), BRD schema and completeness [src/lib/brd.ts](src/lib/brd.ts), secret/PII redaction [src/lib/redact.ts](src/lib/redact.ts), SSO and role hydration [src/lib/auth.ts](src/lib/auth.ts).

## Key design decisions

- **The BRD is structured data, not generated prose.** The LLM fills a Zod-typed BRD via an `updateBRD` tool call. The client merges streamed tool input, including partial input, so the preview updates while Kato is still typing. Submission validates against a strict schema and freezes an immutable, hashed `BRDDocument` version.
- **Redaction before anything else.** `/api/chat` redacts passwords, API keys, JWTs and bearer tokens, connection-string credentials, private keys, Luhn-valid card numbers and SA ID numbers before the message is persisted or sent to the LLM. The stored "raw" transcript is therefore the *redacted* transcript, because storing secrets in an immutable log would make them impossible to purge. The UI tells the user when something was removed.
- **Append-only audit at the database level.** Migration `0002_audit_immutability` adds triggers that block `UPDATE`, `DELETE` and `TRUNCATE` on `ConversationMessage`, `BRDDocument` and `ApprovalLog`. Every state change, comment and Jira payload/response is written to `ApprovalLog`.
- **Safe state transitions.** `DRAFT → SUBMITTED → UNDER_IT_REVIEW → APPROVED | REJECTED`, enforced with compare-and-set updates so two reviewers can't decide on the same request. Rejection requires a reason (at least 10 characters). Reviewers can't decide on their own requests unless `KATO_ALLOW_SELF_APPROVAL=true`.
- **Jira resilience: outbox, queue, DLQ.**
  - The `JiraSyncTask` row commits in the same transaction as the approval.
  - The BullMQ job carries only the task id and uses `jobId` for deduplication.
  - Transient failures (5xx, 429, network errors) retry with exponential backoff, about 1 hour over 8 attempts.
  - Permanent 4xx errors go straight to the DLQ. Dead-lettered tasks alert staff and show a **Retry Jira sync** button.
  - A reconciler re-enqueues tasks that never reached Redis.
  - Before creating an issue, the worker searches by the `kato-<n>` label, so a retry after a timed-out create never duplicates the issue.

## Financial impact, value assessment and development route

**Financial impact is mandatory.** A BRD can't be submitted until it states the annual USD effect on all three lenses (revenue growth, EBITDA and operating cash flow), with at least one non-zero, plus how the figures were calculated and the requester's confidence. Kato helps the requester quantify: it asks for the drivers (volumes, hours saved, ARPU, DSO days and so on), does the arithmetic, converts local currency to USD with a recorded FX rate, and errs low.

**Assessment runs automatically after submission** (queue `kato-assessment`). An LLM acting as a Cassava finance and delivery assessor returns structured evidence:
- its own conservative revenue, EBITDA and cash-flow estimates, a credibility rating for the requester's figures, value drivers, assumptions and questions for the sponsor
- scores from 1 to 5 for requirement clarity, testability, scope, integrations, reversibility and pattern familiarity, plus risk flags (moves money, personal or regulated data, regulatory commitment, production infrastructure, safety-critical)

Kato then applies **fixed, auditable rules** in `assessment.ts`:
- **Value score (0–100):** 60% magnitude (log scale of the larger of EBITDA and cash flow, $25k → 0, $10M → 100), 25% strategic alignment, 15% evidence quality.
- **Autonomy score (0–100):** weighted average of the six criteria.
- **Route:** Autonomous at a score of 75 or more, AI-assisted at 50 or more, otherwise Human-led. Then the guardrails apply:
  - Any risk flag caps the route at AI-assisted.
  - Safety-critical work, or regulated money movement, is always Human-led.
  - Requirement clarity of 2 or less is always Human-led.

Thresholds are configurable. Assessments are versioned and immutable. Approval is blocked until an assessment completes (`KATO_REQUIRE_ASSESSMENT`). Reviewers choose the final route at approval, and overriding the recommendation needs a recorded reason. The route goes onto the Jira issue as a `route-*` label and into its description.

The dashboard shows open and approved pipeline EBITDA, requests eligible for the autonomous route, stated vs assessed figures for each request, and filters and sorts by route, value score and EBITDA.

## Confluence (system of record for BRDs)

- Each submitted request gets one page, `KATO-00042 · <title>`, in `CONFLUENCE_SPACE_KEY` (optionally under `CONFLUENCE_PARENT_PAGE_ID`).
- The page is regenerated on every change: submission, assessment, approval or rejection, and the Jira key. Confluence page history therefore mirrors the request's lifecycle.
- Each page carries a **Page Properties** macro (reference, status, OpCo, sponsor, USD impact, value score, route, Jira link). Build a portfolio view with a Page Properties Report filtered on the label `kato-brd`.
- Publishing goes through the `kato-confluence-sync` queue with retries and a dead-letter queue. Dead-lettered publishes alert staff, and the dashboard offers **Retry Confluence publish**.
- Jira issues get a remote link to the Confluence page, and requesters see the link once their request is submitted.
- Confluence uses the Jira base URL (`/wiki`) and credentials unless you override them. The service account needs permission to create and edit pages in the space.

## Local development

```bash
cp .env.example .env          # set ANTHROPIC_API_KEY, KATO_DEV_LOGIN=true, KATO_ADMIN_EMAILS=you@cassava.tech
docker compose up -d postgres redis
npm install
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
npm run worker                # second terminal
```

With `KATO_DEV_LOGIN=true` (ignored in production), sign in with any email. Use an address listed in `KATO_ADMIN_EMAILS` to see the admin dashboard.

## Full stack in Docker

```bash
cp .env.example .env   # fill in secrets
docker compose up --build
```

This runs `postgres`, `redis` (AOF, `noeviction`), a one-shot `migrate`, `app` on :3000 and `worker`.

## SSO configuration

- **Azure AD / Entra ID:**
  - Register a web app with redirect URI `https://<host>/api/auth/callback/azure-ad`.
  - Add the `groups` optional claim to the ID token and grant the `User.Read` permission.
  - Kato calls Microsoft Graph `/me` for `department`, `companyName` and `jobTitle` when the token doesn't include them.
  - Users in more than 200 groups trigger group overage. Assign app roles instead, or limit the claim to groups assigned to the app.
- **Okta:**
  - Create an OIDC web app with redirect URI `https://<host>/api/auth/callback/okta`.
  - Add `groups`, `department` and `organization` claims to the ID token.
- **Roles:** set `KATO_ADMIN_GROUPS` and `KATO_REVIEWER_GROUPS`, using group object IDs for Azure or group names for Okta. Roles are re-derived from SSO on every sign-in.
- **OpCo:** derived from `companyName`/`organization`. Adjust the matching rules in `resolveOpco` (`src/lib/auth.ts`).

## Jira configuration

- Create a service account and API token. Set `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` and `JIRA_PROJECT_KEY`.
- **Field mapping:** `JIRA_CUSTOM_FIELDS` maps Kato fields to custom fields. Example: `{"opco":"customfield_10071:option","sponsor":"customfield_10072","katoUrl":"customfield_10074"}`. The `:option` suffix is for single-select fields.
- **Priority:** derived from impact and urgency, using the rounded-up average of the two (`JIRA_PRIORITY_MAP`). Set `JIRA_SET_PRIORITY=false` if the project's create screen has no Priority field.
- **Epic Name:** older company-managed projects need it; set `JIRA_EPIC_NAME_FIELD`.
- **Back-link:** each issue gets a remote link back to the Kato record and a description in Atlassian Document Format (ADF).

## Deploying to Azure

The Bicep templates and scripts in [infra/](infra/README.md) build complete production and dev environments on Azure Container Apps. GitHub Actions runs CI on every pull request and deploys every merge to `main`: dev first, then production after approval (see [CI/CD with GitHub Actions](infra/README.md#cicd-with-github-actions)).

## Deploying to Kubernetes / Azure Container Apps (general notes)

- Build two images from one Dockerfile: `--target app` and `--target worker`.
- Run `npx prisma migrate deploy` from the worker image as a pre-deploy Job (Kubernetes) or init job (Azure Container Apps).
- The app is stateless; scale it on HTTP. Scale the worker on queue depth (KEDA Redis scaler). Expose `/api/health` for probes.
- Use managed Postgres (Azure Database for PostgreSQL Flexible Server) and Redis with persistence, and set `maxmemory-policy noeviction`.
- Inject secrets from Key Vault or External Secrets. Set `NEXTAUTH_URL` and `KATO_PUBLIC_URL` to the public host.

## Suggested next steps

- Per-user rate limiting on `/api/chat`, and an in-app notification inbox (the data is already in `Notification`).
- A Bull Board view of the DLQ for operators.
- Unit tests for `redact.ts`, `brd.ts` completeness, `decideRoute`, `scoreValue` and `derivePriority`, plus integration tests for the approve → Jira and submit → Confluence paths against mocked Atlassian APIs.
- Calibrate the value-score bands and autonomy thresholds with Finance and Engineering using the first few months of assessments.
- Decide on data residency for the LLM provider. Kato never sends credentials, but BRDs may contain commercially sensitive content.
