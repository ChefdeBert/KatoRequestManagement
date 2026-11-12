# Kato on Azure — infrastructure as code

The Bicep files here create a complete Kato environment in one resource group. Both environments live in subscription **ct-hq-serviceshub** (`2398a4bc-4430-4c40-8d53-1339ee04ca2c`):

| Environment | Resource group | Parameters |
|---|---|---|
| Production | `ct-hq-kato-ai` (already created) | [prod.bicepparam](prod.bicepparam) |
| Dev | `ct-hq-kato-ai-dev` (created by `deploy.sh dev`) | [dev.bicepparam](dev.bicepparam) |

## What gets created

| Resource | Production | Dev |
|---|---|---|
| Virtual network | `10.181.108.0/24`: Container Apps `.0/25`, Postgres `.128/28`, private endpoints `.144/28` | `10.181.107.0/25`: Container Apps `.0/26`, Postgres `.64/28`, private endpoints `.80/28` |
| DNS | Central resolvers `10.181.251.196` and `.132`, and the central private DNS zones in `liq-hq-dnszones` | same |
| Outbound internet | Through the Virtual WAN hub firewall `southafricanorth-fw01`, so no NAT gateway is created. Optional with `enableNatGateway`. | same |
| Container Apps environment | **Internal only**: a private IP in the Kato VNet and no public endpoint. Workload profiles, zone-redundant. | Internal only, not zone-redundant |
| App DNS | A private zone for the environment's domain, with a wildcard record pointing at its private IP. It's created in `liq-hq-dnszones` and linked to the Kato VNet and both resolver VNets. | same |
| `kato-app` | HTTPS for employees on the corporate network. 1 vCPU / 2 GiB, 2–6 replicas, scales at 50 concurrent requests | 0.5 vCPU / 1 GiB, 1–2 replicas |
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
- **Network prerequisites, from the Networks team:**
  - **Virtual WAN connection.** Each Kato VNet needs a connection to `ct-vWAN-hub-southafricanorth`, made **before the first deployment**. That connection is what lets Kato reach the DNS resolvers `10.181.251.196` (`ct-private-dns-za`) and `10.181.251.132` (`ct-private-dns-uk`). Without it, nothing in the VNet can resolve names, and the Container Apps environment fails to create.
  - **DNS resolvers.** They must forward `privatelink.*` and Azure public names to Azure DNS (`168.63.129.16`) from a network linked to the central zones.
  - **Firewall rules on `southafricanorth-fw01`.** All outbound traffic from both Kato networks leaves through the hub firewall, so it must allow HTTPS (TCP 443) to:

    | Needed by | Destination |
    |---|---|
    | Container Apps platform: pulling system images | `mcr.microsoft.com`, `*.data.mcr.microsoft.com` |
    | Container Apps: pulling Kato's images | `<registry>.azurecr.io`, `<registry>.southafricanorth.data.azurecr.io`. The registry name is the `acrName` deployment output. Or allow the `AzureContainerRegistry` service tag. |
    | Managed identity and Entra ID sign-in | `login.microsoftonline.com`, `*.identity.azure.net`, `graph.microsoft.com` |
    | Key Vault secrets | `*.vault.azure.net` (or the `AzureKeyVault` service tag) |
    | Logs to Log Analytics | `*.ods.opinsights.azure.com`, `*.oms.opinsights.azure.com` (or the `AzureMonitor` service tag) |
    | Kato: AI assistant and assessments | `api.anthropic.com` |
    | Kato: Jira and Confluence | `liquidtelecom.atlassian.net` |
    | Kato: email, only if SMTP is enabled | Your SMTP host, on TCP 587 |

    Postgres and Redis traffic stays inside the VNet, so it needs no firewall rule.
  - **Employee access (inbound).** Kato is internal only. Employees reach `https://kato-app.<defaultDomain>` at the environment's private IP, which is in the Container Apps subnet (`10.181.108.0/25` prod, `10.181.107.0/26` dev). The Networks team needs to:
    - allow corporate user networks (office, VPN, ExpressRoute) to reach those subnets on **TCP 443** through Virtual WAN and fw01;
    - make sure corporate DNS sends lookups for `*.southafricanorth.azurecontainerapps.io` to the resolver inbound endpoints `10.181.251.196` / `.132`, so the app's private DNS zone answers. Without that, employees resolve the name to nothing.
  - **Permissions.** You, and later each pipeline identity, need **Private DNS Zone Contributor** on `liq-hq-dnszones`. The templates link Kato's VNet to `privatelink.postgres.database.azure.com` and `privatelink.redis.azure.net` there, and register Kato's Postgres and Redis records in them. If the Networks team creates the VNet links themselves, set `linkVnetToCentralDnsZones = false`.
  - **Central DNS zones.** These live in `liq-hq-dnszones` (subscription `d77c432c-1ece-4615-a240-5af85f7fb97c`), and both parameter files are already set to use them.
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

