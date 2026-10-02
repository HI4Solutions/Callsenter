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
- **Kontooppsett:** egne AWS-kontoer for staging og produksjon (anbefalt) eller én konto med tagger. I dag ligger begge i samme konto.
- **SMS-leverandør** for salgsverifisering (modul 8). Til da sender selgeren lenken selv (seksjon 14).
- **Bedrock:** hvilke Claude-modeller er tilgjengelige direkte i `eu-north-1`, og krever noen EU cross-region inference (behandling i andre EU-regioner)?
- **Lovkrav:** sjekk hva angrerettloven krever av bekreftelse og skriftlig aksept ved telefonsalg. Modul 8 er bygget som skriftlig aksept med BankID eller Vipps (seksjon 14), men trenger en juridisk vurdering.
- **Lagringstid** for opptak og transkripsjoner, og sletting på forespørsel.
- **Fakturamodul:** besluttet 2. oktober at callsentrene betaler med både faktura og Stripe (se seksjon 10).
- **E-post for invitasjoner:** Amazon SES med `veriqall.no` (DNS-poster hos one.com). Til da kopierer superadmin lenken selv.
- **Logo:** venter på Nadeems godkjenning.
- **Repo:** døpe om til `veriqall`, og gjøre det privat før ekte nøkler eller kundedata.

## 9. Beslutninger og kostnader

Besluttet 2. oktober 2026:

- **AWS med RDS, ikke Supabase.** Point-in-time recovery er et krav i produksjon, siden data skal brukes som bevis i klagesaker. På RDS er det inkludert; på Supabase koster det rundt 100 USD i måneden per prosjekt. AWS gir i tillegg egen KMS-nøkkel, privat database og logger i egen konto.
- **Nettverk:** NAT-instans i staging, NAT Gateway i produksjon (seksjon 3). Ikke delte Lambdaer, ikke Aurora.
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
| Callsentre | Liste med søk og status, nytt callsenter (navn, org.nr., kontaktperson, faktura-e-post og -adresse, notat, prøveperiode), moduler per callsenter, brukerne i callsenteret, invitere med rolle (admin som standard), invitasjoner som kan trekkes tilbake | Fase 1, PR A (ferdig) |
| Brukere | Søk på tvers av callsentre, detaljer med medlemskap og koblede innlogginger (BankID og Vipps), deaktivere, fjerne en innloggingsmetode, aktive økter og tvangsutlogging, gi og fjerne superadmin, CSV-eksport | Fase 1, PR B (laget) |
| Sikkerhet | Mislykkede innlogginger per IP og bruker, revisjonslogg og tilgangslogg med filter og CSV, IP-sperring (gjelder hele API-et unntatt `/health`, trer i kraft innen ett minutt). PDF-rapport kommer senere | Fase 1, PR C (laget) |
| Meldinger | Kunngjøringer til alle eller valgte callsentre (tittel, tekst, lenke, periode, av og på), vist som banner for innloggede brukere. Samtaletråder med admin i callsentrene kommer med adminportalen, siden admin trenger et sted å svare | Fase 1, PR D (laget) |
| Vekst | Nøkkeltall, brukere totalt, nye callsentre og innlogginger per måned, med markedsføringshendelser som markører. Samtaler fra fase 2 | Fase 1, PR D (laget) |
| Roller og moduler | Modulkatalogen, standardrollene nye callsentre får, og rettighetskatalogen (lesbar) | Fase 1, PR B (laget) |
| System | Innloggingsmetoder av og på, AI-modell og prompt per funksjon, Soniox-ordliste, kvoter for Bedrock og Soniox | Fase 2 |
| Økonomi | Forbruk per callsenter (lydminutter, AI-tokens, BankID-innlogginger), Stripe, faktura og regnskap (MRR, kostnader, netto) | Forbruk i fase 2, resten i fase 4 |

Fra MedSide tas ikke med: passord og 2FA (vi har bare BankID og Vipps), legespesialiteter og PreVisit-nivåer, og globale roller (roller er per callsenter her).

## 11. Adminportalen for callsentrene

Påbegynt 2. oktober 2026. Admin i et callsenter administrerer sitt eget callsenter på `/administrasjon` i web-appen, med API-et under `/org/*`. Det krever rettigheten `users.manage` i callsenteret, og dermed en økt startet med BankID eller passkey. Alt kjører under RLS i økten sitt callsenter, så databasen avgjør hva som er synlig og nekter å gi bort rettigheter man ikke har.

