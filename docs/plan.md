# VeriQall – plan og beslutninger

Overlevering fra planleggingen i Claude-chat, 2. oktober 2026, oppdatert samme dag med beslutningene om database, nettverk og kostnader (seksjon 3 og 9) og innloggingsdesignet i [`auth.md`](auth.md). Dette er den levende planen: oppdater den når noe blir besluttet, og flytt punkter ut av «Åpne beslutninger» når de er avklart.

## 1. Moduler

Produktstrukturen slik Nadeem har definert den:

1. **Logo og design:** lys og mørk versjon av både siden og logoen, SVG-filer, optimalisert for mobil, nettbrett/iPad og desktop.
2. **Kunder, selgere, produkter, salg og status**, med komplett kundehistorikk.
3. **Brukere og roller:** selgere, ledere, admin for callsenteret og compliance/klagebehandlere med ulike tilganger, pluss superadmin (oss). Nye roller kan opprettes rett fra appen, og rettigheter tildeles per rolle.
4. **Produktmaler:** pris, vilkår, godkjente formuleringer og regler for hvert produkt. Kan legges til i appen.
5. **Transkribering:** automatisk tale til tekst med Soniox, søk, tidsstempler og kobling mellom lyd og tekst.
6. **Rapportgenerering** etter hver samtale med Claude-modeller via AWS Bedrock i `eu-north-1`. Rapportmaler kan lages i appen.
7. **AI-kontroll:** samtalen sammenlignes med malen og flagges grønn, gul eller rød. Gule og røde flagges også for admin i callsenteret.
8. **Salgsverifisering:** kunden mottar digital bekreftelse og aksepterer via SMS, Vipps eller tilsvarende.
9. **Dokumentasjon:** automatisk salgssammendrag som viser hva som faktisk ble sagt, tilbudt og akseptert.
10. **Klagehåndtering:** samler opptak, transkripsjon, tilbud, aksept og avvik til ferdig klagedokumentasjon.
11. **Dashboard og coaching:** salg, konvertering, kvalitet, avvik, klager og konkrete tilbakemeldinger til selger.
12. **Superadmin-portal:** opprette callsentre og gi tilgang til admin og brukere.
13. **Adminportal** for admin i callsenteret.
14. **Innlogging** med Vipps Logg inn og BankID.
15. **Fakturamodul.**

## 2. Byggerekkefølge

Hver fase bygger på den forrige.

| Fase | Innhold | Moduler |
|---|---|---|
| 0 Fundament | designsystem, datamodell med callsentre, roller og rettigheter, innlogging, revisjonslogg, CI/CD | 1, 3, 14 |
| 1 Portaler og grunndata | superadmin-portal, adminportal, kunder/selgere/produkter/salg, produktmaler | 12, 13, 2, 4 |
| 2 Samtalen | transkribering, AI-kontroll, rapporter | 5, 7, 6 |
| 3 Etter salget | salgsverifisering, dokumentasjon, klagehåndtering | 8, 9, 10 |
| 4 Innsikt og økonomi | dashboard og coaching, fakturamodul | 11, 15 |

### Fase 0 som fire PR-er mot `staging`

1. **Skjelett og design:** mappestruktur, Next.js med designtokens (seksjon 6) i lys og mørk modus, responsivt for mobil, nettbrett og desktop, og logo og favicon fra `public/brand/`. CI kjører lint, typecheck og tester på hver PR, men deployer ikke ennå.
2. **Datamodell og tilgang:** migrasjoner for fase 0-tabellene (seksjon 4), RLS-policyer, rettighetskatalogen og seed av standardroller per callsenter.
3. **Innlogging:** OIDC mot Vipps og Idura (BankID) med PKCE og engangs-state, kobling til bruker via `sub`, egen kortlevd sesjon i en httpOnly-cookie, og innloggingslogg.
4. **Infrastruktur og deploy:** IaC for staging (KMS, RDS, S3, Secrets Manager, API Gateway og Lambda, Amplify), og deploy-workflows for `staging` og `main`.

## 3. Arkitektur

