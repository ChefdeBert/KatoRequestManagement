// Fallback when no central private DNS is used: Kato creates and links its own private DNS zones.

param tags object
param vnetId string
param linkName string
param postgresZoneName string
param redisZoneName string

resource pgZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: postgresZoneName
  location: 'global'
  tags: tags
}

resource redisZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: redisZoneName
  location: 'global'
  tags: tags
}

resource pgLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: pgZone
  name: linkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

resource redisLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: redisZone
  name: linkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

output postgresZoneId string = pgZone.id
output redisZoneId string = redisZone.id
