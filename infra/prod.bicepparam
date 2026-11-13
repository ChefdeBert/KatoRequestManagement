// Production — resource group ct-hq-kato-ai, subscription ct-hq-serviceshub
using './main.bicep'

param environmentName = 'prod'
param location = 'southafricanorth'
param vnetAddressPrefix = '10.181.108.0/24'     // allocated by Networks team
param acaSubnetPrefix = '10.181.108.0/25'       // 128 addresses: Container Apps
param postgresSubnetPrefix = '10.181.108.128/28' // PostgreSQL primary + zone-redundant standby
param privateEndpointSubnetPrefix = '10.181.108.144/28' // Redis (+ future Key Vault / ACR)
// 10.181.108.160/27 and 10.181.108.192/26 left free for growth

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

// Optional friendly internal name, e.g. kato.azure.liquidtelecom.net: needs a certificate (infra/README.md)
param customDomain = ''
param customDomainCertificateName = ''

param appMinReplicas = 2
param appMaxReplicas = 6

param tags = {
  owner: 'ai-software-factory'
  'cost-centre': 'IT'
}

param useSmtpPassword = false

param settings = {
  // Roles — Entra group object IDs (comma-separated)
  KATO_ADMIN_GROUPS: '0d75891d-6465-4ce7-919e-cff54d26391b'
  KATO_REVIEWER_GROUPS: '900bd77a-eabb-4538-9d83-b5b8d78f36bb'
  KATO_ADMIN_EMAILS: 'robert.northover@liquid.tech'
  KATO_ALLOW_SELF_APPROVAL: 'false'
  KATO_REQUIRE_ASSESSMENT: 'true'
  KATO_AUTONOMOUS_MIN_SCORE: '75'
  KATO_ASSISTED_MIN_SCORE: '50'

  // Entra ID app registration (tenant defaults to the subscription's tenant)
  AZURE_AD_CLIENT_ID: '989d03ef-412f-4631-9ff1-cbb88d4f4bcc'
  AZURE_AD_TENANT_ID: '68792612-0f0e-46cb-b16a-fcb82fd80cb1'

  // LLM
  LLM_PROVIDER: 'anthropic'
  ANTHROPIC_MODEL: 'claude-sonnet-5-5'
  ASSESSMENT_MODEL: 'claude-opus-5-5'

  // Jira Cloud
  JIRA_BASE_URL: 'https://liquidtelecom.atlassian.net'
  JIRA_EMAIL: 'svc-kato@cassava.tech'
  JIRA_PROJECT_KEY: 'KATO'
  JIRA_SYNC_MAX_ATTEMPTS: '8'
  JIRA_CUSTOM_FIELDS: ''

  // Confluence Cloud: production site, KATO space (Jira service account credentials)
  CONFLUENCE_ENABLED: 'true'
  CONFLUENCE_BASE_URL: 'https://liquidtelecom.atlassian.net/wiki'
  CONFLUENCE_SPACE_KEY: 'KATO'
  CONFLUENCE_PARENT_PAGE_ID: ''

  // Email — leave SMTP_HOST empty to record in-app notifications only
  SMTP_HOST: ''
  SMTP_PORT: '587'
  SMTP_USER: ''
  SMTP_FROM: 'Kato <kato@cassava.tech>'
}
