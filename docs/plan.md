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
- **Revisjonslogg i tre lag:** CloudTrail til en egen kryptert bøtte med log file validation (`infra/cloudtrail.yml`, satt opp 3. oktober 2026, låst i 365 dager), pgAudit i Postgres, og `audit_log` og `access_log` i appen.
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
- **Kontooppsett:** egne AWS-kontoer for staging og produksjon (anbefalt) eller én konto med tagger. I dag ligger begge i samme konto.
- **SMS til kunden** (besluttet 3. oktober): hører til tilleggsmodulen Salgsverifisering og venter. Leverandør velges når modulen tas i bruk.
- **Bedrock:** hvilke Claude-modeller er tilgjengelige direkte i `eu-north-1`, og krever noen EU cross-region inference (behandling i andre EU-regioner)?
- **Lovkrav:** sjekk hva angrerettloven krever av bekreftelse og skriftlig aksept ved telefonsalg. Modul 8 er bygget som skriftlig aksept med BankID eller Vipps (seksjon 14), men trenger en juridisk vurdering.
- **Samtykke til opptak og informasjon til kunden** (besluttet 3. oktober): er selgerens og callsenterets ansvar, og de kan gjøre det i sitt eget system. Det kan bli en egen tilleggsmodul i VeriQall som videreutvikles senere.
- **Databehandleravtaler** med callsentrene: tas senere, før lansering.
- **Lagringstid** (besluttet 3. oktober): velges av superadmin per callsenter (3, 6, 9 eller 12 måneder, seksjon 13), slik det allerede er bygget. Sletting på forespørsel gjenstår.
- **Fakturamodul:** besluttet 2. oktober at callsentrene betaler med både faktura og Stripe (se seksjon 10). Stripe venter (besluttet 3. oktober).
- **E-post for invitasjoner:** Amazon SES med `veriqall.no` (DNS-poster hos one.com). Til da kopierer superadmin lenken selv.
- **Logo:** venter på Nadeems godkjenning.
- **Repo:** døpe om til `veriqall`, og gjøre det privat før ekte nøkler eller kundedata.

## 9. Beslutninger og kostnader

Besluttet 2. oktober 2026:

- **AWS med RDS, ikke Supabase.** Point-in-time recovery er et krav i produksjon, siden data skal brukes som bevis i klagesaker. På RDS er det inkludert; på Supabase koster det rundt 100 USD i måneden per prosjekt. AWS gir i tillegg egen KMS-nøkkel, privat database og logger i egen konto.
- **Nettverk:** NAT-instans i staging, NAT Gateway i produksjon (seksjon 3). Ikke delte Lambdaer, ikke Aurora. NAT-instansen i staging følger nyeste Amazon Linux og byttes ved deploy når det kommer en ny versjon, med noen minutter uten nett ut (besluttet 3. oktober: beholdes slik).
- **Produksjon opprettes først ved lansering.** Fram til da betales bare staging.
- **Domene:** `veriqall.no` hos one.com, DNS blir der.
- **IaC:** CloudFormation i YAML (`infra/`), én stack per lag og miljø. Se `infra/README.md`.
- **Innlogging:** administrativ tilgang (revisjonslogg, brukere og ansatte, roller, alle samtaler, fakturaer) krever en økt startet med BankID. Økter utløper etter 60 minutter uten aktivitet og maks 14 timer. Se [`auth.md`](auth.md).

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

## 10. Superadmin-portalen

Besluttet 2. oktober 2026, etter mønster fra adminportalen i MedSide. Forskjellen er at kundene er callsentre, ikke enkeltbrukere. Portalen ligger på `/admin` i web-appen og bruker `/admin/*` i API-et. Bare superadmins i en økt startet med BankID kommer inn, og alt kjører som `app_user` under RLS: arbeid i ett callsenter setter det som gjeldende callsenter, så de samme policyene, vernene og revisjonsloggen gjelder som for callsenterets egen admin (`audit_log.as_platform_admin` markerer superadmin).

**Beslutninger:**
- **Betaling:** både faktura (egen fakturamodul som i MedSide) og Stripe. Kommer i fase 4.
- **Superadmin kan gjøre andre til superadmin fra portalen,** i en BankID-økt, og det logges. Man kan ikke fjerne sin egen tilgang, og det må alltid finnes minst én superadmin.
- **Invitasjoner:** portalen viser lenken som superadmin sender selv. E-post via Amazon SES kommer i egen PR.
- **Ingen pakker:** moduler slås av og på per callsenter. Et callsenter er aktivt, i prøveperiode (aktivt med sluttdato) eller suspendert. Etter prøveperioden og ved suspensjon stenges callsenteret for brukerne, men ikke for superadmin.

**Faner:**

| Fane | Innhold | Når |
|---|---|---|
| Oversikt | Startsiden i portalen (3. oktober, Nadeems ønske om et dashboard per nivå). Øverst «Trenger oppmerksomhet»: samtaler som har hengt seg opp i behandling, lydbiter som har ventet over fem minutter, feilede samtaler, IP-adresser med mange mislykkede innlogginger som ikke er sperret, uteblitt betaling eller forfalte beløp, uleste meldinger og fakturautkast. Deretter:<br>• samtaler og vellykkede innlogginger per dag de siste 30 dagene<br>• drift: opptak som pågår, under behandling, lydbiter i kø, feilet siste 7 dager, og månedens samtaler, timer, AI-kontroller og notater (talt som på fakturaen)<br>• innlogging: i dag, siste 7 dager, mislykkede siste døgn, sperrede adresser og innloggingsmåte siste 30 dager<br>• de mest aktive callsentrene denne måneden, prøveperioder som går ut innen 14 dager og tilgang fra faktura innen 7, og åpne callsentre med transkribering som ikke har tatt opp samtaler på 14 dager<br>• økonomi: MRR og ARR, månedens inntekter, kostnader og resultat som under Regnskap, utestående og forfalt<br>• brukere, callsentre og meldinger<br>Bare antall, aldri innhold, fra `app.platform_overview()` (`0032_platform_overview.sql`, `GET /admin/overview`) | 3. oktober |
| Callsentre | Liste med søk og status, nytt callsenter (navn, org.nr., kontaktperson, faktura-e-post og -adresse, notat, prøveperiode), moduler per callsenter, brukerne i callsenteret, invitere med rolle (admin som standard), invitasjoner som kan trekkes tilbake | Fase 1, PR A (ferdig) |
| Brukere | Søk på tvers av callsentre, detaljer med medlemskap og koblede innlogginger (BankID og Vipps), deaktivere, fjerne en innloggingsmetode, aktive økter og tvangsutlogging, gi og fjerne superadmin, CSV-eksport | Fase 1, PR B (laget) |
| Sikkerhet | Mislykkede innlogginger per IP og bruker, revisjonslogg og tilgangslogg med filter og CSV, IP-sperring (gjelder hele API-et unntatt `/health`, trer i kraft innen ett minutt). PDF-rapport kommer senere | Fase 1, PR C (laget) |
| Meldinger | Kunngjøringer til alle eller valgte callsentre (tittel, tekst, lenke, periode, av og på), vist som banner for innloggede brukere. Samtaletråder med admin i callsentrene kommer med adminportalen, siden admin trenger et sted å svare | Fase 1, PR D (laget) |
| Vekst | Nøkkeltall, brukere totalt, nye callsentre og innlogginger per måned, med markedsføringshendelser som markører. Samtaler per dag står under Oversikt | Fase 1, PR D (laget) |
| Roller og moduler | Modulkatalogen, standardrollene nye callsentre får, og rettighetskatalogen (lesbar) | Fase 1, PR B (laget) |
| System | Innloggingsmetoder av og på, AI-modell og prompt per funksjon, Soniox-ordliste, kvoter for Bedrock og Soniox | Fase 2 |
| Økonomi | Forbruk per callsenter (lydminutter, AI-tokens), fakturaer, faste avtaler, innstillinger og nøkkeltall (MRR, fakturert, utestående). Stripe og kostnader/netto kommer senere | Forbruk i fase 2, fakturering i fase 4B (seksjon 16) |

