// Uses the private DNS zones the Networks team manages centrally (e.g. resource group liq-hq-dnszones)
// and, optionally, links the Kato VNet to them. Deployed at the central zones' resource group scope.
// The deploying identity needs Private DNS Zone Contributor on these zones (or their resource group).

param vnetId string
param linkName string
param postgresZoneName string
param redisZoneName string

@description('Create VNet links from the central zones to the Kato VNet. Set false if the Networks team links spokes themselves.')
param createVnetLinks bool

resource pgZone 'Microsoft.Network/privateDnsZones@2020-06-01' existing = {
  name: postgresZoneName
}

resource redisZone 'Microsoft.Network/privateDnsZones@2020-06-01' existing = {
  name: redisZoneName
}

resource pgLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (createVnetLinks) {
  parent: pgZone
  name: linkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnetId }
  }
}

resource redisLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (createVnetLinks) {
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
