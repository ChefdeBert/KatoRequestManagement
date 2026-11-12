// Private DNS for an internal Container Apps environment: a zone named after the environment's default
// domain (e.g. happyhill-1a2b3c.southafricanorth.azurecontainerapps.io) with a wildcard A record pointing
// at the environment's private IP, so kato-app.<domain> resolves for employees through the central resolvers.
// Deployed into the central DNS resource group (or the Kato resource group when central DNS isn't used).

param tags object
param zoneName string
param privateIp string

@description('VNets that must resolve the app: the Kato VNet and the central DNS resolver VNets.')
param linkVnetIds array

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: zoneName
  location: 'global'
  tags: tags
}

resource wildcard 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: zone
  name: '*'
  properties: {
    ttl: 300
    aRecords: [ { ipv4Address: privateIp } ]
  }
}

resource apex 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: zone
  name: '@'
  properties: {
    ttl: 300
    aRecords: [ { ipv4Address: privateIp } ]
  }
}

resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for id in linkVnetIds: {
  parent: zone
  name: 'link-${last(split(id, '/'))}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: id }
  }
}]

output zoneId string = zone.id