Fra MedSide tas ikke med: passord og 2FA (vi har bare BankID og Vipps), legespesialiteter og PreVisit-nivåer, og globale roller (roller er per callsenter her).

## 11. Adminportalen for callsentrene

Påbegynt 2. oktober 2026. Admin i et callsenter administrerer sitt eget callsenter på `/administrasjon` i web-appen, med API-et under `/org/*`. Det krever rettigheten `users.manage` i callsenteret, og dermed en økt startet med BankID eller passkey. Alt kjører under RLS i økten sitt callsenter, så databasen avgjør hva som er synlig og nekter å gi bort rettigheter man ikke har.

| Fane | Innhold | Når |
|---|---|---|
| Oversikt | Startsiden i portalen (3. oktober, Nadeems ønske om et dashboard per nivå):<br>• brukere: aktive, venter på første innlogging, utløpte invitasjoner, ikke innlogget på 30 dager<br>• innloggingsmåter: BankID, Vipps og passkey<br>• team og roller med antall medlemmer<br>• aktivitet per team denne måneden (krever `dashboard.all`)<br>• forbruk denne og forrige måned, talt som på fakturaen<br>• fakturaer: ubetalt, forfalt, neste forfall (krever `billing.read`)<br>• moduler<br>Bare antall, fra `app.org_summary` (`0031_org_summary.sql`, `GET /org/summary`). | 3. oktober |
| Brukere | Flyttet til `/administrasjon/brukere`. Invitere med rolle og team (også personer som er brukere i et annet callsenter), endre rolle og team, deaktivere og aktivere, invitasjoner, CSV. Man kan ikke endre sitt eget medlemskap. Navnet kan bare endres før første innlogging (deretter kommer det fra BankID eller Vipps) | PR E1 (laget) |
| Team | Opprette, endre navn, arkivere (medlemmene blir uten team) og gjenopprette | PR E1 (laget) |
| Roller | Lage roller og endre navn og rettigheter (bare blant dem man har selv), arkivere og gjenopprette. Man kan ikke endre rollen man har selv, eller arkivere en rolle med brukere. Krever `roles.manage` | PR E2 (laget) |
| Meldinger | Samtaletråder mellom admin og superadmin, med ulest-markering på begge sider, lukke og åpne. Superadmin ser dem under Meldinger → Samtaler og kan starte en samtale med et callsenter | PR E2 (laget) |

Brukere som er med i flere callsentre, bytter aktivt callsenter i toppen (`POST /me/organization`). Superadmin kan gå inn i et hvilket som helst callsenter fra fanen Callsentre («Åpne adminportalen for callsenteret»).

## 12. Grunndata: kunder, produkter og salg

Påbegynt 2. oktober 2026 (modul 2 og 4). Sidene ligger på `/kunder` og `/produkter` i web-appen for alle aktive medlemmer i callsenteret, med API-et under `/org/customers` og `/org/products`. Alt kjører under RLS i øktens callsenter, og alle endringer skrives til `audit_log`.

Beslutninger 2. oktober:

- Kunder er både privatpersoner og bedrifter. Privatpersoner har navn og fødselsdato, bedrifter organisasjonsnummer og kontaktperson. **Ingen fødselsnumre**: identiteten bekreftes med BankID eller Vipps når kunden godtar (modul 8).
- En produktmal har pris (engangs og/eller per måned), bindingstid, oppsigelsestid, angrefrist, vilkår, obligatoriske punkter (som AI-kontrollen sjekker hvert for seg) og godkjente og forbudte formuleringer.
- Salg følger standardløpet `registrert → venter på bekreftelse → bekreftet → aktiv`, med sidesporene avvist, angret og kansellert. Klager kommer i fase 3. Til salgsverifiseringen (modul 8) er på plass, settes «bekreftet» for hånd, og det står i historikken hvem som gjorde det.

| Del | Innhold | Når |
|---|---|---|
| Kunder | Søk (navn, telefon, e-post, org.nr.), opprette, endre, arkivere og gjenopprette. Lese krever `customers.read`, endre krever i tillegg `customers.manage`. Org.nr. er unikt blant aktive kunder | PR F1 (laget) |
| Produkter og maler | Alle medlemmer ser produktene og gjeldende versjon (selgere ser ikke utkast). `products.manage` lager produkter og utkast, publiserer og arkiverer. Et nytt utkast kopierer siste versjon. Publisering krever pris, vilkår og minst ett obligatorisk punkt, og erstatter forrige versjon. Databasen nekter endring og sletting av publiserte og erstattede versjoner. Obligatoriske punkter beholder id-en sin mellom versjoner | PR F1 (laget) |
| Salg | `/salg` med filter (status, mine, søk), nytt salg (også fra kundesiden), og salgssiden med statusknapper, begrunnelse og historikk. Databasen setter produktets publiserte malversjon, kopierer pris, bindingstid og angrefrist til salget og selgerens team på salgstidspunktet. Etter registrering kan bare status og notat endres, og status bare langs lovlige overganger (`SALE_TRANSITIONS` i `packages/shared/src/sales.ts`, speilet i `sale_status_transitions`). Hver statusendring skrives til `sale_events` av en trigger. Synlighet som for samtaler: `calls.read.own` (egne), `calls.read.team` (salg gjort i ens team) og `calls.read.all` (alle, krever BankID eller passkey). `sales.manage` registrerer og endrer; selgere bare egne salg, med `calls.read.all` også for andre. Kundesiden viser kundens salg | PR F2 (laget) |

## 13. Samtalen: opptak, transkribering, AI-kontroll og rapporter

Påbegynt 2. oktober 2026 (modul 5, 6 og 7), i én PR. Godkjent av Nadeem 3. oktober slik det står, og justeres etter full testing i staging. Oppsettet følger MedSide-transkripsjonen, med ett unntak: VeriQall lagrer lyden, fordi avspilling og klagedokumentasjon er formålet.

Beslutninger 2. oktober:

- **Opptak i nettleseren.** Selgeren tar opp på `/samtaler/opptak`, med mikrofon eller **fanelyd** (nettbasert telefoni, Teams, Whereby, Zoom o.l. i en nettleserfane, bare Chrome og Edge på PC og Mac). Fanelyden blandes med mikrofonen i nettleseren. Videosporet fra fanedelingen stoppes med en gang, så ingen skjermbilder tas opp. Fanedelingen brukes på nytt ved neste opptak så lenge den er aktiv. Lydfiler kan også lastes opp.
- **To moduser**, valgt av superadmin under System:
  - **Bitvis (standard, besluttet av Nadeem 3. oktober, som i MedSide):** nettleseren lager en egen, hel lydfil hvert 15. sekund (en ny opptaker startes før den forrige stoppes, så ingen lyd faller mellom). Hver bit lastes opp og transkriberes av workeren med Soniox' async-modell `stt-async-v5` i EU, og teksten vises i studioet fortløpende. **Bitene blir samtalens transkripsjon**, med tider fra starten av opptaket, så den er klar når opptaket stoppes, og AI-kontroll og notater starter med en gang. Bitens lyd slettes når den har fått tekst. Mangler en bit eller feilet den tre ganger, transkriberes hele opptaket i stedet.
  - **Sanntid:** lyden strømmes til Soniox med en midlertidig nøkkel (den faste nøkkelen forlater aldri serveren), og selgeren ser teksten mens det snakkes. Faller sanntid ut, tar bitvis over teksten uten at selgeren må gjøre noe. Den lagrede transkripsjonen lages fra hele opptaket etter samtalen.
