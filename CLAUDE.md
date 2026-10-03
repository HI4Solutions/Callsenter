# VeriQall

VeriQall er en plattform for callsentre som selger på telefon. Samtalene tas opp og transkriberes, AI sjekker dem mot produktmalen, kunden bekrefter kjøpet digitalt, og alt samles som dokumentasjon for oppfølging, klager og coaching. Mange callsentre deler plattformen, men ser bare sine egne data. Vi (Hi4 Solutions AS, ved Nadeem) er superadmin.

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
- Superadmin → Oversikt (3. oktober, dashboard per nivå): ny første fane `/admin/oversikt` (`/admin` sender dit) med «Trenger oppmerksomhet», samtaler og innlogginger per dag, drift og kø, mest aktive callsentre, prøveperioder og tilgang som går ut, callsentre med lite aktivitet, økonomi og meldinger. Migrasjonen `0032_platform_overview.sql` (`app.platform_overview()`, bare antall) og `GET /admin/overview` (`apps/api/src/admin/overview.ts`).
- Fase 1, adminportalen for callsentrene, PR E1 (`docs/plan.md`, seksjon 11): `/administrasjon` med Brukere og Team, API under `/org/*` i `apps/api/src/org`, bytte av aktivt callsenter (`POST /me/organization`) og migrasjonen `0008_org_admin.sql`.
- Fase 1, adminportalen PR E2: Roller (`/administrasjon/roller`, `apps/api/src/org/roles.ts`) og samtaletråder mellom admin og superadmin (`/administrasjon/meldinger` og superadmin Meldinger → Samtaler, `apps/api/src/org/threads.ts`). Migrasjonen `0009_support_threads.sql`.
- Bare innlogging for besøkende (2. oktober): `/` sender til `/logg-inn`, som bare viser innloggingsvalgene og sender innloggede videre til Superadmin, Administrasjon eller Min konto. `/admin`, `/administrasjon` og `/konto` sender utloggede til innlogging (med `?neste=`), og portaltitlene settes først når tilgangen er bekreftet. Ingen utviklingsinformasjon er synlig uten innlogging. `X-Robots-Tag: noindex` på alle svar, ingen `X-Powered-By`. Returstier etter innlogging sjekkes likt i web, API og database (`safeAppPath` i `packages/shared`, migrasjonen `0010_return_path.sql`).
- Passkeys: innlogging med passkey (WebAuthn, `apps/api/src/auth/passkey.ts`), som teller som sterk innlogging som BankID. Legges til under `/konto` i en BankID-økt. Migrasjonen `0007_passkeys.sql`. Se `docs/auth.md`.

Ikke gjort:
- Vipps-knappen må byttes til Vipps' offisielle før produksjon.
- Produksjon er ikke opprettet, og skal ikke opprettes før lansering. Lambda-kvoten er økt til 1000 i kontoen (3. oktober); en egen produksjonskonto må få den økt på nytt.
- Egne domener for produksjon (`app.veriqall.no`, `api.veriqall.no`). I staging virker `staging.veriqall.no` og `api.staging.veriqall.no`.
- CloudTrail til egen kryptert bøtte (revisjonslogg lag 1 i `docs/plan.md`, seksjon 3) er ikke satt opp.
- Environment `production` er ikke verifisert (Claude har ikke tilgang til Environments-APIet). Sjekk at det finnes og krever godkjenning av Nadeem.

