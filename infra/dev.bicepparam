// Dev — resource group ct-hq-kato-ai-dev (created by infra/scripts/deploy.sh dev)
// Same topology as production, smaller and cheaper: Burstable Postgres without HA,
// Redis B0 without persistence, one app replica, no NAT gateway, Basic ACR.
using './main.bicep'

param environmentName = 'dev'
param location = 'southafricanorth'
param vnetAddressPrefix = '10.181.107.0/25'     // allocated by Networks team
param acaSubnetPrefix = '10.181.107.0/26'       // 64 addresses: Container Apps
param postgresSubnetPrefix = '10.181.107.64/28'
param privateEndpointSubnetPrefix = '10.181.107.80/28'
// 10.181.107.96/27 left free for growth

// ── DNS (Networks team standard) ────────────────────────────────────
// VNet uses the central resolvers. Private DNS zones live centrally in liq-hq-dnszones.
// Resolvers: 10.181.251.196 = ct-private-dns-za, 10.181.251.132 = ct-private-dns-uk (Azure DNS Private Resolver).
// The Kato VNet must be connected to the vWAN hub ct-vWAN-hub-southafricanorth BEFORE the first deployment,
// or nothing in it can reach these resolvers.
param dnsServers = [ '10.181.251.196', '10.181.251.132' ]
param privateDnsZoneResourceGroup = 'liq-hq-dnszones'
param privateDnsZoneSubscriptionId = 'd77c432c-1ece-4615-a240-5af85f7fb97c' // subscription holding liq-hq-dnszones
param linkVnetToCentralDnsZones = true
param postgresPrivateDnsZoneName = 'privatelink.postgres.database.azure.com' // exists in liq-hq-dnszones
param redisPrivateDnsZoneName = 'privatelink.redis.azure.net' // exists in liq-hq-dnszones
param internalOnly = true // employees only, over the corporate network
param dnsResolverVnetIds = [
  '/subscriptions/d77c432c-1ece-4615-a240-5af85f7fb97c/resourceGroups/rg-spoke-dns/providers/Microsoft.Network/virtualNetworks/vnet-spoke-dns'
  '/subscriptions/d77c432c-1ece-4615-a240-5af85f7fb97c/resourceGroups/rg-spoke-dns/providers/Microsoft.Network/virtualNetworks/vnet-spoke-dns-uk'
]
// Outbound internet traffic goes through the vWAN hub firewall (southafricanorth-fw01), not a NAT gateway.
param enableNatGateway = false

param deployApps = bool(readEnvironmentVariable('KATO_DEPLOY_APPS', 'false'))
param imageTag = readEnvironmentVariable('KATO_IMAGE_TAG', 'latest')
param postgresAdminPassword = readEnvironmentVariable('KATO_PG_ADMIN_PASSWORD')
param kvAdminPrincipalId = readEnvironmentVariable('KATO_SECRETS_OFFICER_ID', '')
param kvAdminPrincipalType = readEnvironmentVariable('KATO_SECRETS_OFFICER_TYPE', 'User')

param customDomain = ''
param customDomainCertificateName = ''

param appMinReplicas = 1
param appMaxReplicas = 2

param tags = {
  owner: 'ai-software-factory'
  'cost-centre': 'IT'
}

param useSmtpPassword = false

param settings = {
  KATO_ADMIN_GROUPS: '7b401a19-8809-48c0-9f35-752ec9a03319'
  KATO_REVIEWER_GROUPS: 'd850cc93-e2ea-4007-85c2-050c3d5a9abf'
  KATO_ADMIN_EMAILS: 'robert.northover@liquid.tech'
  // Lets one tester raise and approve their own requests in dev
  KATO_ALLOW_SELF_APPROVAL: 'true'
  KATO_REQUIRE_ASSESSMENT: 'true'
  KATO_AUTONOMOUS_MIN_SCORE: '75'
  KATO_ASSISTED_MIN_SCORE: '50'

  // Same app registration as prod is fine: add the dev redirect URI to it
  AZURE_AD_CLIENT_ID: '989d03ef-412f-4631-9ff1-cbb88d4f4bcc'
  AZURE_AD_TENANT_ID: '68792612-0f0e-46cb-b16a-fcb82fd80cb1'

  LLM_PROVIDER: 'anthropic'
  ANTHROPIC_MODEL: 'claude-sonnet-5-5'
  ASSESSMENT_MODEL: ''

  // Point dev at a sandbox project and space so test requests never reach the real backlog
  JIRA_BASE_URL: 'https://liquidtelecom-sandbox.atlassian.net/'
  JIRA_EMAIL: 'svc-kato@cassava.tech'
  JIRA_PROJECT_KEY: 'KATODEV'
  JIRA_SYNC_MAX_ATTEMPTS: '3'
  JIRA_CUSTOM_FIELDS: ''

  CONFLUENCE_ENABLED: 'true'
  CONFLUENCE_SPACE_KEY: 'TODO-sandbox-space'
  CONFLUENCE_PARENT_PAGE_ID: ''

  SMTP_HOST: ''
  SMTP_PORT: '587'
  SMTP_USER: ''
  SMTP_FROM: 'Kato Dev <kato-dev@cassava.tech>'
}