- **Den lagrede transkripsjonen kan ikke endres i nettleseren.** Den lages på serveren, fra bitene eller fra hele opptaket, og stemmer med lyden som spilles av. Taler 1 og 2 skilles per bit i bitvis modus, så de kan bytte plass fra bit til bit.
- **Hele opptaket lastes også opp i biter hvert 15. sekund** mens det pågår, til S3 via kortlevde presignerte URL-er, så lite går tapt om nettleseren stopper. Et opptak som ikke ble avsluttet, kan fullføres fra samtalesiden, og blir behandlet automatisk etter tre timer uten nye biter.
- **Hos Soniox slettes lydfilen og transkripsjonen med en gang teksten er hentet.**
- **Lagringstid** velges av superadmin per callsenter: 3, 6, 9 eller 12 måneder (standard 12). Den gjelder samtaler som opprettes etterpå. En utløpt samtale skjules med en gang (RLS) og slettes med lyd, transkripsjon, AI-kontroll og rapporter av workeren. S3 har i tillegg en livssyklusregel som sletter alt etter 13 måneder og slettede versjoner etter ett døgn.
- **AI-modell** velges av superadmin under System: Claude Sonnet 4.6 (standard), Sonnet 4.5, Opus 4.5 eller Haiku 4.5, alle via Amazon Bedrock med EU-inferensprofiler (`eu.anthropic.*`), så behandlingen skjer bare i EU-regioner. Kallene går fra `eu-north-1` (Converse-API-et).
- **AI-kontroll** med den valgte modellen. Samtalen sjekkes mot malversjonen den er koblet til (via salget, eller produktets gjeldende versjon): hvert obligatoriske punkt (grønn, gul, rød), forbudte formuleringer (rød), pris og vilkår som ikke stemmer, og andre alvorlige forhold. Hvert funn har sitat og tidspunkt i opptaket. Samtalen får det verste flagget. Gule og røde flagg behandles av den som har `flags.review`, med kommentar.
- **Rapport** etter hver samtale etter callsenterets standard rapportmal (`report_templates.manage`), eller VeriQalls standardrapport.
- **Én kanal.** Taler 1 og 2 kommer fra automatisk taleradskillelse og kan bytte plass.
- **Referanse per samtale (Nadeem, 3. oktober).** Hver samtale får en fast referanse som `VQ-7K3M-Q9TX` (8 tegn uten forvekslbare tegn som 0/O og 1/I/L), laget av databasen og unik på tvers av callsentre. Den kan aldri endres. Når opptaket er ferdig, viser Samtalestudio referansen med en «Kopier»-knapp, og selgeren limer den inn der salget registreres i callsenterets eget system. Ved klage eller kontroll søkes referansen opp under Samtaler (med eller uten bindestreker, store eller små bokstaver), og den finner samtalen med opptak, transkripsjon og AI-kontroll. Referansen gir ingen tilgang i seg selv: søket følger de vanlige reglene for hvem som ser hvilke samtaler. Migrasjonen `0034_call_references.sql`.

| Del | Innhold |
|---|---|
| Database | `0013_calls.sql` og `0023_call_pieces.sql` (`call_pieces`, `calls.piece_count`, bitvis som standard): `calls` (lenker, status, lagringstid, lease for workeren), `transcripts` med norsk fulltekstsøk, `transcript_segments`, `call_analyses`, `report_templates`, `reports`, `usage_events`, `platform_settings`, og rollen `app_worker` (innlogging `veriqall_worker`) med policyer bare på det workeren trenger. Transkripsjoner revideres ikke i `audit_log`, så teksten ikke overlever lagringstiden |
| API | `/org/calls` (opprette, biter, fullføre, prøve igjen, status, vise, spille av, koble, behandle flagg), `/org/report-templates`, `/admin/system`, `/admin/usage`, lagringstid på `/admin/organizations/{id}`, og `modules` i `/me`. Visning og avspilling skrives til `access_log` |
| Worker | `apps/api/src/worker.ts`: setter sammen bitene, transkriberer med Soniox, AI-kontroll og rapport med Claude, sletter utløpte samtaler, fullfører forlatte opptak og plukker opp samtaler som ble hengende (gir opp etter tre forsøk). Startes av API-et for hver samtale, og for opprydding høyst hvert kvarter når appen er i bruk. En fast tidsplan (EventBridge) krever en endring i bootstrap-stacken og kommer før produksjon |
| Web | `/samtaler` (søk i samtalene, flagg, status), `/samtaler/opptak`, `/samtaler/[id]` (avspilling fra hvert tidspunkt, funn, rapport, koblinger), `/samtaler/rapportmaler`, samtaler på kunde- og salgssidene, og superadmin System og Økonomi (forbruk per callsenter) |

Før det virker i staging: Soniox-nøkkelen i `callsenter/staging/app` må komme fra et Soniox-prosjekt i EU-regionen (EU-endepunktene avviser nøkler fra andre regioner; EU bestilles hos Soniox). Claude-modellene som skal kunne velges, må være slått på i Bedrock (Model access) i `eu-north-1`. Modulene Transkribering, AI-kontroll og Rapporter slås på per callsenter under Callsentre.

## 14. Salgsverifisering, dokumentasjon og klager

Bygget 2. oktober 2026 (modul 8, 9 og 10), i én PR. Godkjent av Nadeem 3. oktober slik det står, og justeres etter full testing i staging.

**Tilleggsmodul (Nadeem, 3. oktober).** De fleste callsentre har allerede sitt eget system for bekreftelse og kundelenker. Salgsverifisering (`sale_verification`) er derfor en egen modul som slås på per callsenter og faktureres ekstra, fordi hver aksept med BankID eller Vipps koster oss penger. Callsentre uten modulen kobler samtalen til salget i sitt eget system med samtalens referanse (seksjon 13).

Beslutninger 2. oktober:

