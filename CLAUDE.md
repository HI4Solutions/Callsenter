# VeriQall

VeriQall er en plattform for callsentre som selger på telefon. Samtalene tas opp og transkriberes, AI sjekker dem mot produktmalen, kunden bekrefter kjøpet digitalt, og alt samles som dokumentasjon for oppfølging, klager og coaching. Mange callsentre deler plattformen, men ser bare sine egne data. Vi (MedInnova, ved Nadeem) er superadmin.

Nadeem skriver norsk, så svar på norsk. Hele planen – moduler, faser, arkitektur, datamodell, design, beslutninger, kostnader og åpne spørsmål – står i [`docs/plan.md`](docs/plan.md). Innloggingen er beskrevet i [`docs/auth.md`](docs/auth.md). Les den før du starter på en ny fase, og oppdater den når noe blir besluttet.

## Repoet er offentlig inntil videre

- Ingen hemmeligheter, tokens, API-nøkler, AWS-kontonummer, ARN-er, prosjekt-ID-er eller ekte persondata i repoet. Det gjelder også commits som fjernes etterpå, fordi git-historikken er offentlig.
- Lokale verdier ligger i `.env` (står i `.gitignore`). Bare `.env.example` med plassholdere sjekkes inn.
- I skyen ligger hemmeligheter i AWS Secrets Manager, adskilt per miljø.
- Repoet skal gjøres privat (GitHub Pro) før ekte nøkler eller kundedata tas i bruk.

## Hvor vi slapp – 2. oktober 2026

Oppdater denne seksjonen i hver PR som endrer status, så neste økt alltid vet hvor vi er.

