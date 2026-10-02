# VeriQall

VeriQall er en plattform for callsentre som selger på telefon. Samtalene tas opp og transkriberes, AI sjekker dem mot produktmalen, kunden bekrefter kjøpet digitalt, og alt samles som dokumentasjon for oppfølging, klager og coaching. Mange callsentre deler plattformen, men ser bare sine egne data. Vi (MedInnova, ved Nadeem) er superadmin.

Nadeem skriver norsk, så svar på norsk. Hele planen – moduler, faser, arkitektur, datamodell, design og åpne beslutninger – står i [`docs/plan.md`](docs/plan.md). Les den før du starter på en ny fase, og oppdater den når noe blir besluttet.

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
- Hele planen i `docs/plan.md`.
- Fase 0, PR 1 (skjelett og design): monorepo med npm workspaces, Next.js 16 i `apps/web` med Tailwind 4, designtokens i lys og mørk modus (system, lys, mørk, huskes i nettleseren), Schibsted Grotesk via `@fontsource-variable` (selvhostet), `/design` med paletten og AI-flagg, og `ci.yml` (lint, typecheck, test og build på hver PR, ingen deploy). Tokens og kontrast er dekket av tester. De godkjente brandfilene, `docs/brand-preview.png` og `tools/brand/` er lagt inn (logoen er ikke formelt godkjent ennå).

Ikke gjort:
- Ingen migrasjoner, API-kode, innlogging eller AWS-ressurser (RDS, S3, Amplify, KMS).
- Environment `production` er ikke verifisert (Claude har ikke tilgang til Environments-APIet). Sjekk at det finnes og krever godkjenning av Nadeem.

**Neste steg:** fase 0, PR 2 (datamodell og tilgang), se `docs/plan.md`, seksjon 2 og 4.

## Kommandoer

Node 22 (se `.nvmrc`). Kjør fra reporoten:

- `npm ci`: installer
- `npm run dev`: utviklingsserver for `apps/web`
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: det samme som `ci.yml` kjører

`public/brand/` i reporoten er kilden til logoer og ikoner; `apps/web` kopierer den til `apps/web/public/brand/` (gitignorert) ved `dev` og `build`.

## Regler for hver endring

- **Callsentre er leietakere.** Alle callsenter-data har `organization_id` og en RLS-policy. API-et kobler til med en databaserolle som er underlagt RLS, og setter `app.current_org_id` og `app.current_user_id` med `SET LOCAL` i hver transaksjon.
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
| Database | PostgreSQL på RDS, KMS-kryptert, `rds.force_ssl=1`, pgAudit |
| Lyd | S3 per miljø, SSE-KMS, kun TLS |
| Transkripsjon | Soniox API |
| AI | Claude via AWS Bedrock i `eu-north-1` |
| Innlogging | Vipps Logg inn og BankID via Idura, begge OIDC |
| CI/CD | GitHub Actions med OIDC mot AWS, aldri lagrede AWS-nøkler |
| Miljøer | `staging` og `production`, helt adskilt med egne nøkler |