- **Skriftlig aksept via lenke.** Ved telefonsalg er forbrukeren bare bundet når hen godtar tilbudet skriftlig etter samtalen (angrerettloven § 10). Selgeren lager en lenke på salgssiden (`sales.manage`). Kunden åpner den uten å logge inn, ser tilbudet med pris, binding, angrefrist og vilkår fra malversjonen salget peker på, og **godtar med BankID eller Vipps**, eller avslår (uten identifisering). Salget går til «bekreftet» eller «avvist» av seg selv.
- **Lenken gjelder i 7 dager** og vises bare når den lages (bare hashen lagres). En ny lenke trekker tilbake den forrige. Lenken kan trekkes tilbake fra salgssiden, og trekkes tilbake av seg selv hvis salget kanselleres eller settes til bekreftet for hånd mens det venter.
- **Hemmeligheten står i fragmentet** (`/bekreft#…`), som nettleseren aldri sender til en server. API-et får den som parameter eller i body, så den havner ikke i tilgangsloggen til API Gateway eller Amplify.
- **Godkjenningen er bundet til nettleseren** som åpnet tilbudet: en kortlevd cookie settes når identifiseringen starter og kreves når kunden kommer tilbake. Slik kan ingen sende BankID- eller Vipps-lenken videre til en kunde som ikke har sett tilbudet.
- **Etter at lenken er besvart, trukket tilbake eller utløpt, vises bare status**, ikke selve tilbudet med kundens opplysninger.
- **SMS kommer senere.** Til leverandøren er valgt (seksjon 8), kopierer selgeren lenken og sender den selv på SMS eller e-post. `sent_via` står klar for SMS.
- **Bevis:** dokumentet kunden så, lagres som kanonisk JSON med SHA-256 (dokument-ID), sammen med malversjonen, metode, navn fra BankID eller Vipps, verifisert mobilnummer (Vipps), en hash av innloggings-ID-en (ikke selve ID-en), sikkerhetsnivå, tidspunkt, IP og nettleser. En avgjort bekreftelse kan aldri endres (trigger).
- **Bare kjøperen kan godta (Nadeem, 3. oktober).** Kjøperen er kunden, og for en bedrift kontaktpersonen. Aksepten godtas når Vipps-nummeret stemmer med kundens mobilnummer, eller når for- og etternavnet fra BankID eller Vipps står i navnet callsenteret har registrert (mellomnavn, store og små bokstaver og aksenter spiller ingen rolle). Ellers blir ingenting godtatt: personen får beskjed om at tilbudet må godtas av kjøperen selv, lenken står åpen for kjøperen, salget venter fortsatt, og forsøket står i salgets historikk uten navnet til den som forsøkte. En bedriftskunde må ha kontaktperson eller mobilnummer før tilbudet kan sendes. Migrasjonen `0035_buyer_must_accept.sql`. (Før 3. oktober ble aksepten godtatt med en advarsel til selgeren.)
- **Identifiseringen gir ingen innlogging.** Den bruker samme OIDC-flyt som innloggingen, men tilstanden er knyttet til bekreftelsen, og ingen økt opprettes. De offentlige sidene går gjennom den smale rollen `app_auth` og to `security definer`-funksjoner.
- **Dokumentasjon per salg** (modul 9) på `/salg/[id]/dokumentasjon`: salget, tilbudet og vilkårene, kundens aksept, samtalene med transkripsjon, AI-kontroll og rapport, og historikken. Kan skrives ut eller lagres som PDF fra nettleseren. Hver visning logges i `access_log`, og hver samtale som vises, logges i tillegg på samtalen.
- **Klager** (modul 10) på `/klager` med `complaints.manage`: kunde, valgfritt salg, kanal, dato, beskrivelse, saksbehandler, status (ny, under behandling, løst, avvist) og utfall, som må fylles ut før saken lukkes. Historikk og notater er append-only. Gjelder klagen et salg, vises salgets dokumentasjon i saken og logges som `complaint_documentation`. Er salget ikke synlig for saksbehandleren (andres salg krever tilgang til alle samtaler og sterk innlogging), vises en melding i stedet.

| Del | Innhold |
|---|---|
| Database | `0014_sale_confirmations.sql` (`sale_confirmations`, `auth_states.confirmation_id`, `app.confirmation_view` og `app.confirmation_decide`) og `0015_complaints.sql` (`complaints`, `complaint_events`) |
| API | `/confirm/*` (offentlig), `/org/sales/{id}/confirmations`, `/org/sales/{id}/documentation` og `/org/complaints` |
| Web | `/bekreft/[token]` og `/bekreft/ferdig` (for kunden), kortet Kundens bekreftelse på salgssiden, `/salg/[id]/dokumentasjon`, `/klager`, `/klager/[id]` og klager på kundesiden |

Modulene Salgsverifisering, Dokumentasjon og Klagehåndtering slås på per callsenter og sjekkes i API-et. «Åpnet» på en lenke betyr at lenken er åpnet, ikke nødvendigvis av kunden (selgeren kan ha åpnet den selv).

**Besluttet 2. oktober (Nadeem):** bekreftelse og signering av salg gjøres ikke av VeriQall foreløpig. Modulen Salgsverifisering står av, koden blir liggende, og salg settes til «bekreftet» for hånd. Ingen SMS.

Må sjekkes hvis modulen tas i bruk: at lenke med BankID- eller Vipps-aksept oppfyller kravet om skriftlig aksept (juridisk vurdering), hvilken tekst bekreftelsessiden skal ha om angreretten (angrerettskjema), og om Vipps Logg inn er godkjent brukt til aksept (Vipps sier selv at Login ikke er en elektronisk ID; BankID er sikrest).

## 15. Dashboard og coaching

Bygget 2. oktober 2026 (modul 11) som fase 4A, oppå fase 3. Godkjent av Nadeem 3. oktober slik det står, og justeres etter full testing i staging. Fakturamodulen (modul 15) kommer i en egen PR (fase 4B).

Beslutninger 2. oktober:

- **Alle ser sine egne tall.** `/oversikt` viser salg, andel bekreftet, bekreftet verdi per måned, samtaler og timer opptak, AI-flagg (godkjent, avvik, brudd og ubehandlede), klager, utvikling per dag (per uke over 45 dager) og de ti hyppigste avvikene. `dashboard.team` gir teamets tall og en liste over selgerne i teamet, `dashboard.all` hele callsenteret og hvert team.
- **Tallene er antall, ikke innhold.** De kommer fra én `security definer`-funksjon (`app.dashboard`) som sjekker rettighetene selv. En leder ser dermed teamets tall uten å kunne lese samtalene. For å åpne en samtale gjelder fortsatt `calls.read.*`. Salg og samtaler telles i teamet de ble gjort i, som for synlighet. Dager regnes i norsk tid, og perioden er høyst ett år.
- **En teamleder ser en selger bare som del av teamet:** tallene for en selger viser det hen har gjort i lederens team, også etter et teambytte. «Hyppigste avvik» grupperes etter malens obligatoriske punkter og type funn, aldri etter AI-ens egen beskrivelse av samtalen.
- **Tilbakemeldinger** (`coaching.give`) gis til en selger i lederens team, eller til alle med `dashboard.all`, valgfritt knyttet til en samtale (fra samtalesiden). Typen er «Ros» eller «Kan bli bedre». Tilbakemeldingene kan ikke endres eller slettes, men selgeren kan merke dem som lest. Lederen ser når de er lest. Tilbakemeldingen blir stående når samtalen slettes etter lagringstiden, men koblingen fjernes.
- **Ingen AI-generert coaching ennå.** «Hyppigste avvik» bygger på funnene fra AI-kontrollen, og lederen skriver tilbakemeldingen selv. Forslag fra Claude basert på selgerens siste samtaler kan komme senere (krever Bedrock-tilgang for API-Lambdaen).
- **Modulen «Dashboard og coaching»** slås på per callsenter.

**Utvidet 3. oktober (Nadeems ønske):** ledere ser dagens samtaler og AI-flaggene med en gang.

- **Periode:** I dag (standard), I går, Denne uken, Forrige uke (uker fra mandag), Denne måneden, Forrige måned, Siste 30 og 90 dager, Hittil i år, eller to datoer (høyst ett år). Valget huskes på enheten.
- **Ledere starter med det de leder:** hele callsenteret med `dashboard.all`, ellers sitt team.
- **AI-kontroll:** én stolpe med Brudd, Avvik, Godkjent og Ikke kontrollert, med antall og andel. Et klikk på en del viser de samtalene i listen under. «N flagg er ikke behandlet» viser dem som venter på behandling.
- **Utvikling:** flaggene per time for én dag, per dag inntil 45 dager, ellers per uke, med tabellvisning.
- **Samtaler i perioden:** tid, varighet, selger, kunde og team, flagg og om det er behandlet, filtrert på Alle, Brudd, Avvik, Ikke behandlet, Godkjent eller Ikke kontrollert. Listen følger samtaletilgangen (`calls.read.*`), og et klikk åpner samtalen.
- **Logg på samtalesiden** (`audit.read`): hvem som har åpnet, spilt av og søkt i samtalen, og hva som er gjort (statusendringer, AI-kontroll, behandling av flagg, notater og justeringer). Aldri teksten.

