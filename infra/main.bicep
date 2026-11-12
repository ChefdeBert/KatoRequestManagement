// Kato on Azure Container Apps — one resource group per environment.
// Deploy with infra/scripts/deploy.sh (see infra/README.md). Parameter files: prod.bicepparam, dev.bicepparam.
targetScope = 'resourceGroup'

@allowed([ 'prod', 'dev' ])
param environmentName string

@description('Region for all resources. South Africa North (Johannesburg) by default.')
param location string = 'southafricanorth'

@description('Region for Azure Managed Redis, in case the SKU is not offered in the main region.')
param redisLocation string = location

param tags object = {}

// ── Network (ranges allocated by the Networks team) ──────────────────
@description('VNet address space for this environment.')
param vnetAddressPrefix string

@description('Container Apps subnet, inside vnetAddressPrefix. Minimum /27.')
param acaSubnetPrefix string

@description('PostgreSQL subnet, inside vnetAddressPrefix. Minimum /28.')
param postgresSubnetPrefix string

@description('Private endpoint subnet, inside vnetAddressPrefix. Minimum /28.')
param privateEndpointSubnetPrefix string

@description('Custom DNS servers for the VNet (central resolvers). Empty = Azure-provided DNS.')
param dnsServers array = []

// ── Access ───────────────────────────────────────────────────────────
@description('Private IP only: Kato is reachable from the corporate network, not the internet.')
param internalOnly bool = true

@description('VNets hosting the central DNS resolvers. The app\'s private DNS zone is linked to them so employees can resolve Kato.')
param dnsResolverVnetIds array = []

// ── Private DNS ──────────────────────────────────────────────────────
@description('Resource group holding the central private DNS zones (e.g. liq-hq-dnszones). Empty = Kato creates its own zones.')
param privateDnsZoneResourceGroup string = ''

@description('Subscription of privateDnsZoneResourceGroup.')
param privateDnsZoneSubscriptionId string = subscription().subscriptionId

@description('Link the Kato VNet to the central zones. Set false if the Networks team creates spoke links themselves.')
param linkVnetToCentralDnsZones bool = true

@description('Private DNS zone for PostgreSQL. Must end in .postgres.database.azure.com.')
param postgresPrivateDnsZoneName string = 'privatelink.postgres.database.azure.com'

@description('Private DNS zone for Azure Managed Redis private endpoints.')
param redisPrivateDnsZoneName string = 'privatelink.redis.azure.net'

param enableNatGateway bool

@description('Phase 2 switch: create the container apps and migration job. See infra/README.md.')
param deployApps bool = false

@description('Image tag pushed to ACR by infra/scripts/build-images.sh.')
param imageTag string = 'latest'

@description('Custom host name, e.g. kato.cassava.tech. Empty = Container Apps default host name.')
param customDomain string = ''

@description('Managed certificate name for customDomain (from `az containerapp env certificate list`).')
param customDomainCertificateName string = ''

@secure()
@description('PostgreSQL administrator password. Read from the KATO_PG_ADMIN_PASSWORD environment variable by the .bicepparam files.')
param postgresAdminPassword string

@description('Object ID of the user or group that will set API keys in Key Vault.')
param kvAdminPrincipalId string = ''

@allowed([ 'User', 'Group', 'ServicePrincipal' ])
param kvAdminPrincipalType string = 'User'

param appMinReplicas int
param appMaxReplicas int

@description('Non-secret app settings (env var name → value). Empty values are skipped.')
param settings object

@description('Set true when SMTP_USER is set and an smtp-password secret exists in Key Vault.')
param useSmtpPassword bool = false

var isProd = environmentName == 'prod'
var namePrefix = 'kato-${environmentName}'
var allTags = union({ application: 'kato', environment: environmentName, 'managed-by': 'bicep' }, tags)

module network 'modules/network.bicep' = {
  name: 'kato-network'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    addressPrefix: vnetAddressPrefix
    acaSubnetPrefix: acaSubnetPrefix
    postgresSubnetPrefix: postgresSubnetPrefix
    privateEndpointSubnetPrefix: privateEndpointSubnetPrefix
    dnsServers: dnsServers
    enableNatGateway: enableNatGateway
  }
}

var useCentralDns = !empty(privateDnsZoneResourceGroup)
var dnsLinkName = 'vnet-${namePrefix}'

