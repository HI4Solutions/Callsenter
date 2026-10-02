# infra

IaC for staging og produksjon. Verktøy for resten av infrastrukturen (Terraform eller CDK) er ikke bestemt, se `docs/plan.md`, seksjon 8.

## amplify-web.yml

CloudFormation-mal for frontend på AWS Amplify Hosting (Next.js SSR), én stack per miljø. Appen kobles til GitHub-branchen med samme navn som miljøet (`staging` eller `production`), og staging bygger også PR-forhåndsvisninger.

Forutsetninger (engangsoppsett per konto):

1. Amplify GitHub-appen er installert for regionen: `https://github.com/apps/aws-amplify-eu-north-1/installations/new`, med tilgang til repoet.
2. Et klassisk GitHub-token med bare scope `admin:repo_hook` ligger som ren tekst i Secrets Manager under `callsenter/<miljø>/github-token`. Tokenet sjekkes aldri inn i repoet.

Deploy (krever `CAPABILITY_IAM`):

```
aws cloudformation deploy \
  --region eu-north-1 \
  --stack-name veriqall-staging-web \
  --template-file infra/amplify-web.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Environment=staging
```

GitHub Actions-rollene har foreløpig ikke CloudFormation-rettigheter, så stacken kjøres manuelt til infrastruktur-PR-en (fase 0, PR 4) er på plass.