**Et dashboard per nivå (Nadeems ønske 3. oktober):** hver bruker får sitt eget dashboard. Hvem som ser hva, styres av rettighetene, ikke rollenavnene. `/oversikt` har fanene Meg, Teamet, Callsenteret og Kvalitet. Administrasjon og Superadmin har hver sin Oversikt-fane (seksjon 11 og 10). Første gang lander man på det høyeste nivået man har. Senere husker enheten valget.

- **Meg (alle):** samtaler, salg, andel bekreftet, snittlengde og andel godkjent av AI. Tallene sammenlignes med perioden av samme lengde rett før: «Opp 12 % fra forrige periode (181)», med pil og tekst, aldri i grønt eller rødt. Mens perioden pågår (den tar med i dag), vises bare tallet fra forrige periode, fordi en prosent ville sammenligne en halv dag med en hel. Snittet per selger i teamet vises uten navn, og bare når minst tre i teamet har vært aktive i perioden. Med færre kunne man regne ut hva en kollega har gjort. I tillegg vises AI-kontrollen, utvikling, «Det du oftest glemmer», samtalene og tilbakemeldingene.
- **Teamet (`dashboard.team`, eller `dashboard.all` med valg av team):** nøkkeltall med utvikling (salg, bekreftet, samtaler, andel brudd og ubehandlede flagg). «Selgerne» sammenligner selgerne på salg, samtaler, andel brudd eller ubehandlede flagg. «Trenger oppfølging» viser de som har flagg som venter, brudd i minst 20 % av samtalene (minst to brudd), ingen tilbakemelding på over 30 dager eller ingen aktivitet. «Aktivitet per dag» er et varmekart med selger mot dag (per uke over 31 dager), og tallet står i hver rute.
- **Callsenteret (`dashboard.all`):** det samme for hele callsenteret.
- **Kvalitet (`dashboard.all` sammen med `flags.review` eller `complaints.manage`):** for compliance, som lander her første gang hvis de verken selger eller styrer brukere.
  - **Køen nå:** ubehandlede flagg etter alder (under 1 døgn, 1–3, 3–7 og over 7 døgn) og hvor lenge det eldste har ventet.
  - **Behandling:** flagg behandlet i perioden, med median tid fra kontroll til behandling.
  - **Avvik:** andel flagget, avvik per produkt (brudd og avvik som del av de kontrollerte), selgerne med høyest andel brudd (minst tre kontrollerte samtaler, så én uheldig samtale ikke topper listen) og hyppigste avvik.
  - **Klager** (med klagemodulen): per status og kanal, per uke, og median tid til avslutning.
  - **Kundeaksept** (med salgsverifisering): godtatt med BankID eller Vipps, avvist, venter, utløpt og trukket tilbake, og hvor mange som ble godtatt av en person som ikke stemte med kunden.
  - **Tilgang** (`audit.read`): hvem som har åpnet, spilt av og søkt i opptak og transkripsjoner.
  - Databasefunksjonen er `app.dashboard_quality` (`0033_quality_dashboard.sql`), og endepunktet er `GET /org/dashboard/quality`.
- **Database:** `0030_role_dashboards.sql` med `app.dashboard_benchmark` og `app.dashboard_team`, begge `security definer` med egne rettighetssjekker som `app.dashboard`. API: `GET /org/dashboard/benchmark` og `GET /org/dashboard/team`.

| Del | Innhold |
|---|---|
| Database | `0016_dashboard_coaching.sql`: `coaching_notes` med RLS, `app.can_coach` og `app.dashboard`; `0024_dashboard_flags.sql`: flagg per dag og time, og indekser for samtaleloggen; `0030_role_dashboards.sql`: `app.dashboard_benchmark` og `app.dashboard_team`; `0033_quality_dashboard.sql`: `app.dashboard_quality` |
| API | `GET /org/dashboard` (`scope` = me, seller, team eller all, `target`, `from`, `to`), `GET /org/dashboard/benchmark`, `GET /org/dashboard/team` (`team`, `from`, `to`) og `GET /org/dashboard/quality`, `GET`/`POST /org/coaching` og `POST /org/coaching/{id}/read` |
| Web | `/oversikt` med fanene Meg, Teamet, Callsenteret og Kvalitet, `/oversikt/selgere/[id]` og tilbakemelding på samtalesiden |

## 16. Økonomi og fakturering

Første versjon ble bygget 2. oktober 2026 (modul 15). Godkjent av Nadeem 3. oktober slik det står, og justeres etter full testing i staging. Samme dag ble den lagt om etter Nadeems beskrivelse av Økonomi-fanen i MedSide, tilpasset VeriQall: **kunden er callsenteret**, ikke en enkeltbruker.

**Økonomi** i superadminportalen har fire underfaner. Den siste du brukte, huskes til neste besøk:

| Underfane | Innhold | Status |
|---|---|---|
| Forbruk | Forbruk og kostnad per callsenter og totalt: KI, Soniox og eID, per modul og modell, med pristabell og valutakurs | Bygget (PR 2) |
| Stripe | Kortabonnement, priser og MRR fra Stripe | Venter på Stripe-konto og nøkler |
| Faktura | Fakturaer, Kunder, Gjentakende, Pakker og Innstillinger | Bygget |
| Regnskap | Kostnader mot inntekter for valgt periode, nettoresultat, MRR og ARR, utvikling per måned, omsetningsrapport og manuelle poster | Bygget (PR 3) |

### Forbruk

- **Periode:** dag, uke eller måned. Standard er denne måneden, og «Nullstill» gir hele perioden.
- **Forbruksstatistikk:**
  - KI-generering: antall kall, tokens inn og ut, kostnad.
  - Soniox: transkripsjoner, timer lyd etter samtalen og i sanntid, kostnad.
  - BankID og Vipps: innlogginger, registreringer (første innlogging), mislykkede og avbrutte, kostnad i kroner.
- **Per callsenter** (i stedet for per bruker i MedSide):
  - kostnad i dag, denne uken, denne måneden, i år og totalt, og antall transkripsjoner;
  - kolonnene kan sorteres;
  - en rad åpnes med detaljer per modul, per modell, Soniox og eID for valgt periode.
  - eID knyttes til callsentrene brukeren er medlem av (en bruker i to callsentre telles i begge).
- **Per modul** (transkribering, sanntidstekst, AI-kontroll, rapporter) og **per modell**.
- **Pristabell** som superadmin endrer:
  - Claude per million tokens i USD per Bedrock-modell. Standardverdiene er listeprisene: Sonnet 3/15, Opus 4.5 5/25, Haiku 1/5.
  - Soniox per time lyd i USD (0,10 etter samtalen og 0,12 i sanntid).
  - BankID og Vipps per innlogging i kroner. Disse er ikke satt, fordi de avhenger av avtalene.
- **Valutakurs:** USD/NOK hentes fra Norges Bank hver morgen. Den kan også hentes med «Hent kurs nå».
- **Hva kostnaden er:** vår beregning fra forbruksloggen. Behandles en samtale på nytt, koster det oss igjen og telles med. Soniox' faktiske forbruk hentes ikke ennå. Det krever Soniox' bruks-API og kan komme sammen med Regnskap.

### Regnskap

Bygget i PR 3 (`0021_accounting.sql`, `apps/api/src/admin/accounting.ts`, `/admin/okonomi/regnskap`).

