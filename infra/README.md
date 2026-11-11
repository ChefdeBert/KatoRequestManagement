# Kato on Azure — infrastructure as code

The Bicep files here create a complete Kato environment in one resource group. Both environments live in subscription **ct-hq-serviceshub** (`2398a4bc-4430-4c40-8d53-1339ee04ca2c`):

| Environment | Resource group | Parameters |
|---|---|---|
| Production | `ct-hq-kato-ai` (already created) | [prod.bicepparam](prod.bicepparam) |
| Dev | `ct-hq-kato-ai-dev` (created by `deploy.sh dev`) | [dev.bicepparam](dev.bicepparam) |

## What gets created

| Resource | Production | Dev |
|---|---|---|
| Virtual network | `10.60.0.0/16`: Container Apps subnet `/23`, Postgres subnet `/28`, private endpoint subnet `/27` | `10.61.0.0/16` |
| NAT gateway and static public IP | Yes: one outbound IP for Atlassian and Anthropic allowlists | No |
| Container Apps environment | Workload profiles, VNet-integrated, zone-redundant | Not zone-redundant |
| `kato-app` | 1 vCPU / 2 GiB, 2–6 replicas, scales at 50 concurrent requests | 0.5 vCPU / 1 GiB, 1–2 replicas |
| `kato-worker` | 0.5 vCPU / 1 GiB, exactly 1 replica | same |
| `kato-migrate` job | Runs `prisma migrate deploy`, started by `release.sh` | same |
| PostgreSQL Flexible Server 16 | D2ds_v5, 128 GB auto-grow, zone-redundant HA, 35-day geo-redundant backups, private access only | B2s, 32 GB, no HA, 7-day backups |
| Azure Managed Redis | Balanced B1, HA, AOF persistence, `NoEviction`, non-clustered, private endpoint | Balanced B0, no HA, no persistence |
| Key Vault | RBAC, purge protection | RBAC |
| Container Registry | Standard | Basic |
| Log Analytics | 90-day retention | 30-day retention |
| Managed identity | Pulls images from ACR and reads Key Vault secrets | same |

Bicep writes `database-url`, `redis-url` and `postgres-admin-password` into Key Vault. You add the API keys yourself with `set-secrets.sh`. The apps read every secret as a Key Vault reference, so no secret appears in the Bicep files, parameters or deployment history.

## Prerequisites

- **Azure CLI 2.60 or later**, with the Container Apps extension. Your machine has 2.52, which predates `.bicepparam` support:
  ```bash
  az upgrade
  az extension add -n containerapp --upgrade
  az bicep install
  ```
- **Owner** on the resource group (or Contributor plus Role Based Access Control Administrator), because the templates create role assignments. You also need to be able to create resource groups in the subscription for dev.
- **Resource providers.** A new subscription needs these registered once:
  ```bash
  for p in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.Cache Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Network Microsoft.ManagedIdentity; do az provider register -n $p --subscription 2398a4bc-4430-4c40-8d53-1339ee04ca2c; done
  ```
- **Region availability.** Check that Azure Managed Redis is offered in South Africa North for the subscription. If not, set `redisLocation` in the parameter file; the private endpoint still connects it to the VNet.

## First deployment

Run all commands from the repository root. Each step works the same with `dev` in place of `prod`.

**1. Log in to the right tenant and subscription.**

```bash
az login
```

**2. Deploy the infrastructure (phase 1).** This creates everything except the container apps. Postgres and Redis take 10–20 minutes. To preview changes first, add `--what-if`.

```bash
infra/scripts/deploy.sh prod
```

**3. Register Kato in Entra ID.** Using the `entraRedirectUri` output from step 2:
- Create a web app registration with that redirect URI. For dev, add the dev URI to the same registration.
- Add the `groups` claim, limited to groups assigned to the application.
- Grant the `User.Read` permission.
- Create a client secret.
- Put the client ID and the object IDs of the admin and reviewer groups into the parameter file, replacing every `'TODO…'` value. `deploy.sh` refuses to deploy the apps while any remain.

**4. Add the secrets.** Run this yourself. Values are typed at hidden prompts; `nextauth-secret` is generated for you.

```bash
infra/scripts/set-secrets.sh prod
```

**5. Build and release.** This builds both images inside ACR (no local Docker needed), creates the apps, runs the migrations and restarts the worker. It prints the URL at the end.

```bash
infra/scripts/release.sh prod
```

**6. Custom domain (production).**
- Create these DNS records:
  - `CNAME kato` → `kato-app.<defaultDomain>`
  - `TXT asuid.kato` → the value from `az containerapp show -n kato-app -g ct-hq-kato-ai --query properties.customDomainVerificationId -o tsv`
- Then bind the domain:

```bash
az containerapp hostname add -n kato-app -g ct-hq-kato-ai --hostname kato.cassava.tech
```

```bash
az containerapp hostname bind -n kato-app -g ct-hq-kato-ai --hostname kato.cassava.tech --environment cae-kato-prod --validation-method CNAME
```