- **Sky og region:** AWS, `eu-north-1` (Stockholm). Staging og produksjon er helt adskilt, hver med egne nøkler og secrets.
- **Frontend:** Next.js på AWS Amplify Hosting. `staging`-branchen går til staging-appen og `main` til produksjonsappen, med egne miljøvariabler per app.
- **API:** serverløst med API Gateway og Lambda.
- **Samtalepipeline:** lydfil til S3 → Lambda sender til Soniox → transkripsjon og segmenter lagres i Postgres → AI-kontroll med Bedrock mot malversjonen → flagg, rapport og varsler.
- **Database:** PostgreSQL på RDS, én instans per miljø (`db.t4g.micro` til å begynne med), samme motor og versjon i staging og produksjon. Automatiske backuper med point-in-time recovery er på i begge (inkludert i prisen så lenge backupene ikke er større enn databasen). Produksjon får Multi-AZ ved lansering.
- **Nettverk:** Lambdaene ligger i VPC-en sammen med databasen. Veien ut til internett (Soniox, Vipps, Idura) går via en NAT-instans (`t4g.nano`, fck-nat i en Auto Scaling-gruppe med én maskin og CloudWatch-alarm) i staging, og via NAT Gateway i produksjon. Innloggingen er én Lambda. Bytte mellom NAT-instans og NAT Gateway er bare en endring i rutetabellen.
- **Migrasjoner** kjøres av en migrator-Lambda i VPC-en, som CI starter med OIDC-rollen. GitHub-runnere når ikke databasen direkte.
- **Databaseroller:** migrasjonene eier skjemaet. API-et bruker rollen `app_user`, som er underlagt RLS. Innloggingen bruker den smale rollen `app_auth`, som bare når innloggingstabellene (se seksjon 4).
- **Domener:** `veriqall.no` ligger hos one.com, og DNS blir der. Staging bruker `staging.veriqall.no` (app) og `api.staging.veriqall.no` (API); produksjon for eksempel `app.veriqall.no` og `api.veriqall.no`. Sertifikater fra ACM, validert med CNAME-poster hos one.com.
- **Transkripsjon:** Soniox via API (rundt 0,10 USD per time lyd).
- **AI:** Claude via AWS Bedrock. Senere kanskje Gemini via Google Vertex AI, med egen GCP-tjenestekonto og nøkkel i Secrets Manager.
- **Innlogging:** Vipps Logg inn (via Vipps bedrift) og BankID via Idura, begge OIDC. Brukeren identifiseres med `sub`. Etter innlogging utsteder appen sin egen kortlevde sesjon.
- **Kryptering i hvile:** egen kundeadministrert KMS-nøkkel per miljø for RDS (må velges når instansen opprettes), S3, CloudWatch Logs og Secrets Manager.
- **Kryptering i transitt:** TLS overalt, `rds.force_ssl=1`, og en S3-bøttepolicy som nekter trafikk uten TLS (`aws:SecureTransport`) og ukrypterte opplastinger.
- **Revisjonslogg i tre lag:** CloudTrail til en egen kryptert bøtte med log file validation, pgAudit i Postgres, og `audit_log` og `access_log` i appen.
- **Secrets per miljø:** samlet i én hemmelighet per miljø (JSON) i Secrets Manager: `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN`, `IDURA_CLIENT_ID`, `IDURA_CLIENT_SECRET`, `SONIOX_API_KEY`.
- **Kostnader:** se seksjon 9.

### Foreslått mappestruktur

```
apps/web          Next.js (Amplify)
apps/api          Lambda-handlere bak API Gateway
packages/db       SQL-migrasjoner (RLS og policyer skrives i SQL)
packages/shared   rettighetskatalog og felles typer
infra/            IaC
public/brand/     logo og ikoner
tools/brand/      logogenerator
docs/             plan og beslutninger
```

## 4. Datamodell

### Prinsipper