| Fane | Innhold | Når |
|---|---|---|
| Brukere | Invitere med rolle og team (også personer som er brukere i et annet callsenter), endre rolle og team, deaktivere og aktivere, invitasjoner, CSV. Man kan ikke endre sitt eget medlemskap. Navnet kan bare endres før første innlogging (deretter kommer det fra BankID eller Vipps) | PR E1 (laget) |
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

Påbegynt 2. oktober 2026 (modul 5, 6 og 7), i én PR. Oppsettet følger MedSide-transkripsjonen, med ett unntak: VeriQall lagrer lyden, fordi avspilling og klagedokumentasjon er formålet.

Beslutninger 2. oktober:

- **Opptak i nettleseren.** Selgeren tar opp på `/samtaler/opptak`, med mikrofon eller **fanelyd** (nettbasert telefoni, Teams, Whereby, Zoom o.l. i en nettleserfane, bare Chrome og Edge på PC og Mac). Fanelyden blandes med mikrofonen i nettleseren. Videosporet fra fanedelingen stoppes med en gang, så ingen skjermbilder tas opp. Fanedelingen brukes på nytt ved neste opptak så lenge den er aktiv. Lydfiler kan også lastes opp.
- **To moduser**, valgt av superadmin under System: **sanntid** (standard) gir selgeren tekst mens samtalen pågår, via Soniox i EU med en midlertidig nøkkel (den faste nøkkelen forlater aldri serveren). Faller sanntid ut, fortsetter opptaket uten at selgeren må gjøre noe. **Bitvis** gir bare opptak.
- **Den lagrede transkripsjonen lages alltid fra det lagrede opptaket**, på serveren, etter samtalen. Sanntidsteksten er bare en hjelp for selgeren. Slik kan transkripsjonen ikke endres i nettleseren, og den stemmer med lyden som spilles av.
- **Opptaket lastes opp i biter hvert 15. sekund** mens det pågår, til S3 via kortlevde presignerte URL-er, så lite går tapt om nettleseren stopper. Et opptak som ikke ble avsluttet, kan fullføres fra samtalesiden, og blir behandlet automatisk etter tre timer uten nye biter.
- **Hos Soniox slettes lydfilen og transkripsjonen med en gang teksten er hentet.**
- **Lagringstid** velges av superadmin per callsenter: 3, 6, 9 eller 12 måneder (standard 12). Den gjelder samtaler som opprettes etterpå. En utløpt samtale skjules med en gang (RLS) og slettes med lyd, transkripsjon, AI-kontroll og rapporter av workeren. S3 har i tillegg en livssyklusregel som sletter alt etter 13 måneder og slettede versjoner etter ett døgn.
- **AI-modell** velges av superadmin under System: Claude Sonnet 4.6 (standard), Sonnet 4.5, Opus 4.5 eller Haiku 4.5, alle via Amazon Bedrock med EU-inferensprofiler (`eu.anthropic.*`), så behandlingen skjer bare i EU-regioner. Kallene går fra `eu-north-1` (Converse-API-et).
- **AI-kontroll** med den valgte modellen. Samtalen sjekkes mot malversjonen den er koblet til (via salget, eller produktets gjeldende versjon): hvert obligatoriske punkt (grønn, gul, rød), forbudte formuleringer (rød), pris og vilkår som ikke stemmer, og andre alvorlige forhold. Hvert funn har sitat og tidspunkt i opptaket. Samtalen får det verste flagget. Gule og røde flagg behandles av den som har `flags.review`, med kommentar.
- **Rapport** etter hver samtale etter callsenterets standard rapportmal (`report_templates.manage`), eller VeriQalls standardrapport.
- **Én kanal.** Taler 1 og 2 kommer fra automatisk taleradskillelse og kan bytte plass.

| Del | Innhold |
|---|---|
| Database | `0013_calls.sql`: `calls` (lenker, status, lagringstid, lease for workeren), `transcripts` med norsk fulltekstsøk, `transcript_segments`, `call_analyses`, `report_templates`, `reports`, `usage_events`, `platform_settings`, og rollen `app_worker` (innlogging `veriqall_worker`) med policyer bare på det workeren trenger. Transkripsjoner revideres ikke i `audit_log`, så teksten ikke overlever lagringstiden |
| API | `/org/calls` (opprette, biter, fullføre, prøve igjen, status, vise, spille av, koble, behandle flagg), `/org/report-templates`, `/admin/system`, `/admin/usage`, lagringstid på `/admin/organizations/{id}`, og `modules` i `/me`. Visning og avspilling skrives til `access_log` |
| Worker | `apps/api/src/worker.ts`: setter sammen bitene, transkriberer med Soniox, AI-kontroll og rapport med Claude, sletter utløpte samtaler, fullfører forlatte opptak og plukker opp samtaler som ble hengende (gir opp etter tre forsøk). Startes av API-et for hver samtale, og for opprydding høyst hvert kvarter når appen er i bruk. En fast tidsplan (EventBridge) krever en endring i bootstrap-stacken og kommer før produksjon |
| Web | `/samtaler` (søk i samtalene, flagg, status), `/samtaler/opptak`, `/samtaler/[id]` (avspilling fra hvert tidspunkt, funn, rapport, koblinger), `/samtaler/rapportmaler`, samtaler på kunde- og salgssidene, og superadmin System og Økonomi (forbruk per callsenter) |