Ferdig:
- Repoet er opprettet (heter fortsatt `Callsenter`, kan døpes om til `veriqall`). Rulesettet `main-protection` er aktivt på `main` og krever PR, og forbyr sletting og force-push. `staging` finnes og er ubeskyttet.
- AWS-konto i `eu-north-1`. OIDC mot AWS virker fra Environment `staging` (kjøring #5 av `deploy-staging.yml` gikk grønt 26. sep. etter å ha rettet trust policy). Rollenavn og rettigheter er ikke gjennomgått.
- `deploy-staging.yml` og `deploy-production.yml` ligger på `staging`. De logger bare inn i AWS og kjører `sts get-caller-identity`; migrasjoner og øvrige deploy-steg er TODO (PR 4). Ingenting av dette ligger på `main` ennå, så produksjons-workflowen har aldri kjørt.
- Hele planen i `docs/plan.md`, med beslutningene fra 2. oktober i seksjon 9: AWS med RDS (ikke Supabase), NAT-instans i staging og NAT Gateway i produksjon, produksjon opprettes først ved lansering. Innloggingsdesignet i `docs/auth.md`.
- Fase 0, PR 2 (datamodell og tilgang): migrasjonen `packages/db/migrations/0001_foundation.sql` med fase 0-tabellene, RLS, rollene `app_user` og `app_auth`, rettighetskatalogen (speilet fra `packages/shared/src/permissions.ts`), seeding av standardroller per callsenter, vern mot å gi bort rettigheter man ikke har, og append-only `audit_log` og `access_log`. Migreringsverktøy i `packages/db/src`. 31 databasetester kjører i CI mot Postgres 17 (og lokalt mot 16).
- Fase 0, PR 4 (infrastruktur): CloudFormation-maler i `infra/` (bootstrap, network, data, app), Lambda-kode i `apps/api` (API med `/health`, migrator), provisjonering av databasebrukere med IAM-innlogging i `packages/db/src/provision.ts`, og `infra/deploy.sh` som brukes av deploy-workflowene. Bootstrap-stacken `veriqall-staging-bootstrap` er opprettet 2. oktober (med slettebeskyttelse), og den gamle inline-policyen `callsenter-deploy-permissions` er fjernet fra `callsenter-staging-deploy`. Produksjonsrollen har den fortsatt (fjernes når produksjon bootstrappes). Produksjons-workflowen er sperret bak repo-variabelen `PRODUCTION_ENABLED`.
- Staging-frontend: Amplify-appen `veriqall-staging` (Next.js SSR) er opprettet i `eu-north-1` med CloudFormation-stacken `veriqall-staging-web` fra `infra/amplify-web.yml`. Første bygg av PR-branchen gikk grønt (Node 22, Next 16). URL-en står i stackens output og i Amplify-konsollen. Amplify GitHub-appen er installert og GitHub-tokenet ligger i Secrets Manager (`callsenter/staging/github-token`). Staging og produksjon ligger i samme AWS-konto (planen anbefaler separate, se seksjon 8). Amplify-stacken kjøres fortsatt manuelt.
- Fase 0, PR 1 (skjelett og design): monorepo med npm workspaces, Next.js 16 i `apps/web` med Tailwind 4, designtokens i lys og mørk modus (system, lys, mørk, huskes i nettleseren), Schibsted Grotesk via `@fontsource-variable` (selvhostet), `/design` med paletten og AI-flagg, og `ci.yml` (lint, typecheck, test og build på hver PR, ingen deploy). Tokens og kontrast er dekket av tester. De godkjente brandfilene, `docs/brand-preview.png` og `tools/brand/` er lagt inn (logoen er ikke formelt godkjent ennå).

Ikke gjort:
- Ingen innlogging. Staging: `veriqall-staging-network` og `veriqall-staging-data` (RDS) er deployet 2. oktober. Første forsøk på `veriqall-staging-app` feilet fordi nye AWS-kontoer bare har 10 samtidige Lambda-kjøringer og ikke godtar reservert samtidighet; rettet ved å fjerne reservasjonen. Be om økt Lambda-kvote før produksjon. Produksjon er ikke opprettet, og skal ikke opprettes før lansering.
- Egne domener: `staging.veriqall.no` er koblet til Amplify (CNAME hos one.com). `api.staging.veriqall.no` venter på at ACM-sertifikatet godkjennes; deretter settes GitHub-variablene `API_DOMAIN_NAME` og `API_CERTIFICATE_ARN` i Environment `staging`, og en CNAME `api.staging` legges inn hos one.com.
- Environment `production` er ikke verifisert (Claude har ikke tilgang til Environments-APIet). Sjekk at det finnes og krever godkjenning av Nadeem.

**Neste steg:** merge PR 4, så deployes staging automatisk. Deretter egne domener (`staging.veriqall.no`, `api.staging.veriqall.no`) og fase 0, PR 3 (innlogging, se `docs/auth.md`).

## Kommandoer

Node 22 (se `.nvmrc`). Kjør fra reporoten:

- `npm ci`: installer
- `npm run dev`: utviklingsserver for `apps/web`
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: det samme som `ci.yml` kjører
- `npm test` krever en lokal Postgres for `packages/db` (se `packages/db/README.md`); i skyøkter: `service postgresql start` og `TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres` etter å ha satt passord på `postgres`-brukeren
- `DATABASE_URL=... npm run migrate -w packages/db`: kjør migrasjoner mot en lokal database
- `npm run build -w apps/api`: bygg Lambda-pakken til `apps/api/dist`
- Infrastruktur og deploy: se `infra/README.md`

`public/brand/` i reporoten er kilden til logoer og ikoner; `apps/web` kopierer den til `apps/web/public/brand/` (gitignorert) ved `dev` og `build`.

## Regler for hver endring

- **Callsentre er leietakere.** Alle callsenter-data har `organization_id` og en RLS-policy. API-et kobler til med rollen `app_user`, som er underlagt RLS, og setter `app.current_org_id` og `app.current_user_id` med `SET LOCAL` i hver transaksjon. Policyer bruker `app.current_org_id()`, som bare gir et callsenter når brukeren er aktivt medlem. Innloggingen bruker den smale rollen `app_auth`. Nye tabeller med callsenter-data får RLS, policyer og tester i samme migrasjon.
- **Sjekk rettigheter, ikke rollenavn.** Rettighetene er en fast katalog i koden, mens roller er data per callsenter. Ingen kan gi bort en rettighet de ikke har selv.
- **Produktmaler versjoneres.** En versjon som er tatt i bruk, endres aldri. Samtaler og salg peker på versjonen som gjaldt da.
- **Alt spores.** Endringer skrives til `audit_log` (append-only). Hver visning eller avspilling av opptak og transkripsjon skrives til `access_log`.
- **Persondata:** fødselsnummer lagres bare som hash. Lydfiler nås bare via kortlevde presignerte URL-er.
- **Databaseendringer** skjer bare som migrasjonsfiler som kjøres av CI. Aldri manuelle endringer i produksjon.
- **Flyt:** egen branch → PR mot `staging` → test i staging → PR fra `staging` til `main`. Deploy til produksjon krever godkjenning i Environment `production`.
- **Farger:** grønn, gul og rød er reservert for AI-flagg og status.
- **Språk:** all brukertekst på norsk bokmål. Kode, databasenavn og commit-meldinger på engelsk (forslag, Nadeem kan overstyre).

## Stack

| Del | Valg |
|---|---|
| Frontend | Next.js, TypeScript og Tailwind på AWS Amplify Hosting |
| API | API Gateway og Lambda (TypeScript) |
| Database | PostgreSQL på RDS, samme motor i staging og prod, KMS-kryptert, `rds.force_ssl=1`, pgAudit, point-in-time recovery; Multi-AZ i prod |
| Nettverk | Lambdaer i VPC; NAT-instans i staging, NAT Gateway i prod; migrasjoner via migrator-Lambda |
| Lyd | S3 per miljø, SSE-KMS, kun TLS |
| Transkripsjon | Soniox API |
| AI | Claude via AWS Bedrock i `eu-north-1` |
| Innlogging | Vipps Logg inn og BankID via Idura, begge OIDC |
| IaC | CloudFormation (YAML) i `infra/`, deployet av `infra/deploy.sh` |
| CI/CD | GitHub Actions med OIDC mot AWS, aldri lagrede AWS-nøkler |
| Miljøer | `staging` og `production`, helt adskilt med egne nøkler |
