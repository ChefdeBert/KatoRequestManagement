// Production — resource group ct-hq-kato-ai, subscription ct-hq-serviceshub
using './main.bicep'

param environmentName = 'prod'
param location = 'southafricanorth'
param vnetAddressPrefix = '10.60.0.0/16' // TODO: confirm with network team it doesn't clash with peered ranges
param enableNatGateway = true

param deployApps = bool(readEnvironmentVariable('KATO_DEPLOY_APPS', 'false'))
param imageTag = readEnvironmentVariable('KATO_IMAGE_TAG', 'latest')
param postgresAdminPassword = readEnvironmentVariable('KATO_PG_ADMIN_PASSWORD')
param kvAdminPrincipalId = readEnvironmentVariable('KATO_SECRETS_OFFICER_ID', '')
param kvAdminPrincipalType = readEnvironmentVariable('KATO_SECRETS_OFFICER_TYPE', 'User')

// Set after the CNAME/TXT records exist and the domain is bound (infra/README.md, step 6)
param customDomain = ''
param customDomainCertificateName = ''

param appMinReplicas = 2
param appMaxReplicas = 6

param tags = {
  owner: 'ai-software-factory'
  'cost-centre': 'TODO'
}

param useSmtpPassword = false

param settings = {
  // Roles — Entra group object IDs (comma-separated)
  KATO_ADMIN_GROUPS: '0d75891d-6465-4ce7-919e-cff54d26391b'
  KATO_REVIEWER_GROUPS: '900bd77a-eabb-4538-9d83-b5b8d78f36bb'
  KATO_ADMIN_EMAILS: 'robert.northover@liquid.tech'
  KATO_ALLOW_SELF_APPROVAL: 'false'
  KATO_REQUIRE_ASSESSMENT: 'true'
  KATO_AUTONOMOUS_MIN_SCORE: '75'
  KATO_ASSISTED_MIN_SCORE: '50'

  // Entra ID app registration (tenant defaults to the subscription's tenant)
  AZURE_AD_CLIENT_ID: '989d03ef-412f-4631-9ff1-cbb88d4f4bcc'
  AZURE_AD_TENANT_ID: '68792612-0f0e-46cb-b16a-fcb82fd80cb1'

  // LLM
  LLM_PROVIDER: 'anthropic'
  ANTHROPIC_MODEL: 'claude-sonnet-5-5'
  ASSESSMENT_MODEL: 'claude-opus-5-5'

  // Jira Cloud
  JIRA_BASE_URL: 'https://liquidtelecom.atlassian.net'
  JIRA_EMAIL: 'svc-kato@cassava.tech'
  JIRA_PROJECT_KEY: 'KATO'
  JIRA_SYNC_MAX_ATTEMPTS: '8'
  JIRA_CUSTOM_FIELDS: ''

  // Confluence Cloud (uses the Jira site and credentials)
  CONFLUENCE_ENABLED: 'true'
  CONFLUENCE_SPACE_KEY: 'KATO'
  CONFLUENCE_PARENT_PAGE_ID: ''

  // Email — leave SMTP_HOST empty to record in-app notifications only
  SMTP_HOST: ''
  SMTP_PORT: '587'
  SMTP_USER: ''
  SMTP_FROM: 'Kato <kato@cassava.tech>'
}
