# infra

CloudFormation (YAML) for VeriQall, én stack per lag og miljø. Alle stacker heter `veriqall-<miljø>-<lag>`.

| Mal | Stack | Innhold | Deployes av |
|---|---|---|---|
| `bootstrap.yml` | `veriqall-<miljø>-bootstrap` | artefaktbøtte, CloudFormation-rolle, tillegg til GitHub-rollen | admin, én gang per miljø |
| `network.yml` | `veriqall-<miljø>-network` | VPC, subnett, S3-endepunkt, NAT-instans (staging) eller NAT Gateway (prod), varslingsemnet for alarmene | `deploy.sh` |
| `data.yml` | `veriqall-<miljø>-data` | KMS-nøkkel, RDS Postgres 17, lydbøtte, app-hemmelighet, lagringstid for databaseloggen, alarmer for databasen | `deploy.sh` |
| `app.yml` | `veriqall-<miljø>-app` | API-, worker- og migrator-Lambda, HTTP API, morgenkjøringen, alarmer for Lambda og API | `deploy.sh` |
| `amplify-web.yml` | `veriqall-<miljø>-web` | Amplify-appen (Next.js) | admin, manuelt |
| `cloudtrail.yml` | `veriqall-cloudtrail` | CloudTrail for hele kontoen, egen KMS-nøkkel og bøtte (revisjonslogg lag 1) | admin, én gang per AWS-konto |

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

2. **Resten skjer ved push** til `staging` (eller `main` for produksjon): `.github/workflows/deploy-*.yml` bygger Lambda-pakken og kjører `infra/deploy.sh`. Skriptet deployer network → data → app med den nye migratoren, kjører migrasjonene via migrator-Lambdaen, gir deretter API-et og workeren den nye koden, og sjekker `GET /health`. Feiler en migrasjon, fortsetter den gamle koden mot det gamle skjemaet. En migrasjon må derfor også virke med koden før den (legg til først, fjern i en senere deploy). Migratoren venter høyst 5 sekunder på en tabellås og prøver opptil 5 ganger, så den aldri får API-et til å stå i kø bak seg.

Produksjons-workflowen gjør ingenting før repo-variabelen `PRODUCTION_ENABLED` er satt til `true` (ved lansering). Produksjon krever i tillegg `API_DOMAIN_NAME` og `API_CERTIFICATE_ARN`, ellers stopper `deploy.sh`: web-appen kaller `https://api.veriqall.no`, og innloggingen virker bare på det domenet.

En deploy kan også startes manuelt: **Actions → Deploy to staging → Run workflow** (velg branchen `staging`). Det trengs for eksempel etter at en variabel på GitHub Environment er endret.

## Valgfrie variabler på GitHub Environment

- `ALERT_EMAIL`: e-post for alarmene i miljøet (se Overvåking). AWS sender først en e-post der abonnementet må bekreftes. Uten variabelen beholder `deploy.sh` adressen som allerede står på network-stacken (parameteren `AlertEmail`), så den kan også settes direkte på stacken. I staging er den satt slik 3. oktober 2026.
- `API_DOMAIN_NAME` og `API_CERTIFICATE_ARN`: eget domene for API-et, for eksempel `api.staging.veriqall.no`, med ACM-sertifikat validert via CNAME hos one.com. Stack-outputen `ApiDomainTarget` er CNAME-målet.
- `IDURA_DOMAIN`: Idura-domenet for BankID, uten `https://`. Mangler den, er BankID-knappen «ikke satt opp».
- `APP_ORIGIN`: adressen til web-appen. Standard er `https://staging.veriqall.no` og `https://app.veriqall.no`.
- `EMAIL_DOMAIN`: slår på e-post (invitasjoner og fakturaer). Domenet e-post sendes fra (`noreply@`), `staging.veriqall.no` i staging og `veriqall.no` i produksjon. Lager SES-identiteten. Krever at bootstrap-stacken er oppdatert med SES- og EventBridge-rettigheter (kjør steg 1 på nytt med den nye malen). Deploy-loggen og stack-outputen `EmailDnsRecords` viser DNS-postene som skal inn hos one.com: tre DKIM-CNAME-er, og MX og SPF for `mail.<domene>`. Legg i tillegg inn DMARC (`_dmarc.<domene>` TXT `v=DMARC1; p=none;`). Til SES-kontoen er tatt ut av sandkassen (søkes om én gang per konto og region), kan det bare sendes til verifiserte adresser.
- `INBOUND_EMAIL_DOMAIN`: slår på innkommende e-post til Superadmin → Meldinger → Henvendelser (`docs/plan.md`, seksjon 20), for eksempel `svar.staging.veriqall.no`. Krever `EMAIL_DOMAIN`. Lager SES-identiteten for domenet, en bøtte for e-postene (30 dager) og mottaksregelen, og `deploy.sh` gjør regelen aktiv (én aktiv per konto og region; krever bootstrap-stacken fra 4. oktober eller nyere, ellers en advarsel og aktivering for hånd). Deploy-loggen og stack-outputen `InboundDnsRecords` viser postene hos one.com: MX til `inbound-smtp.eu-north-1.amazonaws.com` og tre DKIM-CNAME-er.

## Kapasitet

