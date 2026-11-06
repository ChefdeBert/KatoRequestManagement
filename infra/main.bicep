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

@description('VNet address space for this environment.')
param vnetAddressPrefix string

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
    enableNatGateway: enableNatGateway
  }
}

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
    vnetId: network.outputs.vnetId
    subnetId: network.outputs.postgresSubnetId
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
    vnetId: network.outputs.vnetId
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
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

output acrName string = platform.outputs.acrName
output acrLoginServer string = platform.outputs.acrLoginServer
output keyVaultName string = platform.outputs.keyVaultName
output postgresServer string = postgres.outputs.serverName
output redisHost string = redis.outputs.hostName
output containerAppsEnvironment string = apps.outputs.environmentName
output publicUrl string = apps.outputs.publicUrl
output entraRedirectUri string = '${apps.outputs.publicUrl}/api/auth/callback/azure-ad'
output outboundIp string = network.outputs.natPublicIp
output customDomainVerification string = 'Add TXT asuid.<host> and CNAME <host> → kato-app.${apps.outputs.defaultDomain}'