- Fase 2 (samtalen): opptak i nettleseren med mikrofon eller fanelyd, sanntid eller bitvis via Soniox i EU, lagret opptak i S3 med lagringstid 3–12 måneder per callsenter, AI-kontroll mot produktmalen og rapporter med Claude via Bedrock, worker-Lambdaen `veriqall-<env>-worker`, migrasjonen `0013_calls.sql` (`docs/plan.md`, seksjon 13).
- Fase 1, PR F2 (salg): migrasjonen `0012_sales.sql` (salg med statusløp, historikk i `sale_events`, synlighet som for samtaler), statusløpet i `packages/shared/src/sales.ts`, API under `/org/sales`, og sidene `/salg` og `/salg/[id]`. Selgere lander på `/salg`.
- Dashboard for ledere (`docs/plan.md`, seksjon 15): periodevalg (i dag, i går, uke, måned …), AI-flaggene som klikkbar stolpe og per time eller dag, samtalene i perioden med selger og flagg, og logg per samtale (`GET /org/calls/{id}/log`). Migrasjonen `0024_dashboard_flags.sql`.
- Bitvis transkripsjon som i MedSide (`docs/plan.md`, seksjon 13): en hel lydfil hvert 15. sekund transkriberes med Soniox `stt-async-v5` mens samtalen pågår, og bitene blir transkripsjonen. Standard fra 3. oktober; sanntid kan velges under System. Migrasjonen `0023_call_pieces.sql`. Hver bit er en Lambda-kjøring, så Lambda-kvoten må økes før produksjon.
- Samtalestudio (`docs/plan.md`, seksjon 18): `/samtaler/opptak` etter Notatstudio i MedSide, med varsellamper per obligatorisk punkt, transkripsjon som ikke kan endres, tilleggsinformasjon, notater som selgeren kan justere (AI-teksten beholdes) og notatmaler i stedet for tilleggsmaler (flere kan være på, ett notat hver, også ved «Regenerer»). Migrasjonen `0022_call_studio.sql`.
- Økonomi, PR 3: Regnskap med kostnader mot inntekter, nettoresultat, MRR og ARR, utvikling per måned, omsetningsrapport med CSV, manuelle poster og faste månedskostnader. Migrasjonen `0021_accounting.sql`, API under `/admin/accounting/*`.
- Økonomi, PR 2: Forbruk med kostnad per callsenter (KI, Soniox, eID), pristabell og USD/NOK fra Norges Bank (morgenkjøringen). Migrasjonen `0020_usage_costs.sql`, API under `/admin/usage/*`.
- Økonomi, PR 1 (`docs/plan.md`, seksjon 16): Økonomi-fanen med underfanene Forbruk, Stripe, Faktura og Regnskap etter Nadeems beskrivelse. Faktura v2 har kunder med kundenummer, pakker med moduler, tilgang styrt av faktura og betaling (stenges 5 dager etter uteblitt betaling), planlagt sending, gjentakende fakturaer som sendes automatisk, PDF med logo og e-post. Migrasjonen `0019_billing_v2.sql`, og morgenkjøringen i workeren (EventBridge, kommer med `EMAIL_DOMAIN`).
- E-post (`docs/plan.md`, seksjon 17): Amazon SES med eget avsenderdomene per miljø (`EMAIL_DOMAIN`), invitasjoner og fakturaer på e-post (`apps/api/src/email.ts`), migrasjonen `0018_invoice_emails.sql`. Krever oppdatert bootstrap, DNS hos one.com og produksjonstilgang i SES.
- Fase 4B (fakturering, `docs/plan.md`, seksjon 16): Hi4 Solutions AS fakturerer callsentrene under Økonomi (utkast, sending med nummerserie, frys, betaling, kreditnota, faste avtaler, forbruk), og callsenteret ser sine fakturaer under Administrasjon. Migrasjonen `0017_invoicing.sql`. Bygget på fase 4A-branchen. Ingen e-post og ingen Stripe ennå.
- Fase 4A (dashboard og coaching, `docs/plan.md`, seksjon 15): `/oversikt` med egne tall, teamets eller hele callsenterets, og tilbakemeldinger fra leder til selger. Migrasjonen `0016_dashboard_coaching.sql`. Bygget på fase 3-branchen. Beslutningene venter på godkjenning.
- Dashboard per nivå, PR 2 (3. oktober): fanen Kvalitet for compliance (`dashboard.all` og `flags.review` eller `complaints.manage`): køen av flagg etter alder, tid til behandling, avvik per produkt og selger, klager, kundeaksept og (med `audit.read`) hvem som åpner opptak. Migrasjonen `0033_quality_dashboard.sql`.
- Fase 3 (salgsverifisering, dokumentasjon og klager, `docs/plan.md`, seksjon 14): kunden godtar tilbudet via lenke med BankID eller Vipps (`apps/api/src/confirm`, `/bekreft/[token]`), dokumentasjon per salg (`/salg/[id]/dokumentasjon`) og klagesaker (`/klager`). Migrasjonene `0014_sale_confirmations.sql` og `0015_complaints.sql`. Bygget på fase 2-branchen. Beslutningene venter på Nadeems godkjenning.
- AI-kontrollen (3. oktober): svaret fra modellen sjekkes mot malen (ukjente punkter forkastes, et obligatorisk punkt modellen utelot blir rødt), systemprompten sier at transkripsjonen bare er data, og en ny kjøring lager ikke ny kontroll eller nye notater for maler som allerede har det.
- Forbruk ved bitvis transkripsjon (3. oktober): hver bit lagres med nummer i `usage_events.piece` (migrasjonen `0026_usage_pieces.sql`), og fakturaen summerer bitene per samtale. Før ble en samtale fakturert som én bit på 15 sekunder. En bit telles bare én gang, og leasen er 5 minutter.
- Sikkerhet (3. oktober, fra gjennomgangen av API og database): invitasjonslenker kan ikke lenger overta eksisterende brukere i andre callsentre (migrasjonen `0025_invitation_claims.sql`, `docs/auth.md`), `acr` fra Idura må være BankID, og lesing av transkripsjonsbiter etter opptaket logges i `access_log`. De andre funnene står i PR-en og venter.
- Brukervennlighet (3. oktober): menyen i toppen er én rad med egen mobilmeny, fanene har tekst og kan rulles på mobil, feilsider har «Prøv igjen», Samtalestudio viser kildevalget før «Start opptak» og har Stopp nederst på mobil, og tall vises med vanlig sats (ikke `tabular-nums`).
- Brukervennlighet, del 2 (3. oktober): samtaledetaljen har to kolonner fra `lg` (opptak og transkripsjon til høyre) og koblingene under tittelen, salgsdetaljen viser saken før handlingene og skiller ut det som avslutter salget, Økonomi har faner før filtre og eget utseende på underfanene, roller viser rettighetene gruppert (`PERMISSION_GROUPS` i `packages/shared`), tomme lister sier hva neste steg er, tabeller som kan rulles har skygge i kanten (`.scroll-x`), og lasting viser et skjelett.
- Referanse per samtale (3. oktober, Nadeems ønske): hver samtale får en fast referanse som `VQ-7K3M-Q9TX` (migrasjonen `0034_call_references.sql`). Samtalestudio og samtalesiden har «Kopier», selgeren limer den inn i callsenterets eget salgssystem, og søket under Samtaler finner samtalen igjen ved klage eller kontroll. Salgsverifisering er en tilleggsmodul som faktureres ekstra (`docs/plan.md`, seksjon 14).
- Grenser for opplasting (3. oktober): størrelsen signeres inn i hver opplastings-URL (høyst 200 MB per del eller lydfil, 10 MB per transkripsjonsbit), og workeren behandler høyst 300 MB per samtale (`packages/shared/src/uploads.ts`).
- Kobling av BankID (3. oktober): navnet fra BankID må stemme med brukerens navn (`sameName` i `apps/api/src/auth/flow.ts`, `docs/auth.md`).
- Kapasitet (3. oktober): workeren har tak på 200 samtidige kjøringer, og API-et tåler 200 kall i sekundet (topper 500), se `infra/README.md` under Kapasitet.
- Overvåking og herding (3. oktober, fra infragjennomgangen): alarmer for Lambda, API, morgenkjøringen, faktureringen og databasen til SNS-emnet `veriqall-<miljø>-alerts` (e-post til `ALERT_EMAIL`), morgenkjøringen går uten e-post, databaseloggen får 365 dagers lagringstid og miljøets KMS-nøkkel, artefaktbøtta beholder pakkene stackene bruker (krever oppdatert bootstrap), og web og API sender sikkerhetsheadere (CSP `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS, `nosniff`, `Permissions-Policy`). Se `infra/README.md`, Overvåking.
- RLS-ytelse (3. oktober): policyene på `calls` og `sales` henter rettigheter og team én gang per spørring i stedet for per rad (migrasjonen `0027_visibility_performance.sql`). Med 100 000 samtaler gikk en selgers liste fra 25 sekunder til 17 ms, og en telling fra 10 minutter til under 40 ms. Ytelsestest i `packages/db/test/visibility-performance.test.ts`.
- Vern mot sterkere brukere (3. oktober): ingen kan endre, deaktivere eller invitere på nytt et medlem med rettigheter de ikke har selv, eller endre rettighetene til en rolle som har det (`holdsMoreThanMe` i `apps/api/src/admin/organizations.ts`).
- Revisjonslogg for samtaler (3. oktober): `calls` logges bare når status, koblinger, feil, varighet eller notatmaler endres, og tilleggsinformasjon og tittel bare som «endret», aldri teksten (migrasjonen `0028_call_audit.sql`). Rader som allerede var skrevet, ble redusert på samme måte.
- Tryggere deploy (3. oktober, fra infragjennomgangen): `deploy.sh` kjører migrasjonene med den nye migratoren før API-et og workeren får ny kode (`MigratorArtifactKey` i `infra/app.yml`), migratoren gir opp en tabellås etter 5 sekunder og prøver igjen opptil 5 ganger (`packages/db/src/migrate.ts`), og produksjon deployes ikke uten eget API-domene.
- Dashboard og bakgrunnsjobber (3. oktober): `app.dashboard` grupperer tallene per dag, time og selger i én omgang og har JIT slått av. Med 100 000 samtaler gikk «i dag» fra 8 s til 38 ms, 30 dager fra 6,9 s til 0,5 s og et år fra 68 s til 1,1 s, med identisk svar. Delindeks for uferdige samtaler, opprydding av innloggingsdata eldre enn en time, og varighet høyst ett døgn (migrasjonen `0029_dashboard_housekeeping.sql`).
- Innloggings-CSRF (3. oktober): innloggingen er bundet til nettleseren som startet den med informasjonskapselen `vq_login` (`docs/auth.md`).
- Dashboard per nivå, PR 1 (3. oktober, Nadeems ønske): `/oversikt` har fanene Meg (egne tall mot forrige periode og snittet i teamet uten navn, minst tre aktive), Teamet (selgerne sammenlignet, trenger oppfølging, aktivitet per dag) og Callsenteret. Migrasjonen `0030_role_dashboards.sql` (`docs/plan.md`, seksjon 15). Kvalitet, Administrasjon → Oversikt og Superadmin → Oversikt kommer i egne PR-er.
- Dashboard per nivå, admin (3. oktober): Administrasjon har fått Oversikt som første fane. Den viser brukere og innloggingsmåter, team og roller, aktivitet per team, forbruk, fakturaer og moduler. Brukere er flyttet til `/administrasjon/brukere`. Migrasjonen `0031_org_summary.sql`.
- Fase 1, PR F1 (grunndata): kunder (privat og bedrift, ingen fødselsnumre) og produkter med versjonerte produktmaler, migrasjonen `0011_customers_products.sql`, API under `/org/customers` og `/org/products`, og sidene `/kunder` og `/produkter` (`docs/plan.md`, seksjon 12).

**Neste steg:** Test fase 2 i staging (Soniox-nøkkel fra EU-prosjekt, Claude slått på i Bedrock, moduler på for callsenteret). Test fase 3 i staging (lenke til kunden, aksept med BankID og Vipps, klage med dokumentasjon). Test fase 4A og 4B i staging (dashboard, coaching og fakturering). Alle fasene i planen er bygget. Det som gjenstår, er Nadeems gjennomgang av beslutningene i seksjon 13–16, juridiske avklaringer, SMS-leverandør, e-post (SES), Stripe og produksjon.

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
- **Databaseendringer** skjer bare som migrasjonsfiler som kjøres av CI. Aldri manuelle endringer i produksjon. Migrasjonene kjøres før API-et og workeren får ny kode, så en migrasjon må også virke med koden før den: legg til først, fjern i en senere deploy.
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
| Lyd | Opptak i nettleseren (mikrofon og fanelyd), opplastet i biter til S3 per miljø, SSE-KMS, kun TLS, slettes etter 3–12 måneder |
| Transkripsjon | Soniox API |
| AI | Claude via AWS Bedrock i `eu-north-1` |
| Innlogging | Vipps Logg inn og BankID via Idura, begge OIDC, og passkeys (WebAuthn) |
| IaC | CloudFormation (YAML) i `infra/`, deployet av `infra/deploy.sh` |
| CI/CD | GitHub Actions med OIDC mot AWS, aldri lagrede AWS-nøkler |
| Miljøer | `staging` og `production`, helt adskilt med egne nøkler |
