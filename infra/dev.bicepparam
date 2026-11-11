// Dev — resource group ct-hq-kato-ai-dev (created by infra/scripts/deploy.sh dev)
// Same topology as production, smaller and cheaper: Burstable Postgres without HA,
// Redis B0 without persistence, one app replica, no NAT gateway, Basic ACR.
using './main.bicep'

param environmentName = 'dev'
param location = 'southafricanorth'
param vnetAddressPrefix = '10.61.0.0/16'
param enableNatGateway = false

param deployApps = bool(readEnvironmentVariable('KATO_DEPLOY_APPS', 'false'))
param imageTag = readEnvironmentVariable('KATO_IMAGE_TAG', 'latest')
param postgresAdminPassword = readEnvironmentVariable('KATO_PG_ADMIN_PASSWORD')
param kvAdminPrincipalId = readEnvironmentVariable('KATO_SECRETS_OFFICER_ID', '')
param kvAdminPrincipalType = readEnvironmentVariable('KATO_SECRETS_OFFICER_TYPE', 'User')

param customDomain = ''
param customDomainCertificateName = ''

param appMinReplicas = 1
param appMaxReplicas = 2

param tags = {
  owner: 'ai-software-factory'
  'cost-centre': 'TODO'
}

param useSmtpPassword = false

param settings = {
  KATO_ADMIN_GROUPS: 'TODO-admin-group-object-id'
  KATO_REVIEWER_GROUPS: 'TODO-reviewer-group-object-id'
  KATO_ADMIN_EMAILS: 'robert.northover@cassava.tech'
  // Lets one tester raise and approve their own requests in dev
  KATO_ALLOW_SELF_APPROVAL: 'true'
  KATO_REQUIRE_ASSESSMENT: 'true'
  KATO_AUTONOMOUS_MIN_SCORE: '75'
  KATO_ASSISTED_MIN_SCORE: '50'

  // Same app registration as prod is fine: add the dev redirect URI to it
  AZURE_AD_CLIENT_ID: 'TODO-app-registration-client-id'
  AZURE_AD_TENANT_ID: ''

  LLM_PROVIDER: 'anthropic'
  ANTHROPIC_MODEL: 'claude-sonnet-5-5'
  ASSESSMENT_MODEL: ''

  // Point dev at a sandbox project and space so test requests never reach the real backlog
  JIRA_BASE_URL: 'https://liquidtelecom.atlassian.net'
  JIRA_EMAIL: 'svc-kato@cassava.tech'
  JIRA_PROJECT_KEY: 'TODO-sandbox-project'
  JIRA_SYNC_MAX_ATTEMPTS: '3'
  JIRA_CUSTOM_FIELDS: ''

  CONFLUENCE_ENABLED: 'true'
  CONFLUENCE_SPACE_KEY: 'TODO-sandbox-space'
  CONFLUENCE_PARENT_PAGE_ID: ''

  SMTP_HOST: ''
  SMTP_PORT: '587'
  SMTP_USER: ''
  SMTP_FROM: 'Kato Dev <kato-dev@cassava.tech>'
}