- **Periode:** denne måneden, forrige måned, siste 7, 30 eller 90 dager, eller hittil i år.
- **Kostnader:** KI, Soniox og eID fra Forbruk (omregnet med USD/NOK for dagen), manuelle kostnader, og faste månedskostnader. Faste kostnader legges inn én gang med fra- og til-måned og fordeles på dagene i perioden. En negativ manuell kostnad er en kreditering eller refusjon.
- **Inntekter:** telles når pengene kommer, altså registrerte innbetalinger på fakturaer og manuelle inntekter. Mva holdes utenfor: for en innbetaling er mva-andelen innbetaling × fakturaens mva / fakturaens total.
- **Resultat:** inntekter eks. mva minus kostnader.
- **Nøkkeltall:** MRR fra aktive faste avtaler som ikke er på pause (eks. mva, omregnet til per måned), ARR = MRR × 12, antall aktive avtaler, betalende kunder og callsentre i prøveperiode.
- **Per måned:** de siste 12 månedene med inntekter, kostnader og resultat, som graf og tabell.
- **Omsetningsrapport:** innbetalinger fordelt på fakturalinjene (per pakke, fakturagebyr, andre linjer og manuelle innbetalinger), per måned, med CSV-eksport.
- **Tilgang:** bare superadmin (RLS), og alle endringer i `audit_log`.

### Faktura

Besluttet 2. oktober (Nadeem):
- Faktura og betaling styrer tilgangen. Callsenteret stenges 5 dager etter uteblitt betaling.
- Pakkene styres i superadminportalen.
- Avsender og logo legges inn manuelt.

- **Kunder** er callsentrene, med fast kundenummer fra 10001. Faktura-e-post og -adresse endres under Callsentre.
- **Pakker** lages og endres under Faktura → Pakker:
  - navn, pris per måned eks. mva og mva;
  - hvilke **moduler** pakken gir.
  - Pakker kobles til Stripe-priser når Stripe kommer.
- **Ny faktura** har kunde, fakturadato, forfall og linjer:
  - linjetyper: pakker, fritekst og fakturagebyr;
  - **Aktiver tilgang:** callsenteret er åpent ut perioden og får pakkenes moduler. Perioden starter på fakturadatoen og varer like mange dager som måneden har (31, 30, 29 eller 28), til den endres for hånd. Tilgangen gjelder til og med siste dag kl. 23:59 norsk tid.
  - Fakturaer uten tilgang påvirker ikke callsenteret.
- **Statuser:** utkast, planlagt, sendt, forfalt, betalt, kreditert og betaling uteblitt.
- **Planlagt sending:** en fakturadato fram i tid gjør at fakturaen sendes automatisk den morgenen. Utkast og planlagte fakturaer kan endres og slettes, og PDF kan forhåndsvises (merket FAKTURAUTKAST, uten nummer).
- **Sending:**
  - Fakturanummeret tildeles nå, fortløpende fra 1000001 uten hull. Kreditnotaer følger samme serie.
  - Avsender, mottaker, linjer og beløp fryses i databasen. Fakturadatoen blir sendedagen.
  - PDF med logo sendes på e-post fra `noreply@` med blindkopi til kopiadressen.
  - Tilgang og moduler oppdateres.
  - Uten e-post lastes PDF-en ned og sendes for hånd.
- **Betaling** registreres for hånd, helt eller delvis. Fakturaen blir betalt når betalingene dekker den.
- **Betaling uteblitt:**
  - Morgenkjøringen setter denne statusen på fakturaer med tilgang som ikke er betalt **5 dager etter forfall**. Superadmin kan også gjøre det for hånd, og da stenges callsenteret med en gang.
  - Callsenteret stenges, og de gjentakende fakturaene settes på pause.
  - Når betalingen registreres, åpnes callsenteret igjen ut den betalte perioden. De gjentakende fakturaene fortsetter fra neste forfall, uten fakturaer for månedene som ble hoppet over.
  - Et stengt callsenter ser heller ikke sine egne fakturaer før det åpnes igjen. Fakturaen er sendt på e-post.
  - Gjenåpningen skjer bare når ingen andre fakturaer har «betaling uteblitt». En faktura med uteblitt betaling kan også krediteres. Da fortsetter avtalene, men kreditnotaen åpner ikke callsenteret i seg selv.
  - Superadmin kan endre tilgangen for hånd under Kunder (dato, eller la fakturaene slutte å styre den), og gjenoppta en avtale under Gjentakende.
  - Under Callsentre vises et slikt callsenter som «Stengt (ubetalt faktura)».
- **Kreditnota** for hele fakturaen speiler originalen (avsender, mottaker og mva) og sendes på e-post.
- **Gjentakende:**
  - forfall samme dag hver måned (eller hvert kvartal, halvår eller år);
  - sendes et fast antall dager før forfall (standard 14, kan endres per avtale og under Innstillinger);
  - perioden på fakturaen er avtalens (fra forfall til dagen før neste), så en kvartalsavtale gir tilgang hele kvartalet;
  - linjer fra pakker eller fritekst, og om fakturaen gir tilgang.
- **Feil stopper ikke morgenkjøringen:** en faktura eller avtale som ikke kan sendes (ingen linjer, ufullstendige innstillinger), hoppes over med en advarsel i loggen og prøves igjen neste morgen. En periode som allerede er over (etterfakturering), endrer ikke tilgangen.
- **Morgenkjøringen** kjører kl. 04:00 UTC (EventBridge til workeren) og kan startes med «Kjør nå». Den gjør tre ting:
  1. sender planlagte fakturaer;
  2. sender gjentakende fakturaer som skal ut;
  3. setter «betaling uteblitt» på fakturaer som ikke er betalt.
- **Innstillinger:**
  - Avsender: firmanavn, org.nr., mva-registrering, adresse, e-post, kontonummer og bunntekst.
  - Logo (PNG eller JPEG, lastes opp; uten logo vises firmanavnet).
  - Standard forfall, fakturagebyr og dager før forfall for gjentakende fakturaer.
  - Kopiadresse.
  - Neste fakturanummer (kan bare økes).
  - Priser for forbruk.
- **Callsenteret** (admin med `billing.read`, BankID eller passkey) ser sine sendte fakturaer og laster ned PDF under Administrasjon → Fakturaer.

**Regler som databasen håndhever** (`0017_invoicing.sql` og `0019_billing_v2.sql`):
- fortløpende nummer uten hull;
- en sendt faktura kan ikke endres eller slettes, bare krediteres;
- kundenummeret er fast;
- «kreditert» bare gjennom en kreditnota;
- tilgang, moduler, pause og gjenopptak skjer i triggere, så de alltid følger fakturaen.

**Ikke med ennå:**
- KID (ikke foreløpig, besluttet 2. oktober).
- Stripe-fanen (venter på nøkler).
- Soniox' faktiske forbruk (Regnskap bruker vår beregning fra forbruksloggen).

| Del | Innhold |
|---|---|
| Database | `0017_invoicing.sql`, `0018_invoice_emails.sql`, `0019_billing_v2.sql` (kundenummer, `access_until`, `billing_packages`, statusene `scheduled` og `payment_missed`, periode, `app.billing_daily`) |
| API | `/admin/billing/*` (oversikt, innstillinger, logo, pakker, kunder, `run`), `/admin/invoices` (utkast, `send`, `unschedule`, `missed`, `payments`, `credit`, `email`, `usage`, `pdf`), `/admin/recurring-invoices`, `/org/invoices` og PDF |
| Worker | `{task: "daily"}` fra EventBridge: `app.billing_daily()` og e-post med PDF |
| Web | `/admin/okonomi/{forbruk,stripe,faktura,regnskap}`, med `faktura/{kunder,gjentakende,pakker,innstillinger}` og `faktura/[id]`, og Administrasjon → Fakturaer |