- **Leietakere:** alle callsenter-tabeller har `organization_id`. Postgres Row Level Security er andre barriere etter API-et.
- **Superadmin** ligger på plattformnivå (`platform_admins`), utenfor callsentrene. Handlinger på tvers av callsentre logges eksplisitt.
- **Roller er data, rettigheter er kode.** Se katalogen under.
- **Produktmaler versjoneres.** Rader i `product_template_versions` er uforanderlige når de er tatt i bruk. `calls` og `sales` peker på `template_version_id`.
- **Transkripsjoner** lagres som hel tekst pluss segmenter (`speaker`, `start_ms`, `end_ms`, `text`) for kobling mellom lyd og tekst, og søkes med Postgres fulltekstsøk (norsk konfigurasjon). De krypteres i hvile via KMS, men ikke på applikasjonsnivå, ellers mister vi søk.
- **AI-funn** lagres per regel i malen med status, sitat og tidsstempel, slik at hvert flagg kan spores til stedet i samtalen.
- **Bevis for aksept (modul 8):** dokument-hash, dokumentversjon, metode, tidspunkt, IP og user agent.
- **Bruk** (lydminutter, AI-tokens og kostnad) logges per callsenter og er grunnlaget for fakturering.

### Tabeller i fase 0

- **Callsentre og tilgang:** `organizations`, `organization_modules` (moduler av og på per callsenter), `users` (navn, mobil, e-post, status), `platform_admins`, `teams`, `roles`, `role_permissions`, `permissions` (rettighetskatalogen speilet fra koden), `memberships` (bruker, callsenter, rolle og team, én rolle per callsenter).
- **Innlogging** (se [`auth.md`](auth.md)): `invitations` (engangstoken som hash, utløp etter 72 timer), `auth_states` (OIDC-state som hash, nonce, PKCE-verifier, provider, invitasjon, retur-sti og brukt-tidspunkt), `identities` (bruker, provider, `sub`, valgfri HMAC av fødselsnummer), `sessions` (hash av økt-ID, bruker, provider, `acr`, tidspunkter, IP og user agent), `login_events`.
- **Sporing:** `audit_log` (append-only, skrives av triggere), `access_log` (append-only, skrives av API-et).

Rollene `app_user` og `app_auth` er beskrevet i seksjon 3. Callsenter-tabellene har RLS med `FORCE ROW LEVEL SECURITY`, og `app.current_org_id()` gir bare et callsenter når brukeren er aktivt medlem (eller superadmin). Rettigheter som gis til en rolle eller via et medlemskap, sjekkes også i databasen mot det den som gjør endringen selv har.

### Senere faser

- **Fase 1:** `customers`, `products`, `product_templates`, `product_template_versions`, `sales`
- **Fase 2:** `calls`, `transcripts`, `transcript_segments`, `call_analyses`, `report_templates`, `reports`, `usage_events`
- **Fase 3:** `sale_confirmations`, `complaints`, `complaint_documents`
- **Fase 4:** `coaching_notes` og fakturatabeller (kunder, fakturaer, linjer, betalinger, gjentakelser og innstillinger)

### Rettighetskatalog (utgangspunkt, kan justeres)

Standardrollene seedes per callsenter. Admin kan lage nye roller og velge rettigheter blant dem admin selv har. Salg følger samme synlighet som samtaler.

| Rettighet | Gir tilgang til | Selger | Leder | Compliance | Admin |
|---|---|:-:|:-:|:-:|:-:|
| `calls.read.own` | egne samtaler | ✓ | ✓ |  | ✓ |
| `calls.read.team` | teamets samtaler |  | ✓ |  | ✓ |
| `calls.read.all` | alle samtaler i callsenteret |  |  | ✓ | ✓ |
| `calls.audio.play` | avspilling av opptak | ✓ | ✓ | ✓ | ✓ |
| `calls.upload` | laste opp opptak | ✓ | ✓ |  | ✓ |
| `customers.read` | se kunder og historikk | ✓ | ✓ | ✓ | ✓ |
| `customers.manage` | opprette og endre kunder | ✓ | ✓ |  | ✓ |
| `sales.manage` | registrere og endre salg | ✓ | ✓ |  | ✓ |
| `flags.review` | behandle gule og røde flagg |  | ✓ | ✓ | ✓ |
| `complaints.manage` | klagesaker |  |  | ✓ | ✓ |
| `coaching.give` | tilbakemeldinger til selgere |  | ✓ |  | ✓ |
| `dashboard.team` | dashboard for teamet |  | ✓ |  | ✓ |
| `dashboard.all` | dashboard for hele callsenteret |  |  | ✓ | ✓ |
| `products.manage` | produkter og produktmaler |  |  |  | ✓ |
| `report_templates.manage` | rapportmaler |  |  |  | ✓ |
| `users.manage` | brukere og team |  |  |  | ✓ |
| `roles.manage` | roller og rettigheter |  |  |  | ✓ |
| `audit.read` | revisjons- og tilgangslogg |  |  | ✓ | ✓ |
| `billing.read` | fakturaer |  |  |  | ✓ |