module dnsCentral 'modules/dns-central.bicep' = if (useCentralDns) {
  name: 'kato-${environmentName}-dns-central'
  scope: resourceGroup(privateDnsZoneSubscriptionId, useCentralDns ? privateDnsZoneResourceGroup : resourceGroup().name)
  params: {
    vnetId: network.outputs.vnetId
    linkName: dnsLinkName
    postgresZoneName: postgresPrivateDnsZoneName
    redisZoneName: redisPrivateDnsZoneName
    createVnetLinks: linkVnetToCentralDnsZones
  }
}

module dnsLocal 'modules/dns-local.bicep' = if (!useCentralDns) {
  name: 'kato-dns-local'
  params: {
    tags: allTags
    vnetId: network.outputs.vnetId
    linkName: dnsLinkName
    postgresZoneName: postgresPrivateDnsZoneName
    redisZoneName: redisPrivateDnsZoneName
  }
}

var postgresZoneId = useCentralDns ? dnsCentral!.outputs.postgresZoneId : dnsLocal!.outputs.postgresZoneId
var redisZoneId = useCentralDns ? dnsCentral!.outputs.redisZoneId : dnsLocal!.outputs.redisZoneId

module platform 'modules/platform.bicep' = {
  name: 'kato-platform'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    isProd: isProd
    kvAdminPrincipalId: kvAdminPrincipalId
    kvAdminPrincipalType: kvAdminPrincipalType
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'kato-postgres'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    isProd: isProd
    subnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: postgresZoneId
    keyVaultName: platform.outputs.keyVaultName
    adminPassword: postgresAdminPassword
  }
}

module redis 'modules/redis.bicep' = {
  name: 'kato-redis'
  params: {
    location: redisLocation
    namePrefix: namePrefix
    tags: allTags
    isProd: isProd
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    privateDnsZoneId: redisZoneId
    keyVaultName: platform.outputs.keyVaultName
  }
}

module apps 'modules/containerapps.bicep' = {
  name: 'kato-containerapps'
  params: {
    location: location
    namePrefix: namePrefix
    tags: allTags
    isProd: isProd
    acaSubnetId: network.outputs.acaSubnetId
    logAnalyticsName: platform.outputs.logAnalyticsName
    identityId: platform.outputs.identityId
    acrLoginServer: platform.outputs.acrLoginServer
    keyVaultUri: platform.outputs.keyVaultUri
    deployApps: deployApps
    imageTag: imageTag
    internalOnly: internalOnly
    customDomain: customDomain
    customDomainCertificateName: customDomainCertificateName
    settings: union(settings, { AZURE_AD_TENANT_ID: empty(settings.?AZURE_AD_TENANT_ID ?? '') ? tenant().tenantId : settings.AZURE_AD_TENANT_ID })
    useSmtpPassword: useSmtpPassword
    appMinReplicas: appMinReplicas
    appMaxReplicas: appMaxReplicas
  }
  // The apps resolve database-url and redis-url at creation time.
  dependsOn: [ postgres, redis ]
}

// Internal environments need a private DNS zone for their default domain.
module appDns 'modules/dns-app.bicep' = if (internalOnly) {
  name: 'kato-${environmentName}-dns-app'
  scope: resourceGroup(useCentralDns ? privateDnsZoneSubscriptionId : subscription().subscriptionId, useCentralDns ? privateDnsZoneResourceGroup : resourceGroup().name)
  params: {
    tags: allTags
    zoneName: apps.outputs.defaultDomain
    privateIp: apps.outputs.staticIp
    linkVnetIds: concat([ network.outputs.vnetId ], dnsResolverVnetIds)
  }
}

output acrName string = platform.outputs.acrName
output acrLoginServer string = platform.outputs.acrLoginServer
output keyVaultName string = platform.outputs.keyVaultName
output postgresServer string = postgres.outputs.serverName
output redisHost string = redis.outputs.hostName
output containerAppsEnvironment string = apps.outputs.environmentName
output publicUrl string = apps.outputs.publicUrl
output entraRedirectUri string = '${apps.outputs.publicUrl}/api/auth/callback/azure-ad'
output outboundIp string = network.outputs.natPublicIp
output appPrivateIp string = apps.outputs.staticIp
output appDnsZone string = internalOnly ? apps.outputs.defaultDomain : ''
