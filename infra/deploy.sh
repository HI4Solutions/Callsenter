#!/usr/bin/env bash
# Deploys one environment: network, data and app stacks, then runs the migrations and a smoke
# test. Used by .github/workflows/deploy-*.yml. Requires the bootstrap stack
# (infra/bootstrap.yml) and the Lambda zip at apps/api/lambda.zip.
#
# Optional environment variables: ALERT_EMAIL, API_DOMAIN_NAME, API_CERTIFICATE_ARN, APP_ORIGIN,
# IDURA_DOMAIN, EMAIL_DOMAIN.
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
deploy app app.yml "${app_params[@]}"
if [[ -n "${EMAIL_DOMAIN:-}" ]]; then
  echo "DNS records for e-mail (add at one.com once):"
  output "veriqall-$env-app" EmailDnsRecords | tr '|' '\n'
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