Må sjekkes før bruk: at fakturaen oppfyller bokføringsforskriften, for eksempel at «Foretaksregisteret» står i bunnteksten for aksjeselskap.

## 17. E-post

Besluttet 2. oktober 2026: **Amazon SES**, ikke Resend. SES koster rundt 0,10 USD per 1000 e-poster uten fast pris. Lambdaen sender via IAM-rollen (ingen API-nøkkel å lagre). E-postene behandles i AWS i EU, under samme avtale som resten.

- **Eget avsenderdomene per miljø:** `noreply@staging.veriqall.no` i staging og `noreply@veriqall.no` i produksjon, så miljøene er adskilt og testing ikke skader omdømmet til produksjonsdomenet. API-et har bare lov til å sende fra `noreply@` på sitt eget domene.
- **DKIM** (2048-bit, Easy DKIM), **SPF** via eget MAIL FROM-domene (`mail.<domene>`) og **DMARC** (`p=none` til å begynne med, strammes inn når alt er sett å virke).
- **Hva som sendes:** invitasjonslenker (når personen har e-post; lenken vises fortsatt, så den også kan sendes på SMS) og fakturaer. Fakturaen sendes som hele fakturaen i e-posten (ingen innlogging trengs) til faktura-e-posten som ble frosset da fakturaen ble sendt. Hver utsending logges (`invoice_emails`).
- **Uten `EMAIL_DOMAIN`** sendes ingenting, og alt virker som før (lenker kopieres, fakturaer skrives ut).
- **Morgenkjøringen** (EventBridge) kommer sammen med `EMAIL_DOMAIN`, siden begge trenger den oppdaterte bootstrap-stacken (SES og EventBridge).
- **DNS** ligger fortsatt hos one.com. Postene står i deploy-loggen og i `infra/README.md`. Å flytte DNS (ikke registreringen, `.no` kan ikke registreres i Route 53) til Route 53 vil gjøre slike poster automatiske. Det vurderes før produksjon.

Rekkefølge første gang: oppdater bootstrap-stacken (SES-rettigheter) → sett `EMAIL_DOMAIN` på Environment `staging` → deploy → legg inn DNS-postene hos one.com → søk SES om produksjonstilgang.

## 18. Samtalestudio

Bygget 2. oktober 2026 etter Nadeems beskrivelse av Notatstudio i MedSide, med VeriQalls forskjeller. `/samtaler/opptak` er nå Samtalestudio. Prinsippet er det samme: **transkripsjonen er råstoffet, og malen bestemmer hva samtalen sjekkes mot og hva notatet blir.**

Forskjeller fra Notatstudio (besluttet av Nadeem 2. oktober):

- **Selgeren kan ikke endre transkripsjonen.** Den lages på serveren fra det lagrede opptaket, kan ikke skrives inn, limes inn eller redigeres, og stemmer med lyden som spilles av (databasen gir ingen rett til å endre den).
- **Selgeren kan justere notatet.** AI-teksten beholdes uendret, og hver justering lagres som en ny versjon med navn og tidspunkt (`report_edits`, append-only). Ledere og dokumentasjonen viser det justerte notatet, merket «Justert av …», med AI-versjonen ved siden av.
- **Varsellamper.** Hvert obligatorisk punkt i produktmalen er en lampe. Før og under samtalen er lampene grå («Husk»), så selgeren ser hva som må sies. Etter AI-kontrollen er de grønne, gule eller røde, med sitat og tidspunkt. Forbudte formuleringer, feil pris eller vilkår og andre alvorlige forhold får egne lamper. Betydningen står alltid også som tekst.
- **Malen er produktmalen**, ikke en journalmal. Den velges i listen «Mal» øverst, med stjerne for egen standardmal («Sett som standardmal for Samtalestudio»). Valget huskes i fanen. Velges et salg, brukes malversjonen salget ble gjort på. Malen kan byttes under og etter opptaket, til AI-kontrollen har kjørt.
- **Notatmaler i stedet for tilleggsmaler** (Nadeem 2. oktober: «Hovedvalget skal være produktmal. Tilleggsmal kan her erstattes av notatmal.»). Rett under «Mal» slår selgeren notatmaler av og på, flere samtidig (høyst fem). Hver notatmal som er på, gir sitt eget notat etter samtalen, og «Regenerer» lager nye notater med dem som er på. Er ingen valgt, brukes callsenterets standard notatmal (eller VeriQalls standardnotat). Valget huskes i fanen og lagres på samtalen (`calls.note_templates`), og kan endres til notatene er skrevet.
- **Ingen fraser og ikke språkvalg.** Notatet skrives på norsk bokmål.

Skjermbildet:

- **Øverst:** «Mal» (produktmalen) med stjerne, notatmalene rett under, opptaksknappen (mikrofon eller fanelyd), «Last opp lydfil», og kunde, salg og tittel (valgfritt, kan kobles etterpå).
- **Midten:** Varsellamper, Transkripsjon (sanntidstekst under opptaket, den lagrede transkripsjonen etterpå, med søk) og Tilleggsinformasjon.
- **Til høyre:** Notater, med alle notatene fra samtalen, «Regenerer» (med notatmalene som er på), «Kopier» og «Rediger» (bare selgerens egen samtale). På samtalesiden velges notatmalene i panelet.
- **Etter opptaket** blir selgeren i studioet til notatet er klart, med «Åpne samtalen» og «Ny samtale». Samtalesiden (`/samtaler/[id]`) har de samme panelene, i tillegg til avspilling og behandling av flagg.

Regler:

- **Tilleggsinformasjon** er kontekst som ikke ble sagt i samtalen (for eksempel en avtale kunden har fra før). Den tas med når notatet lages, og AI-en skal merke den som selgerens opplysning. **AI-kontrollen bruker den aldri**, så lampene bygger bare på det som ble sagt.
- **Regenerer** lager nye notater fra den samme transkripsjonen med notatmalene som er på (eller standardmalen). Selgeren som hadde samtalen, eller den som har `report_templates.manage`, kan be om det. Høyst fem notater skrives om gangen, og høyst 10 notater per samtale. Workeren skriver notatet (Bedrock), og studioet sjekker status til det er ferdig.
- **Bare selgeren som hadde samtalen, kan justere notatet.** Andre ser det.
- **Rapportmaler heter nå notatmaler** i appen, og standardnotatet heter «Standardnotat». Rettigheten og modulen har samme nøkkel som før.
- **Alt spores:** forespørsler om notat og justeringer skrives til `audit_log` uten teksten, så teksten ikke overlever lagringstiden. Notater og justeringer slettes med samtalen.

| Del | Innhold |
|---|---|
| Database | `0022_call_studio.sql`: `calls.note_templates`; `reports` får status (`pending`, `done`, `failed`), `requested_by`, lease og forsøk; `report_edits` (append-only); `studio_preferences` (standardmal per medlem); grense på 10 notater og ett om gangen |
| API | `POST /org/calls/{id}/notes`, `PATCH /org/calls/{id}/notes/{noteId}`, `GET /org/calls/{id}/notes/{noteId}/history`, `GET`/`PUT /org/studio`; `GET /org/calls/{id}` gir `requiredPoints`, `isOwn` og notatene med justeringer |
| Worker | `{reportId}` skriver et notat; notater som ble hengende, plukkes opp av ryddejobben |
| Web | `/samtaler/opptak` (Samtalestudio), `components/calls/` (varsellamper, transkripsjon, tilleggsinformasjon, notater), samtalesiden og dokumentasjonen |

## 19. Språk