## 5. Mønstre hentet fra MedSide

MedSide (Nadeems andre plattform) har allerede løst mye av det samme. Vi tar med oss mønstrene, ikke koden:

- Leietakere med medlemskap, og et «aktivt callsenter» for brukere som hører til flere.
- OIDC-state med nonce og PKCE som bare kan brukes én gang.
- eID-identiteter med `sub` og hashet fødselsnummer.
- Bevis for samtykke og signering med dokument-hash, versjon og tidspunkt. Det blir kundens aksept i modul 8.
- Revisjonslogg for API-kall, tilgangslogg per dokument og trigger-basert logg over rolleendringer.
- Maler på tre nivåer (global fra superadmin, per callsenter og personlig) med myk sletting til arkiv. Det blir rapportmalene i modul 6.
- Bruks- og kostnadslogg per tjeneste og modell.
- Fakturamodul med fakturanummer, KID, forfall, kreditnota, delbetalinger og gjentakende fakturaer. Det blir modul 15, med callsentrene som fakturakunder.
- Moduler som slås av og på per leietaker.

To ting gjør vi bevisst annerledes:

- **Roller:** MedSide har én felles rolleliste for hele plattformen, der verdier ikke kan slettes. Her er roller rader per callsenter.
- **Kryptering:** MedSide krypterer enkelte fritekster i selve appen. Transkripsjoner må være søkbare, så de krypteres i hvile via KMS i stedet.

## 6. Design

Logoen er en Q der halen er en hake: samtale og verifisert i ett tegn. Ordmerket er satt i Schibsted Grotesk (fri lisens, OFL) i vekt 800, med en egentegnet Q. Se `docs/brand-preview.png`.

Filer i `public/brand/`:

- `veriqall-logo-light.svg` og `veriqall-logo-dark.svg`: ordmerket for lys og mørk bakgrunn
- `veriqall-symbol-light.svg` og `veriqall-symbol-dark.svg`: bare Q-en
- `veriqall-app-icon.svg`: hvit Q på merkefarge, avrundet
- `favicon.svg`: bytter farge med lys og mørk modus
- `apple-touch-icon.png` (180 px) og `icon-512.png`: ikoner for hjemskjerm

| Navn | Hex | Bruk |
|---|---|---|
| Stempel | `#3326C9` | merkefarge i lys modus |
| Stempel lys | `#A39BFF` | merkefarge i mørk modus |
| Skrift | `#15172E` | tekst i lys modus |
| Papir | `#FAFAFC` | bakgrunn i lys modus |
| Natt | `#10122A` | bakgrunn i mørk modus |
| Tåke | `#ECECF6` | tekst i mørk modus |
| Godkjent | `#1E9E5A` | bare grønt AI-flagg |
| Avvik | `#E0A100` | bare gult AI-flagg |
| Brudd | `#D7382F` | bare rødt AI-flagg |

- Schibsted Grotesk brukes i hele appen.
- Lys og mørk modus fra start, via CSS-variabler. Følg systemets innstilling, med mulighet for å velge selv.
- Responsivt for mobil, nettbrett/iPad og desktop.
- Grønn, gul og rød brukes bare til status og AI-flagg, aldri som pynt.

Logoen kan genereres på nytt med `tools/brand/`: last ned fonten til `tools/brand/SG.ttf` fra `https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf`, installer `fonttools uharfbuzz cairosvg skia-pathops`, og kjør `python3 final.py` i den mappen. Hakens form styres av varianten «A tail-hake» i `tune.py`.

## 7. CI/CD og miljøer

