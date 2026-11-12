// Container Apps environment plus the Kato workloads:
//   kato-app      Next.js web app (HTTPS ingress, scales on HTTP). With internalOnly the whole environment
//                 has only a private IP in the Kato VNet: reachable from the corporate network, not the internet.
//   kato-worker   BullMQ worker (no ingress, exactly one replica)
//   kato-migrate  manual job that runs `prisma migrate deploy` before each release
//   kato-smoke    manual job that checks the deployed app from inside the network (used by release pipelines)
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

@description('Environment has a private IP only (no public endpoint). Users reach it over the corporate network.')
param internalOnly bool

@description('Custom host name (e.g. kato.azure.liquidtelecom.net). Empty = use the Container Apps default host name.')
param customDomain string

@description('Certificate for customDomain: a certificate uploaded to the environment (internal) or a managed certificate (public).')
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
      internal: internalOnly
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
            // Managed certificates need public DNS validation, so internal environments use an uploaded certificate.
            certificateId: internalOnly ? '${env.id}/certificates/${customDomainCertificateName}' : '${env.id}/managedCertificates/${customDomainCertificateName}'
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
          // CHECKPOINT_DISABLE: stop the Prisma CLI calling checkpoint.prisma.io (blocked by the hub firewall).
          env: [ { name: 'DATABASE_URL', secretRef: 'database-url' }, { name: 'CHECKPOINT_DISABLE', value: '1' } ]
        }
      ]
    }
  }
}

// Checks the app the way an employee's browser would reach it (its HTTPS URL, via the central DNS),
// but from inside the network, so release pipelines running on the internet can still verify a deployment.
var smokeScript = '''
const base = process.env.KATO_APP_URL;
const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
(async () => {
  let body = "";
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(base + "/api/health"); body = await r.text(); if (r.ok && body.includes('"ok"')) break; } catch (e) { body = String(e); }
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!body.includes('"ok"')) fail("health check: " + body);
  console.log("ok   health " + body);
  const p = await (await fetch(base + "/api/auth/providers")).text();
  if (!p.includes('"azure-ad"')) fail("Entra ID sign-in is not configured: " + p);
  if (p.includes('"kato-dev"')) fail("the email-only dev login is enabled");
  console.log("ok   sign-in: Entra ID on, dev login off");
})().catch((e) => fail(String(e)));
'''

resource smoke 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: 'kato-smoke'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 600
      replicaRetryLimit: 0
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'smoke'
          image: '${acrLoginServer}/kato-worker:${imageTag}'
          command: [ 'node', '-e', smokeScript ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [ { name: 'KATO_APP_URL', value: publicUrl } ]
        }
      ]
    }
  }
}

output environmentName string = env.name
output defaultDomain string = env.properties.defaultDomain
output staticIp string = env.properties.staticIp
output publicUrl string = publicUrl