Besluttet av Nadeem 3. oktober 2026: VeriQall skal finnes på norsk (bokmål), engelsk, svensk, dansk og tysk, og notater og andre resultater skal kunne lages på alle disse. Arkitekturen skal gjøre det enkelt å legge til flere språk.

**Tre språkvalg som er uavhengige av hverandre:**

| Valg | Hvor | Standard |
|---|---|---|
| Språket sidene vises på | Brukeren selv (språkvelgeren i menyen og under Min konto, `users.locale`) | Callsenterets (`organizations.default_locale`), ellers nettleserens, ellers norsk |
| Språket notater og AI-kontroll skrives på | Selgeren per samtale i Samtalestudio (`calls.output_locale`), og per notat ved «Regenerer» (`reports.locale`) | Callsenterets (`organizations.content_locale`) |
| Språkene som snakkes i samtalen | Selgeren per samtale (`calls.spoken_languages`) | Callsenterets liste (`organizations.transcription_languages`, standard norsk) |

Superadmin setter callsenterets språk under Callsentre. Med «Lås språket for notater» (`organizations.content_locale_locked`) skrives alle notater og AI-kontroller på callsenterets språk: selgeren får ikke velge et annet i Samtalestudio eller ved «Regenerer», og API-et avviser forsøk. Språkene i samtalen er ikke begrenset til sidenes språk: Soniox kjenner igjen over 60 språk, og listen i velgeren viser navnene på brukerens språk (fra nettleseren). Soniox får språkene som hint og merker hvert ord med språket det hørte. Transkripsjonen får språket som ble hørt mest (`transcripts.language`).

**Hvordan det er bygget:**

- **Språkregisteret** er `LOCALES` i `packages/shared/src/locales.ts`: navnet på språket selv, BCP 47-taggen, navnet AI-en får, Soniox-koden og konfigurasjonen for fulltekstsøk. Databasen har de samme kodene i tabellen `locales` (sjekket av en test).
- **Sidene** bruker next-intl uten språk i adressen. Språket ligger i informasjonskapselen `vq_locale` på web-domenet, så serveren viser riktig språk med en gang. Tekstene ligger i `apps/web/messages/<språk>/<navnerom>.json`. Norsk er kilden; en test sjekker at alle språk har de samme nøklene og de samme `{plassholderne}` (ICU-format, med flertall). Nøklene er typesjekket mot de norske filene.
- **Datoer og tall** følger språket (`lib/format.ts`), og tiden vises alltid i norsk tid.
- **AI-en** får instruksjonene på engelsk og beskjed om hvilket språk den skal skrive på. Notatmaler kan skrives på hvilket som helst språk. Sitater fra samtalen beholdes på språket i samtalen. VeriQalls standardnotat finnes på alle språk (`apps/api/src/i18n.ts`).
- **Søk** i transkripsjonene finner ord både bøyd på transkripsjonens språk og slik de står (`transcripts.search_all`), med søkeordene bøyd på brukerens språk.
- **Kundens bekreftelsesside** følger nettleserens språk og har egen språkvelger.

**Slik legges et nytt språk til (for eksempel finsk):**

1. En oppføring i `LOCALES` (`fi`, `fi-FI`, `Finnish`, Soniox-koden `fi`, søkekonfigurasjonen `finnish`).
2. En migrasjon som legger `fi` i `locales` og i `app.search_config`.
3. Mappen `apps/web/messages/fi/` med alle navnerommene, og tekstene i `apps/api/src/i18n/` (`worker.ts`, `messages.ts` og `documents.ts`). Testene og typene sier fra om noe mangler.

**Status 3. oktober:** alt er oversatt: språkvalgene, AI og Soniox, søk og alle sidene. Tekster databasen lager selv, får en nøkkel som sidene viser på brukerens språk (kategoriene for AI-funn i dashboardet og radene i omsetningsrapporten), og en kreditnota uten begrunnelse får standardteksten på callsenterets språk. Data fra callsenteret (roller, team, produkter, notatmaler og punktene i produktmalen) vises slik de er skrevet. API-ets meldinger (feilmeldinger, arbeiderens feil og systemets merknader i salgshistorikken) oversettes til språket i forespørselen (`apps/api/src/i18n/messages.ts`, sjekket av `messages-coverage.test.ts`), og invitasjoner, faktura-e-post og faktura-PDF skrives på callsenterets språk (`organizations.default_locale`, `apps/api/src/i18n/documents.ts`).

## 20. Landingsside

Påbegynt 3. oktober 2026 (Nadeems ønske). Siden skal ikke være synlig for noen før den er ferdig; vi fortsetter å jobbe med den.

**Slik er den gjemt:** i staging ser superadmin siden på `/forhandsvisning/landingsside` (besluttet av Nadeem 3. oktober). Siden tegnes i nettleseren først etter at `/me` har bekreftet superadmin, med samme sjekk som superadminportalen (`apps/web/src/components/landing/superadmin-preview.tsx`); utloggede sendes til innlogging, og andre får avslag. Tekstene (navnerommet `landing`) ligger likevel i sidens kilde som alle andre tekster, så en som kjenner adressen og leser kildekoden, kan finne dem; det er ingen lenker til siden. Lokalt, uten API, finnes den også som `apps/web/src/app/landingsside/page.dev.tsx` (bare i utvikling, som `/design`). Koden ligger i repoet, som er offentlig.

**Innhold** (`apps/web/src/components/landing/landing-page.tsx`, tekstene i `apps/web/messages/<språk>/landing.json` på alle fem språk):

1. Hero med «Hver samtale dokumentert. Hvert salg verifisert.», knappene «Be om en demo» (e-post) og «Logg inn», tre fakta (EU, innlogging, språk), og et stillbilde av AI-kontrollen bygget av appens egne komponenter: varsellamper, transkripsjon og kundens aksept.
2. Hvorfor: kunden må godta skriftlig, klagen kommer uker senere, ingen rekker å høre alle samtalene.
3. Slik virker det, i fem steg: opptak i nettleseren, transkripsjon, AI-kontroll, kundens bekreftelse (merket som tilleggsmodul), dokumentasjon og klager.
4. Modulene (åtte kort), hvem siden er for (selger, leder, compliance, admin), «Bygget for å være bevis» (EU, skille per callsenter, innlogging, sporing, uforanderlige bevis, sletting), språk, pris (pakke, forbruk og salgsverifisering, uten tall), spørsmål og svar, og en avsluttende oppfordring.
5. Bunntekst med Hi4 Solutions AS, kontaktadresse og språkvelger.

Siden bruker appens design: samme tokens, lys og mørk modus, og grønn, gul og rød bare i AI-flaggene i stillbildet.

**Åpne punkter før publisering:**

- Kontaktadressen `kontakt@veriqall.no` er en plassholder (`CONTACT_EMAIL` i komponenten).
- Prisene står uten tall; tilbud etter avtale.
- Setningen om skriftlig aksept er skrevet for Norge (angrerettloven § 10). På engelsk, dansk og tysk står den generelt («i mange markeder»); svensk har samme krav og er like konkret som norsk.
- Ingen kundesitater eller tall, siden vi ikke har noen å vise til ennå.
- Personvernerklæring og vilkår finnes ikke som sider ennå, så bunnteksten lenker ikke til dem.

**Slik publiseres den:** `src/app/page.tsx` viser `<LandingPage />` i stedet for å sende til `/logg-inn` (innloggede brukere bør fortsatt sendes videre til portalen sin, slik `/logg-inn` gjør i dag), forhåndsvisningen fjernes, og `noindex` for `/` fjernes (`next.config.ts` og `layout.tsx` sier i dag noindex for hele appen).