**6. Open Kato.** From a machine on the corporate network, open the URL `release.sh` printed (`https://kato-app.<defaultDomain>`). It has a valid Microsoft-issued certificate, so no certificate setup is needed. The private DNS zone for that domain is created automatically, and the `appDnsZone` and `appPrivateIp` outputs show its name and the IP it points to.

**Optional: a friendly internal name** such as `kato.azure.liquidtelecom.net`. Container Apps can't issue certificates for private names, so you need a certificate for that name, from Cassava's internal CA or a public CA:
- Upload the certificate to the environment, with `az containerapp env certificate upload` or from Key Vault.
- Add a `kato` A record in the private zone `azure.liquidtelecom.net` (`liq-hq-dnszones`) pointing to `appPrivateIp`.
- Set `customDomain` and `customDomainCertificateName` in the parameter file, then release again. This switches `NEXTAUTH_URL` and `KATO_PUBLIC_URL` to the new name.
- Add `https://<name>/api/auth/callback/azure-ad` to the app registration.

**7. Allowlist the outbound IP.** If the Atlassian site restricts IP addresses, allowlist the public IP of `southafricanorth-fw01`, which all of Kato's outbound traffic leaves through.

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
| [ci.yml](../.github/workflows/ci.yml) | Every pull request, and as stage 1 of Deploy | <ul><li>Installs dependencies and validates the Prisma schema.</li><li>Applies every migration to a clean PostgreSQL 16, and fails if `schema.prisma` has changes with no migration.</li><li>Checks the audit tables reject `TRUNCATE`.</li><li>Builds the web app and worker, and runs the TypeScript typecheck.</li><li>Fails on high or critical npm advisories.</li><li>Compiles and lints the Bicep and ShellChecks the scripts.</li><li>Builds both Docker images.</li></ul> |
| [deploy.yml](../.github/workflows/deploy.yml) | Every push to `main` (except docs-only changes), or **Run workflow** | <ul><li>CI.</li><li>**dev:** builds the images in the dev registry, migrates, rolls out and smoke-tests.</li><li>**production:** waits for approval, copies the *same* images from dev (no rebuild), migrates, rolls out and smoke-tests.</li></ul> |

The smoke test checks three things: `/api/health` reports the app and database healthy, Entra ID sign-in is configured, and the email-only dev login is **not** enabled. GitHub's runners can't reach an internal app, so `smoke-test.sh` starts the `kato-smoke` Container Apps job. That job runs inside Kato's network and calls the app at the same HTTPS address employees use, so it also checks the DNS set-up.

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
- **Dependency audit:** CI fails on any high or critical npm advisory, so a newly published advisory can block a release until the package is updated.

## Known gaps

- **Internal access depends on the network.** Kato has no public endpoint, so employees reach it only if the Networks team routes corporate networks to the Kato subnets and forwards the Container Apps DNS domain (see Network prerequisites).
- **Data plane open to the internet.** Key Vault and ACR have public endpoints, protected by RBAC. This keeps the scripts working from a laptop. Postgres and Redis are private only.
- **The app uses the Postgres admin login.** For least privilege, create a `kato_app` role limited to DML on schema `public`, and point `database-url` at it. Keep the admin login for the migration job only.
- **No alerts yet.** Dead-lettered jobs already notify staff in-app. Still worth adding: restart-count and replica-count alerts on both apps, and Postgres CPU and storage alerts.
- **Untested.** These templates haven't yet been run against Azure. Run `deploy.sh dev --what-if` first.
