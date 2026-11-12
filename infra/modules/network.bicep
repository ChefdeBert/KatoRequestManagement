// Virtual network for Kato: Container Apps, PostgreSQL (VNet-injected) and private endpoints.
// Address ranges are allocated by the Liquid/Cassava Networks team and passed in exactly as allocated.
// Optional NAT gateway gives all outbound traffic one static IP (for Atlassian / Anthropic allowlists).

param location string
param namePrefix string
param tags object

@description('VNet address space allocated by the Networks team, e.g. 10.181.106.0/24.')
param addressPrefix string

@description('Container Apps subnet (delegated). Minimum /27; /26 or larger recommended.')
param acaSubnetPrefix string

@description('PostgreSQL Flexible Server subnet (delegated). Minimum /28.')
param postgresSubnetPrefix string

@description('Private endpoint subnet. One address per private endpoint. Minimum /28.')
param privateEndpointSubnetPrefix string

@description('Custom DNS servers for the VNet (central resolvers). Empty = Azure-provided DNS.')
param dnsServers array

@description('Attach a NAT gateway with a static public IP to the Container Apps subnet.')
param enableNatGateway bool

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
    dhcpOptions: empty(dnsServers) ? null : { dnsServers: dnsServers }
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
          addressPrefix: postgresSubnetPrefix
          delegations: [ { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } } ]
        }
      }
      {
        name: 'snet-pe'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

output vnetId string = vnet.id
output vnetName string = vnet.name
output acaSubnetId string = vnet.properties.subnets[0].id
output postgresSubnetId string = vnet.properties.subnets[1].id
output privateEndpointSubnetId string = vnet.properties.subnets[2].id
output natPublicIp string = enableNatGateway ? natIp!.properties.ipAddress : ''
