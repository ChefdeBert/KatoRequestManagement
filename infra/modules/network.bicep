// Virtual network for Kato: Container Apps, PostgreSQL (VNet-injected) and private endpoints.
// Optional NAT gateway gives all outbound traffic one static IP (for Atlassian / Anthropic allowlists).

param location string
param namePrefix string
param tags object

@description('VNet address space, e.g. 10.60.0.0/16. Must not overlap other Cassava networks you may peer with.')
param addressPrefix string

@description('Attach a NAT gateway with a static public IP to the Container Apps subnet.')
param enableNatGateway bool

// Subnet plan inside the /16: /23 for Container Apps, /28 for Postgres, /27 for private endpoints.
var acaSubnetPrefix = cidrSubnet(addressPrefix, 23, 0) // x.x.0.0/23
var pgSubnetPrefix = cidrSubnet(addressPrefix, 28, 32) // x.x.2.0/28
var peSubnetPrefix = cidrSubnet(addressPrefix, 27, 17) // x.x.2.32/27

resource natIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = if (enableNatGateway) {
  name: 'pip-${namePrefix}-nat'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  zones: [ '1', '2', '3' ]
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource nat 'Microsoft.Network/natGateways@2024-05-01' = if (enableNatGateway) {
  name: 'ng-${namePrefix}'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    idleTimeoutInMinutes: 10
    publicIpAddresses: [ { id: natIp.id } ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ addressPrefix ] }
    subnets: [
      {
        name: 'snet-aca'
        properties: {
          addressPrefix: acaSubnetPrefix
          delegations: [ { name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } } ]
          natGateway: enableNatGateway ? { id: nat.id } : null
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: pgSubnetPrefix
          delegations: [ { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } } ]
        }
      }
      {
        name: 'snet-pe'
        properties: {
          addressPrefix: peSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

output vnetId string = vnet.id
output acaSubnetId string = vnet.properties.subnets[0].id
output postgresSubnetId string = vnet.properties.subnets[1].id
output privateEndpointSubnetId string = vnet.properties.subnets[2].id
output natPublicIp string = enableNatGateway ? natIp!.properties.ipAddress : ''
