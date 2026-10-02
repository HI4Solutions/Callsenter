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
- `deploy-staging.yml` og `deploy-production.yml` ligger på `staging` og kjører `infra/deploy.sh` (se PR 4 under). Ingenting av dette ligger på `main` ennå, så produksjons-workflowen har aldri kjørt.
- Hele planen i `docs/plan.md`, med beslutningene fra 2. oktober i seksjon 9: AWS med RDS (ikke Supabase), NAT-instans i staging og NAT Gateway i produksjon, produksjon opprettes først ved lansering. Innloggingsdesignet i `docs/auth.md`.
- Fase 0, PR 2 (datamodell og tilgang): migrasjonen `packages/db/migrations/0001_foundation.sql` med fase 0-tabellene, RLS, rollene `app_user` og `app_auth`, rettighetskatalogen (speilet fra `packages/shared/src/permissions.ts`), seeding av standardroller per callsenter, vern mot å gi bort rettigheter man ikke har, og append-only `audit_log` og `access_log`. Migreringsverktøy i `packages/db/src`. 31 databasetester kjører i CI mot Postgres 17 (og lokalt mot 16).
- Staging er deployet 2. oktober: `veriqall-staging-network`, `-data` (RDS Postgres 17.9) og `-app`. Migrasjonen `0001_foundation` er kjørt av migratoren, innloggingsbrukerne har IAM-innlogging, pgAudit er på, og `GET /health` svarer `ok`. Deploy kan også startes manuelt (Actions → Deploy to staging → Run workflow).
- Fase 0, PR 4 (infrastruktur): CloudFormation-maler i `infra/` (bootstrap, network, data, app), Lambda-kode i `apps/api` (API med `/health`, migrator), provisjonering av databasebrukere med IAM-innlogging i `packages/db/src/provision.ts`, og `infra/deploy.sh` som brukes av deploy-workflowene. Bootstrap-stacken `veriqall-staging-bootstrap` er opprettet 2. oktober (med slettebeskyttelse), og den gamle inline-policyen `callsenter-deploy-permissions` er fjernet fra `callsenter-staging-deploy`. Produksjonsrollen har den fortsatt (fjernes når produksjon bootstrappes). Produksjons-workflowen er sperret bak repo-variabelen `PRODUCTION_ENABLED`.
- Staging-frontend: Amplify-appen `veriqall-staging` (Next.js SSR) er opprettet i `eu-north-1` med CloudFormation-stacken `veriqall-staging-web` fra `infra/amplify-web.yml`. Første bygg av PR-branchen gikk grønt (Node 22, Next 16). URL-en står i stackens output og i Amplify-konsollen. Amplify GitHub-appen er installert og GitHub-tokenet ligger i Secrets Manager (`callsenter/staging/github-token`). Staging og produksjon ligger i samme AWS-konto (planen anbefaler separate, se seksjon 8). Amplify-stacken kjøres fortsatt manuelt.
- Fase 0, PR 1 (skjelett og design): monorepo med npm workspaces, Next.js 16 i `apps/web` med Tailwind 4, designtokens i lys og mørk modus (system, lys, mørk, huskes i nettleseren), Schibsted Grotesk via `@fontsource-variable` (selvhostet), `/design` med paletten og AI-flagg (bare i lokal utvikling, `page.dev.tsx`), og `ci.yml` (lint, typecheck, test og build på hver PR, ingen deploy). Tokens og kontrast er dekket av tester. De godkjente brandfilene, `docs/brand-preview.png` og `tools/brand/` er lagt inn (logoen er ikke formelt godkjent ennå).

- Fase 0, PR 3 (innlogging): Vipps Logg inn og BankID via Idura i `apps/api/src/auth`, migrasjonen `0002_login.sql` (BankID kreves for administrative rettigheter og superadmin), `/logg-inn` i web-appen, og superadmin-invitasjon via migratoren (`infra/README.md`). Nøklene for Vipps og Idura (begge produksjonsmiljøet, ekte innlogging) og Soniox ligger i `callsenter/staging/app`. `IDURA_DOMAIN` er satt på Environment `staging`. Testet i staging 2. oktober: innlogging med både BankID og Vipps virker, og Nadeem er invitert som superadmin. Amplify-stacken er oppdatert med `NEXT_PUBLIC_API_URL`.