- **Lambda-kvoten** i `eu-north-1` er 1000 samtidige kjøringer (økt 3. oktober 2026, gjelder kontoen). Nye kontoer har 10, så en ny konto for produksjon må få kvoten økt før første deploy.
- **Workeren** har et tak på 200 samtidige kjøringer (`WorkerConcurrency` i `infra/app.yml`), så bitvis transkripsjon aldri tar API-ets del av kvoten. Kontoen må beholde minst 100 kjøringer uten reservasjon.
- **API-et** tåler 200 kall i sekundet, med topper på 500 (`ApiRateLimit` og `ApiBurstLimit`), for alle callsentre samlet. Hvert pågående opptak bruker omtrent ett kall annethvert sekund.

## Overvåking

Alarmene sender til SNS-emnet `veriqall-<miljø>-alerts`, som sender e-post til `ALERT_EMAIL`. Uten `ALERT_EMAIL` vises alarmene bare i CloudWatch. Hver alarm sier også fra når den er tilbake til normalt.

| Alarm | Slår til når |
|---|---|
| `veriqall-<miljø>-api-errors` | API-Lambdaen feiler minst 5 ganger på 5 minutter |
| `veriqall-<miljø>-api-throttles` | API-Lambdaen blir strupet (Lambda-kvoten er brukt opp) |
| `veriqall-<miljø>-api-5xx` | HTTP API-et svarer 5xx minst 10 ganger på 5 minutter |
| `veriqall-<miljø>-worker-errors` | workeren feiler minst 5 ganger på 5 minutter (biter, samtaler, notater) |
| `veriqall-<miljø>-worker-throttles` | workeren har nådd taket (`WorkerConcurrency`), så biter venter |
| `veriqall-<miljø>-daily-run` | EventBridge fikk ikke startet morgenkjøringen |
| `veriqall-<miljø>-billing` | faktureringen i morgenkjøringen eller en faktura-e-post feilet (se workerens logg) |
| `veriqall-<miljø>-db-cpu` | databasen har brukt over 80 % CPU i 15 minutter |
| `veriqall-<miljø>-db-storage` | databasen har under 2 GB ledig lagring |
| `veriqall-<miljø>-db-connections` | over 60 tilkoblinger (`DbConnectionsAlarmThreshold`, db.t4g.micro tåler rundt 80) |
| NAT-instansen (staging) | NAT-instansen kjører ikke, så Lambdaene kommer ikke ut på nettet |

**Morgenkjøringen** (kl. 04:00 UTC via EventBridge) går uansett om e-post er satt opp: fakturaer og faste avtaler, uteblitte betalinger, USD/NOK-kursen, og ryddingen som sletter samtaler etter lagringstiden også i callsentre som ikke lenger tar opp. Uten e-post sendes bare ingen fakturaer på e-post.

**Databaseloggen** (`/aws/rds/instance/veriqall-<miljø>/postgresql`, med pgAudit og tilkoblinger) lages av RDS selv. En liten funksjon i data-stacken (`veriqall-<miljø>-db-log-settings`) gir den lagringstid (`LogRetentionDays`, 365 dager) og miljøets KMS-nøkkel ved hver endring.

**Artefaktbøtta** beholder Lambda-pakkene stackene bruker (under 2 MB hver), så en deploy som feiler lenge etter forrige deploy, kan rulles tilbake. Bare overskrevne versjoner slettes, etter 30 dager. Bootstrap-stacken i staging er oppdatert med dette 3. oktober 2026.

## Revisjonslogg i AWS (CloudTrail)

`infra/cloudtrail.yml` gir revisjonsloggens lag 1 (`docs/plan.md`, seksjon 3): én trail (`veriqall`) for alle regioner i kontoen, med globale tjenester (IAM) og log file validation, til en egen bøtte kryptert med en egen KMS-nøkkel (`alias/veriqall-cloudtrail`, årlig rotasjon). Bare administrasjonshendelser (hvem endret hva i kontoen), ikke datahendelser; den første kopien av dem er gratis.

- **Låst i 365 dager** med S3 Object Lock (governance) og slettet etter det (`RetentionDays`).
- **Utenfor deploy-kjeden:** stacken heter ikke `veriqall-<miljø>-*`, så GitHub-rollen kan ikke endre den, og roller under `/veriqall/` (de CloudFormation-rollen kan lage) nektes å lese, slette eller løsne loggene og å slå av eller slette nøkkelen.
- **Sjekk at loggene er urørt:** `aws cloudtrail validate-logs --trail-arn <TrailArn> --start-time <tid>` (stack-outputen `TrailArn`).

Opprettet i staging-kontoen 3. oktober 2026, med slettebeskyttelse. Med egen konto for produksjon deployes den én gang til der:

```
aws cloudformation deploy --region eu-north-1 \
  --stack-name veriqall-cloudtrail \
  --template-file infra/cloudtrail.yml
aws cloudformation update-termination-protection --region eu-north-1 \
  --stack-name veriqall-cloudtrail --enable-termination-protection
```

Vipps-verten er `api.vipps.no` (produksjon) i begge miljøer. Staging bruker egne nøkler fra en salgsenhet i Vipps-produksjon, se `docs/auth.md`.

## Etter første deploy

- Fyll inn verdiene i hemmeligheten `callsenter/<miljø>/app` (Vipps, Idura, Soniox) i Secrets Manager. CloudFormation lager den tom og overskriver den aldri. `SONIOX_API_KEY` må komme fra et Soniox-prosjekt i EU-regionen, siden VeriQall bruker EU-endepunktene.
- Slå på Claude Sonnet 4.6, Sonnet 4.5, Opus 4.5 og Haiku 4.5 under Model access i Bedrock-konsollen i `eu-north-1`. Superadmin velger modell under System; workeren (`veriqall-<miljø>-worker`) kaller den gjennom EU-inferensprofilen (`eu.anthropic.*`).
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
