// Container Apps environment plus the Kato workloads:
//   kato-app      Next.js web app (external HTTPS ingress, scales on HTTP)
//   kato-worker   BullMQ worker (no ingress, exactly one replica)
//   kato-migrate  manual job that runs `prisma migrate deploy` before each release
// Secrets are Key Vault references resolved by the user-assigned identity.

param location string
param namePrefix string
param tags object
param isProd bool

param acaSubnetId string
param logAnalyticsName string
param identityId string
param acrLoginServer string
param keyVaultUri string

@description('Create the apps and job. Leave false until images are in ACR and the manual secrets are in Key Vault.')
param deployApps bool

param imageTag string

@description('Custom host name (e.g. kato.cassava.tech). Empty = use the Container Apps default host name.')
param customDomain string

@description('Name of the managed certificate created by `az containerapp hostname bind` for customDomain.')
param customDomainCertificateName string

@description('Plain (non-secret) environment variables shared by app, worker and job.')
param settings object

@description('Add the smtp-password secret. Only set when SMTP_USER is used.')
param useSmtpPassword bool

param appMinReplicas int
param appMaxReplicas int

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${namePrefix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: acaSubnetId
      internal: false
    }
    workloadProfiles: [ { name: 'Consumption', workloadProfileType: 'Consumption' } ]
    zoneRedundant: isProd
  }
}

var appName = 'kato-app'
var publicUrl = empty(customDomain) ? 'https://${appName}.${env.properties.defaultDomain}' : 'https://${customDomain}'

// ── Secrets (Key Vault references) ──────────────────────────────────
var kvSecretNames = concat(
  [ 'database-url', 'redis-url', 'nextauth-secret', 'azure-ad-client-secret', 'anthropic-api-key', 'jira-api-token' ],
  useSmtpPassword ? [ 'smtp-password' ] : []
)
var secrets = [for s in kvSecretNames: {
  name: s
  keyVaultUrl: '${keyVaultUri}secrets/${s}'
  identity: identityId
}]

var secretEnv = concat(
  [
    { name: 'DATABASE_URL', secretRef: 'database-url' }
    { name: 'REDIS_URL', secretRef: 'redis-url' }
    { name: 'NEXTAUTH_SECRET', secretRef: 'nextauth-secret' }
    { name: 'AZURE_AD_CLIENT_SECRET', secretRef: 'azure-ad-client-secret' }
    { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
    { name: 'JIRA_API_TOKEN', secretRef: 'jira-api-token' }
  ],
  useSmtpPassword ? [ { name: 'SMTP_PASSWORD', secretRef: 'smtp-password' } ] : []
)

var urlEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'NEXTAUTH_URL', value: publicUrl }
  { name: 'KATO_PUBLIC_URL', value: publicUrl }
  { name: 'KATO_DEV_LOGIN', value: 'false' }
]

// Empty settings are left out so the app's own defaults apply.
var plainEnv = filter(map(items(settings), kv => { name: kv.key, value: string(kv.value) }), e => !empty(e.value))

var allEnv = concat(urlEnv, plainEnv, secretEnv)

var registries = [ { server: acrLoginServer, identity: identityId } ]
var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${identityId}': {} }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: appName
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // Must be declared here once bound, or a redeploy would remove the custom domain.
        customDomains: empty(customDomain) ? [] : [
          {
            name: customDomain
            bindingType: 'SniEnabled'
            certificateId: '${env.id}/managedCertificates/${customDomainCertificateName}'
          }
        ]
      }
      registries: registries
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'app'
          image: '${acrLoginServer}/kato-app:${imageTag}'
          resources: isProd ? { cpu: json('1.0'), memory: '2Gi' } : { cpu: json('0.5'), memory: '1Gi' }
          env: allEnv
          probes: [
            // /api/health checks the database: use it to take a replica out of rotation, not to restart it.
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              tcpSocket: { port: 3000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Startup'
              tcpSocket: { port: 3000 }
              periodSeconds: 5
              failureThreshold: 24
            }
          ]
        }
      ]
      scale: {
        minReplicas: appMinReplicas
        maxReplicas: appMaxReplicas
        rules: [ { name: 'http', http: { metadata: { concurrentRequests: '50' } } } ]
      }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: 'kato-worker'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${acrLoginServer}/kato-worker:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: allEnv
        }
      ]
      // Exactly one: Confluence publishing runs one job at a time and the reconciler is a single loop.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

resource migrate 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: 'kato-migrate'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 900
      replicaRetryLimit: 1
      registries: registries
      secrets: filter(secrets, s => s.name == 'database-url')
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${acrLoginServer}/kato-worker:${imageTag}'
          // Call the Prisma CLI directly: npx would try to write a cache in the non-root user's missing home dir.
          command: [ 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy' ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [ { name: 'DATABASE_URL', secretRef: 'database-url' } ]
        }
      ]
    }
  }
}

output environmentName string = env.name
output defaultDomain string = env.properties.defaultDomain
output staticIp string = env.properties.staticIp
output publicUrl string = publicUrl
