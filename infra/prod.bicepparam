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
  KATO_ADMIN_GROUPS: 'TODO-admin-group-object-id'
  KATO_REVIEWER_GROUPS: 'TODO-reviewer-group-object-id'
  KATO_ADMIN_EMAILS: 'robert.northover@cassava.tech'
  KATO_ALLOW_SELF_APPROVAL: 'false'
  KATO_REQUIRE_ASSESSMENT: 'true'
  KATO_AUTONOMOUS_MIN_SCORE: '75'
  KATO_ASSISTED_MIN_SCORE: '50'

  // Entra ID app registration (tenant defaults to the subscription's tenant)
  AZURE_AD_CLIENT_ID: 'TODO-app-registration-client-id'
  AZURE_AD_TENANT_ID: ''

  // LLM
  LLM_PROVIDER: 'anthropic'
  ANTHROPIC_MODEL: 'claude-sonnet-5-5'
  ASSESSMENT_MODEL: 'claude-opus-5-5'

  // Jira Cloud
  JIRA_BASE_URL: 'https://liquidtelecom.atlassian.net'
  JIRA_EMAIL: 'svc-kato@cassava.tech'
  JIRA_PROJECT_KEY: 'AISF'
  JIRA_SYNC_MAX_ATTEMPTS: '8'
  JIRA_CUSTOM_FIELDS: ''

  // Confluence Cloud (uses the Jira site and credentials)
  CONFLUENCE_ENABLED: 'true'
  CONFLUENCE_SPACE_KEY: 'AISF'
  CONFLUENCE_PARENT_PAGE_ID: ''

  // Email — leave SMTP_HOST empty to record in-app notifications only
  SMTP_HOST: ''
  SMTP_PORT: '587'
  SMTP_USER: ''
  SMTP_FROM: 'Kato <kato@cassava.tech>'
}