Før det virker i staging: Soniox-nøkkelen i `callsenter/staging/app` må komme fra et Soniox-prosjekt i EU-regionen (EU-endepunktene avviser nøkler fra andre regioner; EU bestilles hos Soniox). Claude-modellene som skal kunne velges, må være slått på i Bedrock (Model access) i `eu-north-1`. Modulene Transkribering, AI-kontroll og Rapporter slås på per callsenter under Callsentre.

## 14. Salgsverifisering, dokumentasjon og klager

Bygget 2. oktober 2026 (modul 8, 9 og 10), i én PR. Claude tok beslutningene under alene, og de venter på Nadeems godkjenning.

Beslutninger 2. oktober (til godkjenning):

- **Skriftlig aksept via lenke.** Ved telefonsalg er forbrukeren bare bundet når hen godtar tilbudet skriftlig etter samtalen (angrerettloven § 10). Selgeren lager en lenke på salgssiden (`sales.manage`). Kunden åpner den uten å logge inn, ser tilbudet med pris, binding, angrefrist og vilkår fra malversjonen salget peker på, og **godtar med BankID eller Vipps**, eller avslår (uten identifisering). Salget går til «bekreftet» eller «avvist» av seg selv.
- **Lenken gjelder i 7 dager** og vises bare når den lages (bare hashen lagres). En ny lenke trekker tilbake den forrige. Lenken kan trekkes tilbake fra salgssiden, og trekkes tilbake av seg selv hvis salget kanselleres eller settes til bekreftet for hånd mens det venter.
- **Hemmeligheten står i fragmentet** (`/bekreft#…`), som nettleseren aldri sender til en server. API-et får den som parameter eller i body, så den havner ikke i tilgangsloggen til API Gateway eller Amplify.
- **Godkjenningen er bundet til nettleseren** som åpnet tilbudet: en kortlevd cookie settes når identifiseringen starter og kreves når kunden kommer tilbake. Slik kan ingen sende BankID- eller Vipps-lenken videre til en kunde som ikke har sett tilbudet.
- **Etter at lenken er besvart, trukket tilbake eller utløpt, vises bare status**, ikke selve tilbudet med kundens opplysninger.
- **SMS kommer senere.** Til leverandøren er valgt (seksjon 8), kopierer selgeren lenken og sender den selv på SMS eller e-post. `sent_via` står klar for SMS.
- **Bevis:** dokumentet kunden så, lagres som kanonisk JSON med SHA-256 (dokument-ID), sammen med malversjonen, metode, navn fra BankID eller Vipps, verifisert mobilnummer (Vipps), en hash av innloggings-ID-en (ikke selve ID-en), sikkerhetsnivå, tidspunkt, IP og nettleser. En avgjort bekreftelse kan aldri endres (trigger).
- **Samsvar med kunden:** stemmer Vipps-nummeret med kundens mobilnummer, eller navnet fra BankID eller Vipps med kundens navn, merkes det. Ellers får selgeren beskjed om å sjekke at riktig person har godtatt. Aksepten stoppes ikke, siden en bedrift kan godta ved en annen person enn kontaktpersonen.
- **Identifiseringen gir ingen innlogging.** Den bruker samme OIDC-flyt som innloggingen, men tilstanden er knyttet til bekreftelsen, og ingen økt opprettes. De offentlige sidene går gjennom den smale rollen `app_auth` og to `security definer`-funksjoner.
- **Dokumentasjon per salg** (modul 9) på `/salg/[id]/dokumentasjon`: salget, tilbudet og vilkårene, kundens aksept, samtalene med transkripsjon, AI-kontroll og rapport, og historikken. Kan skrives ut eller lagres som PDF fra nettleseren. Hver visning logges i `access_log`, og hver samtale som vises, logges i tillegg på samtalen.
- **Klager** (modul 10) på `/klager` med `complaints.manage`: kunde, valgfritt salg, kanal, dato, beskrivelse, saksbehandler, status (ny, under behandling, løst, avvist) og utfall, som må fylles ut før saken lukkes. Historikk og notater er append-only. Gjelder klagen et salg, vises salgets dokumentasjon i saken og logges som `complaint_documentation`. Er salget ikke synlig for saksbehandleren (andres salg krever tilgang til alle samtaler og sterk innlogging), vises en melding i stedet.