- Find the certificate name with `az containerapp env certificate list -n cae-kato-prod -g ct-hq-kato-ai --managed-certificates-only -o table`.
- Set `customDomain` and `customDomainCertificateName` in `prod.bicepparam`, and run `release.sh prod` again. This updates `NEXTAUTH_URL` and `KATO_PUBLIC_URL`, and keeps the binding on later deploys.
- Add `https://kato.cassava.tech/api/auth/callback/azure-ad` to the app registration.

**7. Allowlist the outbound IP.** If Cassava's Atlassian site restricts IP addresses, allowlist the `outboundIp` output.

## Day-to-day

| Task | Command |
|---|---|
| Release the current commit | Merge to `main` (pipeline), or `infra/scripts/release.sh prod` by hand |
| Change settings or sizing | Edit the `.bicepparam` file, then `KATO_DEPLOY_APPS=true KATO_IMAGE_TAG=<current tag> infra/scripts/deploy.sh prod` |
| Rotate an API key | `infra/scripts/set-secrets.sh prod`, then restart the app and worker revisions |
| App logs | `az containerapp logs show -n kato-app -g ct-hq-kato-ai --follow` |
| Worker logs | `az containerapp logs show -n kato-worker -g ct-hq-kato-ai --follow` |

**Release order.** `release.sh` always migrates before rolling out new code. Keep migrations backwards-compatible with the previous release, because old replicas keep serving until the new revision is ready.

## CI/CD with GitHub Actions

Two workflows live in [.github/workflows](../.github/workflows):

| Workflow | Runs on | What it does |
|---|---|---|
| [ci.yml](../.github/workflows/ci.yml) | Every pull request, and as stage 1 of Deploy | <ul><li>Installs dependencies and validates the Prisma schema.</li><li>Applies every migration to a clean PostgreSQL 16, and fails if `schema.prisma` has changes with no migration.</li><li>Checks the audit tables reject `TRUNCATE`.</li><li>Builds the web app and worker, and runs the TypeScript typecheck.</li><li>Compiles and lints the Bicep and ShellChecks the scripts.</li><li>Builds both Docker images.</li></ul> |
| [deploy.yml](../.github/workflows/deploy.yml) | Every push to `main` (except docs-only changes), or **Run workflow** | <ul><li>CI.</li><li>**dev:** builds the images in the dev registry, migrates, rolls out and smoke-tests.</li><li>**production:** waits for approval, copies the *same* images from dev (no rebuild), migrates, rolls out and smoke-tests.</li></ul> |

The smoke test checks three things: `/api/health` reports the app and database healthy, Entra ID sign-in is configured, and the email-only dev login is **not** enabled.

The pipeline signs in to Azure with OpenID Connect, so no Azure password or key is stored in GitHub. Each environment has its own Entra app registration, which trusts only the matching GitHub environment and has rights only on its own resource group.

### One-time setup

**1. Bootstrap each environment by hand once.** Follow [First deployment](#first-deployment) steps 1–5 for dev and for production. The pipeline can't do this part: `set-secrets.sh` asks for API keys at hidden prompts, and the `TODO` values must be filled in. Until they are, the deploy jobs stop with a message saying what's missing.

**2. Create the pipeline identities.** This needs permission to create app registrations and Owner on both resource groups. It creates the dev resource group if needed, and prints the values for step 3.

```bash
infra/scripts/setup-github-oidc.sh
```

**3. Configure GitHub.** In GitHub, go to **Settings** on the repository.
- **Environments:**
  - Create `dev` and `production`.
  - In each, set the environment variable `AZURE_CLIENT_ID`, and limit deployment branches to `main`.
  - On `production`, add **Required reviewers**.
- **Secrets and variables → Actions → Variables:**
  - Set `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`.
  - Optionally set `KATO_KV_ADMIN_GROUP_ID`, an Entra group that gets Key Vault Secrets Officer on every deploy.
- **Branches:** protect `main`. Require a pull request and the CI checks to pass.

### Notes

- **Releasing:** merge to `main`. Dev updates automatically, then production waits in the Actions tab for an approver.
- **Redeploying:** to redeploy an older commit, run **Deploy** from the Actions tab on that commit. Images already in a registry aren't rebuilt.
- **Pipeline permissions:** each identity has Contributor, Role Based Access Control Administrator and Key Vault Secrets Officer on its resource group. The production identity can also read the dev registry. RBAC Administrator is broad, so restrict it with an Azure role-assignment condition if your security team requires it.
- **Commit `package-lock.json`.** Until you do, CI warns and installs the latest matching versions, which can differ from what you tested.

## Known gaps

- **No Front Door or WAF.** The app is exposed directly through Container Apps ingress with a managed certificate. Add Front Door Premium with WAF if Cassava's security policy requires it.
- **Data plane open to the internet.** Key Vault and ACR have public endpoints, protected by RBAC. This keeps the scripts working from a laptop. Postgres and Redis are private only.
- **The app uses the Postgres admin login.** For least privilege, create a `kato_app` role limited to DML on schema `public`, and point `database-url` at it. Keep the admin login for the migration job only.
- **No alerts yet.** Dead-lettered jobs already notify staff in-app. Still worth adding: restart-count and replica-count alerts on both apps, and Postgres CPU and storage alerts.
- **Untested.** These templates haven't yet been run against Azure. Run `deploy.sh dev --what-if` first.
