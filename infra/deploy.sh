#!/usr/bin/env bash
# Deploys one environment: the network and data stacks, the app stack with the new migrator,
# the migrations, then the new code for the API and the worker, and a smoke test. Used by
# .github/workflows/deploy-*.yml. Requires the bootstrap stack (infra/bootstrap.yml) and the
# Lambda zip at apps/api/lambda.zip.
#
# Optional environment variables: ALERT_EMAIL, API_DOMAIN_NAME, API_CERTIFICATE_ARN, APP_ORIGIN,
# IDURA_DOMAIN, EMAIL_DOMAIN, INBOUND_EMAIL_DOMAIN.
set -euo pipefail

env="${1:?usage: infra/deploy.sh staging|production}"
region="${AWS_REGION:-eu-north-1}"

case "$env" in
  staging)
    nat_mode=instance multi_az=false vpc_cidr=10.40.0.0/16
    # Vipps production, like Idura: tested with real Vipps instead of the MT test app (docs/auth.md).
    app_origin="${APP_ORIGIN:-https://staging.veriqall.no}" vipps_host=https://api.vipps.no ;;
  production)
    nat_mode=gateway multi_az=true vpc_cidr=10.41.0.0/16
    app_origin="${APP_ORIGIN:-https://app.veriqall.no}" vipps_host=https://api.vipps.no ;;
  *) echo "unknown environment: $env" >&2; exit 1 ;;
esac

# The production web app calls https://api.veriqall.no, and the login cookie only works on that
# domain; without it, logins would land on the execute-api address and fail.
if [[ "$env" == production && ( -z "${API_DOMAIN_NAME:-}" || -z "${API_CERTIFICATE_ARN:-}" ) ]]; then
  echo "production needs API_DOMAIN_NAME and API_CERTIFICATE_ARN (infra/README.md)" >&2
  exit 1
fi

output() {
  local value
  value=$(aws cloudformation describe-stacks --region "$region" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text)
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "missing output $2 on stack $1" >&2
    exit 1
  fi
  echo "$value"
}

bootstrap="veriqall-$env-bootstrap"
bucket=$(output "$bootstrap" ArtifactsBucketName)
execution_role=$(output "$bootstrap" CloudFormationExecutionRoleArn)

artifact_key="lambda/${GITHUB_SHA:-$(git rev-parse HEAD)}.zip"
aws s3 cp apps/api/lambda.zip "s3://$bucket/$artifact_key" --region "$region" --only-show-errors

deploy() {
  local stack="$1" template="$2"
  shift 2
  local status
  status=$(aws cloudformation describe-stacks --region "$region" --stack-name "veriqall-$env-$stack" \
    --query "Stacks[0].StackStatus" --output text 2>/dev/null || true)
  if [[ "$status" == "ROLLBACK_COMPLETE" ]]; then
    # A stack whose first creation failed can only be deleted. The deploy role may not delete
    # stacks, so an administrator does it (it holds no resources in this state).
    echo "veriqall-$env-$stack is in ROLLBACK_COMPLETE; an administrator must delete it before redeploying" >&2
    exit 1
  fi
  echo "::group::deploy veriqall-$env-$stack"
  aws cloudformation deploy --region "$region" \
    --stack-name "veriqall-$env-$stack" \
    --template-file "infra/$template" \
    --role-arn "$execution_role" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --tags project=veriqall "environment=$env" \
    --parameter-overrides "Environment=$env" "$@"
  echo "::endgroup::"
}

network_params=("NatMode=$nat_mode" "VpcCidr=$vpc_cidr")
[[ -n "${ALERT_EMAIL:-}" ]] && network_params+=("AlertEmail=$ALERT_EMAIL")
deploy network network.yml "${network_params[@]}"

deploy data data.yml "MultiAz=$multi_az" "AppOrigin=$app_origin"

app_params=("ArtifactsBucket=$bucket" "ArtifactKey=$artifact_key" "AppOrigin=$app_origin"
  "VippsHost=$vipps_host" "IduraDomain=${IDURA_DOMAIN:-}")
if [[ -n "${API_DOMAIN_NAME:-}" && -n "${API_CERTIFICATE_ARN:-}" ]]; then
  app_params+=("ApiDomainName=$API_DOMAIN_NAME" "ApiCertificateArn=$API_CERTIFICATE_ARN")
fi
[[ -n "${EMAIL_DOMAIN:-}" ]] && app_params+=("EmailDomain=$EMAIL_DOMAIN")
[[ -n "${INBOUND_EMAIL_DOMAIN:-}" ]] && app_params+=("InboundEmailDomain=$INBOUND_EMAIL_DOMAIN")

# Migrations run before the API and the worker get the new code: first the stack with the new
# migrator and the code that is running now, then the migrations, then the new code. A failed
# migration leaves the old code running against the old schema. Migrations must therefore work
# with the code before them too (add first, remove in a later deploy).
running_key=$(aws cloudformation describe-stacks --region "$region" --stack-name "veriqall-$env-app" \
  --query "Stacks[0].Parameters[?ParameterKey=='ArtifactKey'].ParameterValue" --output text 2>/dev/null || true)
if [[ -z "$running_key" || "$running_key" == "None" ]]; then
  # First deploy: no older code to keep running.
  deploy app app.yml "${app_params[@]}"
elif [[ "$running_key" != "$artifact_key" ]]; then
  deploy app app.yml "${app_params[@]/#ArtifactKey=*/ArtifactKey=$running_key}" "MigratorArtifactKey=$artifact_key"
fi

echo "::group::migrate"
migrator=$(output "veriqall-$env-app" MigratorFunctionName)
result=$(mktemp)
meta=$(aws lambda invoke --region "$region" --function-name "$migrator" \
  --cli-read-timeout 330 --cli-binary-format raw-in-base64-out "$result")
cat "$result"
echo
if grep -q FunctionError <<<"$meta"; then
  echo "migrations failed" >&2
  exit 1
fi
echo "::endgroup::"

deploy app app.yml "${app_params[@]}" "MigratorArtifactKey=$artifact_key"
if [[ -n "${EMAIL_DOMAIN:-}" ]]; then
  echo "DNS records for e-mail (add at one.com once):"
  output "veriqall-$env-app" EmailDnsRecords | tr '|' '\n'
fi
if [[ -n "${INBOUND_EMAIL_DOMAIN:-}" ]]; then
  # SES has one active receipt rule set per account and region; this environment's becomes it.
  # Older bootstrap stacks lack the permission: then a warning, and it is done by hand once.
  rule_set=$(output "veriqall-$env-app" InboundRuleSetName)
  active=$(aws ses describe-active-receipt-rule-set --region "$region" --query Metadata.Name --output text 2>/dev/null || true)
  if [[ "$active" != "$rule_set" ]]; then
    if ! aws ses set-active-receipt-rule-set --region "$region" --rule-set-name "$rule_set"; then
      echo "::warning::Could not make $rule_set the active SES receipt rule set. Update the bootstrap stack (infra/README.md, step 1) or activate it in the SES console."
    fi
  fi
  echo "DNS records for incoming e-mail (add at one.com once):"
  output "veriqall-$env-app" InboundDnsRecords | tr '|' '\n'
fi

echo "::group::smoke test"
endpoint=$(output "veriqall-$env-app" DefaultEndpoint)
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 20 "$endpoint/health"; then
    echo
    echo "::endgroup::"
    exit 0
  fi
  echo "health check attempt $attempt failed" >&2
  sleep 10
done
echo "health check failed" >&2
exit 1
