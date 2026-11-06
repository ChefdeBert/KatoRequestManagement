// Azure Database for PostgreSQL Flexible Server 16, VNet-injected (no public endpoint).
// Writes the Prisma DATABASE_URL into Key Vault as secret `database-url`.

param location string
param namePrefix string
param tags object
param isProd bool
param vnetId string
param subnetId string
param keyVaultName string

param adminLogin string = 'katoadmin'

@secure()
param adminPassword string

@description('Prisma connection pool size per process. App max replicas x this must stay well under max_connections.')
param connectionLimit int = 10

var suffix = uniqueString(resourceGroup().id)
var serverName = 'psql-${namePrefix}-${suffix}'
var databaseName = 'kato'

resource dnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${namePrefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dnsZone
  name: 'link-${namePrefix}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: isProd
    ? { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
    : { name: 'Standard_B2s', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
    storage: {
      storageSizeGB: isProd ? 128 : 32
      autoGrow: 'Enabled'
    }
    backup: {
      // The immutable audit trail lives here: keep production backups for the maximum period.
      backupRetentionDays: isProd ? 35 : 7
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: { mode: isProd ? 'ZoneRedundant' : 'Disabled' }
    network: {
      delegatedSubnetResourceId: subnetId
      privateDnsZoneArmResourceId: dnsZone.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [ dnsLink ]
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
  dependsOn: [ db ]
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource databaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    contentType: 'Prisma connection string'
    value: 'postgresql://${adminLogin}:${uriComponent(adminPassword)}@${server.properties.fullyQualifiedDomainName}:5432/${databaseName}?schema=public&sslmode=require&connection_limit=${connectionLimit}'
  }
  dependsOn: [ db ]
}

output serverName string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
