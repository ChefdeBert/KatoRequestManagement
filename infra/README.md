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
| Release the current commit | `infra/scripts/release.sh prod` |
| Change settings or sizing | Edit the `.bicepparam` file, then `KATO_DEPLOY_APPS=true KATO_IMAGE_TAG=<current tag> infra/scripts/deploy.sh prod` |
| Rotate an API key | `infra/scripts/set-secrets.sh prod`, then restart the app and worker revisions |
| App logs | `az containerapp logs show -n kato-app -g ct-hq-kato-ai --follow` |
| Worker logs | `az containerapp logs show -n kato-worker -g ct-hq-kato-ai --follow` |

**Release order.** `release.sh` always migrates before rolling out new code. Keep migrations backwards-compatible with the previous release, because old replicas keep serving until the new revision is ready.

## Known gaps

- **No Front Door or WAF.** The app is exposed directly through Container Apps ingress with a managed certificate. Add Front Door Premium with WAF if Cassava's security policy requires it.
- **Data plane open to the internet.** Key Vault and ACR have public endpoints, protected by RBAC. This keeps the scripts working from a laptop. Postgres and Redis are private only.
- **The app uses the Postgres admin login.** For least privilege, create a `kato_app` role limited to DML on schema `public`, and point `database-url` at it. Keep the admin login for the migration job only.
- **No alerts yet.** Dead-lettered jobs already notify staff in-app. Still worth adding: restart-count and replica-count alerts on both apps, and Postgres CPU and storage alerts.
- **Untested.** These templates haven't yet been run against Azure. Run `deploy.sh dev --what-if` first.
