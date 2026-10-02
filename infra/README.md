# infra

CloudFormation (YAML) for VeriQall, én stack per lag og miljø. Alle stacker heter `veriqall-<miljø>-<lag>`.

| Mal | Stack | Innhold | Deployes av |
|---|---|---|---|
| `bootstrap.yml` | `veriqall-<miljø>-bootstrap` | artefaktbøtte, CloudFormation-rolle, tillegg til GitHub-rollen | admin, én gang per miljø |
| `network.yml` | `veriqall-<miljø>-network` | VPC, subnett, S3-endepunkt, NAT-instans (staging) eller NAT Gateway (prod) | `deploy.sh` |
| `data.yml` | `veriqall-<miljø>-data` | KMS-nøkkel, RDS Postgres 17, lydbøtte, app-hemmelighet | `deploy.sh` |
| `app.yml` | `veriqall-<miljø>-app` | API- og migrator-Lambda, HTTP API | `deploy.sh` |
| `amplify-web.yml` | `veriqall-<miljø>-web` | Amplify-appen (Next.js) | admin, manuelt |

## Slik deployes et miljø

1. **Bootstrap (én gang, som admin):**

   ```
   aws cloudformation deploy --region eu-north-1 \
     --stack-name veriqall-staging-bootstrap \
     --template-file infra/bootstrap.yml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides Environment=staging DeployRoleName=callsenter-staging-deploy
   ```

   Den gir GitHub-rollen lov til å deploye `veriqall-staging-*`-stacker gjennom en egen CloudFormation-rolle, laste opp Lambda-pakker og starte migrator-Lambdaen. Rollen trenger ikke noe mer. Den eldre inline-policyen `callsenter-deploy-permissions` på rollen (RDS, Amplify og Secrets Manager direkte) bør fjernes når bootstrap er på plass, så GitHub ikke kan endre ressurser utenom CloudFormation.

2. **Resten skjer ved push** til `staging` (eller `main` for produksjon): `.github/workflows/deploy-*.yml` bygger Lambda-pakken og kjører `infra/deploy.sh`. Skriptet deployer network → data → app, kjører migrasjonene via migrator-Lambdaen og sjekker `GET /health`.

Produksjons-workflowen gjør ingenting før repo-variabelen `PRODUCTION_ENABLED` er satt til `true` (ved lansering).

En deploy kan også startes manuelt: **Actions → Deploy to staging → Run workflow** (velg branchen `staging`). Det trengs for eksempel etter at en variabel på GitHub Environment er endret.

## Valgfrie variabler på GitHub Environment

- `ALERT_EMAIL`: e-post når NAT-instansen er nede (staging).
- `API_DOMAIN_NAME` og `API_CERTIFICATE_ARN`: eget domene for API-et, for eksempel `api.staging.veriqall.no`, med ACM-sertifikat validert via CNAME hos one.com. Stack-outputen `ApiDomainTarget` er CNAME-målet.
- `IDURA_DOMAIN`: Idura-domenet for BankID, uten `https://`. Mangler den, er BankID-knappen «ikke satt opp».
- `APP_ORIGIN`: adressen til web-appen. Standard er `https://staging.veriqall.no` og `https://app.veriqall.no`.

Vipps-verten følger miljøet: `apitest.vipps.no` i staging og `api.vipps.no` i produksjon.

## Etter første deploy

- Fyll inn verdiene i hemmeligheten `callsenter/<miljø>/app` (Vipps, Idura, Soniox) i Secrets Manager. CloudFormation lager den tom og overskriver den aldri.
- Hovedbrukeren i RDS (`veriqall_owner`) har et passord som AWS lager og roterer selv. Lambdaene for API og innlogging logger inn med IAM, uten passord.

## Opprette en superadmin

Superadmins opprettes bare via migrator-Lambdaen, aldri fra API-et. I AWS-konsollen: Lambda → `veriqall-<miljø>-migrator` → **Test**, med denne hendelsen:

```json
{ "action": "invite-platform-admin", "fullName": "Fornavn Etternavn", "phone": "+47XXXXXXXX" }
```

Svaret inneholder en invitasjonslenke som varer i 72 timer og bare kan brukes én gang. Lenken skrives ikke til loggen. Åpne den og logg inn med BankID (eller Vipps med samme mobilnummer). Superadmin-rettighetene gjelder bare i økter startet med BankID. Kjøres hendelsen på nytt for samme nummer, lages en ny lenke til samme bruker.

## Hvis en stack feiler første gang

Feiler en stack allerede ved opprettelsen, havner den i `ROLLBACK_COMPLETE` og kan bare slettes. GitHub-rollen har ikke lov til å slette stacker, så en admin sletter den (den inneholder ingen ressurser da), og neste deploy oppretter den på nytt.

## Ressurser som ikke slettes med stacken

KMS-nøkkelen, lydbøtta, app-hemmeligheten og artefaktbøtta beholdes hvis stacken slettes, og databasen får et siste øyeblikksbilde. Databasen har i tillegg slettebeskyttelse.