| Del | Innhold |
|---|---|
| Database | `0014_sale_confirmations.sql` (`sale_confirmations`, `auth_states.confirmation_id`, `app.confirmation_view` og `app.confirmation_decide`) og `0015_complaints.sql` (`complaints`, `complaint_events`) |
| API | `/confirm/*` (offentlig), `/org/sales/{id}/confirmations`, `/org/sales/{id}/documentation` og `/org/complaints` |
| Web | `/bekreft/[token]` og `/bekreft/ferdig` (for kunden), kortet Kundens bekreftelse på salgssiden, `/salg/[id]/dokumentasjon`, `/klager`, `/klager/[id]` og klager på kundesiden |

Modulene Salgsverifisering, Dokumentasjon og Klagehåndtering slås på per callsenter og sjekkes i API-et. «Åpnet» på en lenke betyr at lenken er åpnet, ikke nødvendigvis av kunden (selgeren kan ha åpnet den selv).

Må sjekkes før produksjon: at lenke med BankID- eller Vipps-aksept oppfyller kravet om skriftlig aksept (juridisk vurdering), hvilken tekst bekreftelsessiden skal ha om angreretten (angrerettskjema), og om Vipps Logg inn er godkjent brukt til aksept (Vipps sier selv at Login ikke er en elektronisk ID; BankID er sikrest).

## 15. Dashboard og coaching

Bygget 2. oktober 2026 (modul 11) som fase 4A, oppå fase 3. Claude tok beslutningene alene, og de venter på Nadeems godkjenning. Fakturamodulen (modul 15) kommer i en egen PR (fase 4B).

Beslutninger 2. oktober (til godkjenning):

- **Alle ser sine egne tall.** `/oversikt` viser salg, andel bekreftet, bekreftet verdi per måned, samtaler og timer opptak, AI-flagg (godkjent, avvik, brudd og ubehandlede), klager, utvikling per dag (per uke over 45 dager) og de ti hyppigste avvikene. `dashboard.team` gir teamets tall og en liste over selgerne i teamet, `dashboard.all` hele callsenteret og hvert team.
- **Tallene er antall, ikke innhold.** De kommer fra én `security definer`-funksjon (`app.dashboard`) som sjekker rettighetene selv. En leder ser dermed teamets tall uten å kunne lese samtalene. For å åpne en samtale gjelder fortsatt `calls.read.*`. Salg og samtaler telles i teamet de ble gjort i, som for synlighet. Dager regnes i norsk tid, og perioden er høyst ett år.
- **En teamleder ser en selger bare som del av teamet:** tallene for en selger viser det hen har gjort i lederens team, også etter et teambytte. «Hyppigste avvik» grupperes etter malens obligatoriske punkter og type funn, aldri etter AI-ens egen beskrivelse av samtalen.
- **Tilbakemeldinger** (`coaching.give`) gis til en selger i lederens team, eller til alle med `dashboard.all`, valgfritt knyttet til en samtale (fra samtalesiden). Typen er «Ros» eller «Kan bli bedre». Tilbakemeldingene kan ikke endres eller slettes, men selgeren kan merke dem som lest. Lederen ser når de er lest. Tilbakemeldingen blir stående når samtalen slettes etter lagringstiden, men koblingen fjernes.
- **Ingen AI-generert coaching ennå.** «Hyppigste avvik» bygger på funnene fra AI-kontrollen, og lederen skriver tilbakemeldingen selv. Forslag fra Claude basert på selgerens siste samtaler kan komme senere (krever Bedrock-tilgang for API-Lambdaen).
- **Modulen «Dashboard og coaching»** slås på per callsenter.

| Del | Innhold |
|---|---|
| Database | `0016_dashboard_coaching.sql`: `coaching_notes` med RLS, `app.can_coach` og `app.dashboard` |
| API | `GET /org/dashboard` (`scope` = me, seller, team eller all, `target`, `from`, `to`), `GET`/`POST /org/coaching` og `POST /org/coaching/{id}/read` |
| Web | `/oversikt` (Meg, team og hele callsenteret), `/oversikt/selgere/[id]` og tilbakemelding på samtalesiden |