- **Branches:** `main` er produksjon og `staging` er test. Arbeid skjer i egne branches med PR mot `staging`. Når staging er testet, lages en PR fra `staging` til `main`.
- **Beskyttelse:** ruleset på `main` krever PR. Environment `production` krever manuell godkjenning av Nadeem før deploy.
- **AWS-tilgang:** GitHub Actions bruker OIDC, aldri lagrede AWS-nøkler. Rollens ARN legges som secret i hvert Environment.
- **Workflows:** `ci.yml` (lint, typecheck og tester på hver PR), `deploy-staging.yml` (ved push til `staging`) og `deploy-production.yml` (ved push til `main`, krever godkjenning). Amplify bygger frontend selv per branch.
- **Migrasjoner** kjøres av CI mot riktig miljø, aldri manuelt.

## 8. Åpne beslutninger og ting å verifisere

- **Hvordan kommer lydopptakene inn?** Opplasting etter samtalen, eller integrasjon med callsenterets telefonisystem? Dette avgjør fase 2.
- **IaC-verktøy:** Terraform eller AWS CDK.
- **Kontooppsett:** egne AWS-kontoer for staging og produksjon (anbefalt) eller én konto med tagger. I dag ligger begge i samme konto.
- **Innlogging:** skal rettigheter med høy risiko (`audit.read`, `users.manage`, `roles.manage`, `calls.read.all`) kreve en økt startet med BankID? Og tidsavbrudd for økter. Se [`auth.md`](auth.md).
- **SMS-leverandør** for salgsverifisering (modul 8).
- **Bedrock:** hvilke Claude-modeller er tilgjengelige direkte i `eu-north-1`, og krever noen EU cross-region inference (behandling i andre EU-regioner)?
- **Lovkrav:** sjekk hva angrerettloven krever av bekreftelse og skriftlig aksept ved telefonsalg. Modul 8 bør bygges rundt det.
- **Lagringstid** for opptak og transkripsjoner, og sletting på forespørsel.
- **Fakturamodul:** antatt at det er callsentrene som faktureres for bruk av VeriQall. Bekreft.
- **Logo:** venter på Nadeems godkjenning.
- **Repo:** døpe om til `veriqall`, og gjøre det privat før ekte nøkler eller kundedata.

## 9. Beslutninger og kostnader

Besluttet 2. oktober 2026:

- **AWS med RDS, ikke Supabase.** Point-in-time recovery er et krav i produksjon, siden data skal brukes som bevis i klagesaker. På RDS er det inkludert; på Supabase koster det rundt 100 USD i måneden per prosjekt. AWS gir i tillegg egen KMS-nøkkel, privat database og logger i egen konto.
- **Nettverk:** NAT-instans i staging, NAT Gateway i produksjon (seksjon 3). Ikke delte Lambdaer, ikke Aurora.
- **Produksjon opprettes først ved lansering.** Fram til da betales bare staging.
- **Domene:** `veriqall.no` hos one.com, DNS blir der.

Kostnader i tomgang (USD per måned, `eu-north-1`). Priser merket * er slått opp i AWS sin prisliste; resten er anslag.

| Post | Staging | Produksjon (fra lansering) |
|---|---|---|
| RDS `db.t4g.micro` | 11,70* | 23,40* (Multi-AZ) |
| Lagring 20 GB, backup og PITR inkludert | ca. 2,40 | ca. 4,80 |
| Vei ut til internett | NAT-instans 3,10* + disk og IP ca. 4,40 | NAT Gateway 33,60* + IP ca. 3,70 |
| KMS, Secrets Manager, logger, alarmer, CloudTrail | ca. 3–4 | ca. 4–7 |
| Amplify, API Gateway, Lambda, S3 | ca. 0–2 | ca. 2–8 |
| **Sum** | **ca. 25–28 (260–300 kr)** | **ca. 72–82 (750–860 kr)** |

Etter bruk kommer i tillegg: Soniox (0,10 USD per time lyd), Bedrock (avhenger av modell, anslag 50–100 USD ved 100 samtaler om dagen), NAT-trafikk (0,046 USD* per GB), lydlagring i S3, og per innlogging hos Idura og Vipps samt SMS etter avtale. Utenfor AWS: domenet og GitHub Pro når repoet gjøres privat.
