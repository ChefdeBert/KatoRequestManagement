// Azure Managed Redis for the BullMQ queues, reached over a private endpoint.
// BullMQ requirements: eviction policy MUST be NoEviction (otherwise jobs silently disappear),
// and a non-clustered database so its multi-key Lua scripts work without hash-tag prefixes.
// Writes REDIS_URL into Key Vault as secret `redis-url`.

param location string
param namePrefix string
param tags object
param isProd bool
param privateEndpointSubnetId string

@description('Resource ID of the privatelink.redis.azure.net private DNS zone.')
param privateDnsZoneId string
param keyVaultName string

var suffix = uniqueString(resourceGroup().id)

resource redis 'Microsoft.Cache/redisEnterprise@2025-04-01' = {
  name: 'redis-${namePrefix}-${suffix}'
  location: location
  tags: tags
  sku: { name: isProd ? 'Balanced_B1' : 'Balanced_B0' }
  properties: {
    minimumTlsVersion: '1.2'
    highAvailability: isProd ? 'Enabled' : 'Disabled'
  }
}

resource database 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' = {
  parent: redis
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    port: 10000
    clusteringPolicy: 'NoCluster'
    evictionPolicy: 'NoEviction'
    accessKeysAuthentication: 'Enabled'
    persistence: isProd
      ? { aofEnabled: true, aofFrequency: '1s', rdbEnabled: false }
      : { aofEnabled: false, rdbEnabled: false }
  }
}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-${redis.name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: {
          privateLinkServiceId: redis.id
          groupIds: [ 'redisEnterprise' ]
        }
      }
    ]
  }
  dependsOn: [ database ]
}

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [ { name: 'redis', properties: { privateDnsZoneId: privateDnsZoneId } } ]
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource redisUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'redis-url'
  properties: {
    contentType: 'ioredis connection URL (TLS)'
    value: 'rediss://:${uriComponent(database.listKeys().primaryKey)}@${redis.properties.hostName}:10000'
  }
}

output hostName string = redis.properties.hostName