- Fase 1, PR A (superadmin, Callsentre): `/admin` med faner og fanen Callsentre (opprette og endre callsentre, prøveperiode og suspensjon, moduler, brukere, invitasjonslenker), API under `/admin/*` i `apps/api/src/admin`, migrasjonen `0003_superadmin_portal.sql` og modulkatalogen i `packages/shared/src/modules.ts`.
- Fase 1, PR B (superadmin, Brukere og Roller og moduler): søk på tvers av callsentre, brukerdetaljer (profil, deaktivering, superadmin av og på, callsentre, innloggingsmetoder, aktive økter, tvangsutlogging, siste innlogginger), CSV-eksport, og oversikt over moduler, standardroller og rettigheter. Migrasjonen `0004_superadmin_users.sql` (superadmin fra portalen med vern, og `app.admin_*`-funksjoner for oppslag og handlinger på tvers av callsentre).
- Fase 1, PR C (superadmin, Sikkerhet): oversikt over innlogginger (mislykkede per IP og bruker), revisjonslogg med filter, detaljer og CSV, tilgangslogg, og IP-sperring som sjekkes på hvert API-kall (`apps/api/src/blocklist.ts`). Migrasjonen `0005_security.sql`.
- Fase 1, PR D (superadmin, Meldinger og Vekst): kunngjøringer til alle eller valgte callsentre, vist som banner for innloggede brukere (`GET /announcements`), og Vekst med nøkkeltall, grafer (`apps/web/src/components/admin/charts.tsx`) og markedsføringshendelser. Migrasjonen `0006_messages_growth.sql`.
- Fase 1, adminportalen for callsentrene, PR E1 (`docs/plan.md`, seksjon 11): `/administrasjon` med Brukere og Team, API under `/org/*` i `apps/api/src/org`, bytte av aktivt callsenter (`POST /me/organization`) og migrasjonen `0008_org_admin.sql`.
- Fase 1, adminportalen PR E2: Roller (`/administrasjon/roller`, `apps/api/src/org/roles.ts`) og samtaletråder mellom admin og superadmin (`/administrasjon/meldinger` og superadmin Meldinger → Samtaler, `apps/api/src/org/threads.ts`). Migrasjonen `0009_support_threads.sql`.
- Bare innlogging for besøkende (2. oktober): `/` sender til `/logg-inn`, som bare viser innloggingsvalgene og sender innloggede videre til Superadmin, Administrasjon eller Min konto. `/admin`, `/administrasjon` og `/konto` sender utloggede til innlogging (med `?neste=`), og portaltitlene settes først når tilgangen er bekreftet. Ingen utviklingsinformasjon er synlig uten innlogging. `X-Robots-Tag: noindex` på alle svar, ingen `X-Powered-By`. Returstier etter innlogging sjekkes likt i web, API og database (`safeAppPath` i `packages/shared`, migrasjonen `0010_return_path.sql`).
- Passkeys: innlogging med passkey (WebAuthn, `apps/api/src/auth/passkey.ts`), som teller som sterk innlogging som BankID. Legges til under `/konto` i en BankID-økt. Migrasjonen `0007_passkeys.sql`. Se `docs/auth.md`.

Ikke gjort:
- Vipps-knappen må byttes til Vipps' offisielle før produksjon.
- Produksjon er ikke opprettet, og skal ikke opprettes før lansering. Be om økt Lambda-kvote (nye kontoer har 10 samtidige kjøringer) før produksjon.
- Egne domener for produksjon (`app.veriqall.no`, `api.veriqall.no`). I staging virker `staging.veriqall.no` og `api.staging.veriqall.no`.
- CloudTrail til egen kryptert bøtte (revisjonslogg lag 1 i `docs/plan.md`, seksjon 3) er ikke satt opp.
- Environment `production` er ikke verifisert (Claude har ikke tilgang til Environments-APIet). Sjekk at det finnes og krever godkjenning av Nadeem.

- Fase 1, PR F2 (salg): migrasjonen `0012_sales.sql` (salg med statusløp, historikk i `sale_events`, synlighet som for samtaler), statusløpet i `packages/shared/src/sales.ts`, API under `/org/sales`, og sidene `/salg` og `/salg/[id]`. Selgere lander på `/salg`.
- Fase 1, PR F1 (grunndata): kunder (privat og bedrift, ingen fødselsnumre) og produkter med versjonerte produktmaler, migrasjonen `0011_customers_products.sql`, API under `/org/customers` og `/org/products`, og sidene `/kunder` og `/produkter` (`docs/plan.md`, seksjon 12).

**Neste steg:** Fase 1 er på plass: superadmin-portalen (`docs/plan.md`, seksjon 10; fanene System og Økonomi kommer i fase 2 og 4), adminportalen for callsentrene (seksjon 11) og grunndataene (seksjon 12: kunder, produktmaler og salg). Neste er fase 2, samtalen: opptak, transkribering med Soniox, AI-kontroll mot produktmalen og rapporter.

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
| Innlogging | Vipps Logg inn og BankID via Idura, begge OIDC, og passkeys (WebAuthn) |
| IaC | CloudFormation (YAML) i `infra/`, deployet av `infra/deploy.sh` |
| CI/CD | GitHub Actions med OIDC mot AWS, aldri lagrede AWS-nøkler |
| Miljøer | `staging` og `production`, helt adskilt med egne nøkler |
