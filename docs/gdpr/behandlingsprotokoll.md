# Protokoll over behandlingsaktiviteter: Hi4 Solutions AS

> **Utkast, må gjennomgås av jurist før bruk.** Internt dokument etter GDPR artikkel 30. Sist oppdatert [dato]. Beskriver VeriQall slik den er bygget per 3. oktober 2026.

**Behandlingsansvarlig / databehandler:** Hi4 Solutions AS, organisasjonsnummer [organisasjonsnummer], [adresse].
**Kontaktperson:** Nadeem [etternavn], [e-postadresse], [telefon].
**Personvernombud:** ikke utpekt. [Vurdering etter artikkel 37 må dokumenteres.]

## Del 1: Hi4 Solutions AS som behandlingsansvarlig (artikkel 30 nr. 1)

### 1.1 Kontaktskjema på veriqall.no

| Felt | Innhold |
|---|---|
| Formål | Svare på henvendelser om VeriQall (demo, pris, kundeforhold) |
| Kategorier av registrerte | Besøkende som sender inn skjemaet, normalt ansatte i callsentre |
| Kategorier av opplysninger | Navn, e-postadresse, telefonnummer, firma, melding, språk, IP-adresse, nettleser (user agent), tidspunkt, hvem som behandlet henvendelsen og når |
| Rettsgrunnlag | Artikkel 6 nr. 1 bokstav f (berettiget interesse i å svare på henvendelser). IP-adresse: bokstav f (vern mot misbruk, høyst 10 innsendinger i timen per adresse) |
| Mottakere | Hi4s administratorer (superadmin). E-post til dem via Amazon SES når e-post er satt opp |
| Overføring til tredjeland | Nei. Lagret i AWS `eu-north-1` |
| Lagringstid | [Forslag: slettes når henvendelsen er behandlet, og senest etter 12 måneder. Automatisk sletting er ikke bygget] |
| Sikkerhetstiltak | Se databehandleravtalen vedlegg C. Henvendelsene kan bare leses av superadmin i en BankID- eller passkey-økt, og lesing og behandling logges |
| System | Tabellen `contact_requests`, `POST /contact`, Superadmin → Meldinger → Henvendelser |

### 1.2 Brukerkontoer for Hi4s administratorer (superadmin)

| Felt | Innhold |
|---|---|
| Formål | Drifte plattformen: opprette og følge opp callsentre, brukere, sikkerhet, økonomi og meldinger |
| Kategorier av registrerte | Hi4s ansatte og oppdragstakere med superadmin-tilgang |
| Kategorier av opplysninger | Navn, mobilnummer, e-postadresse, status, innloggingsidentiteter (Vipps/BankID `sub`), passkeys (offentlig nøkkel), økter og innloggingshendelser (tidspunkt, IP-adresse, nettleser, sikkerhetsnivå), revisjonslogg over handlinger, språkvalg |
| Rettsgrunnlag | Artikkel 6 nr. 1 bokstav b (arbeids- eller oppdragsavtale) og f (sikker drift) |
| Mottakere | Idura (BankID) og Vipps MobilePay ved innlogging. AWS som driftsleverandør |
| Overføring til tredjeland | Nei |
| Lagringstid | Så lenge personen har tilgang. Revisjonsloggen beholdes som dokumentasjon [lagringstid må fastsettes]. Midlertidige innloggingsdata slettes etter en time |
| Sikkerhetstiltak | Superadmin-rettigheter gjelder bare i BankID- eller passkey-økter. Minst én superadmin må alltid finnes; ingen kan fjerne egen tilgang. Alle handlinger på tvers av callsentre logges |
| System | `users`, `platform_admins`, `identities`, `passkeys`, `sessions`, `login_events`, `audit_log` |

### 1.3 Kundeforhold og fakturering av callsentrene

| Felt | Innhold |
|---|---|
| Formål | Avtaleinngåelse, fakturering, betalingsoppfølging, regnskap og oppfølging av kundeforholdet |
| Kategorier av registrerte | Kontaktpersoner og administratorer hos callsentrene |
| Kategorier av opplysninger | Firmanavn, organisasjonsnummer, kundenummer, fakturaadresse, faktura-e-post, kontaktpersoners navn, telefon og e-post, avtalte pakker og moduler, prøveperiode og suspensjon, forbruk (samtaler, lydminutter, KI-tokens, innlogginger og kostnad per callsenter), fakturaer, betalinger, kreditnotaer, utsendingslogg for faktura-e-post, meldingstråder mellom callsenterets administrator og Hi4 |
| Rettsgrunnlag | Artikkel 6 nr. 1 bokstav b (avtalen med callsenteret) og c (bokføringsloven) |
| Mottakere | AWS (drift og e-post via SES). [Regnskapsfører, bank, betalingsleverandør når det er avtalt; Stripe er ikke tatt i bruk] |
| Overføring til tredjeland | Nei |
| Lagringstid | Regnskapsmateriale i fem år etter regnskapsårets slutt (bokføringsloven) [må bekreftes]. Øvrige kundeopplysninger så lenge kundeforholdet varer og deretter [frist] |
| Sikkerhetstiltak | Økonomi-fanen krever superadmin i BankID- eller passkey-økt. Sendte fakturaer fryses og kan ikke endres |
| System | `organizations`, `organization_modules`, `usage_events`, fakturatabellene (`0017`, `0019`, `0021`), `invoice_emails`, `support_threads` |

### 1.4 Sikkerhet og drift av plattformen

| Felt | Innhold |
|---|---|
| Formål | Oppdage og stoppe misbruk, feilsøke, dokumentere drift og overholde sikkerhetskrav |
| Kategorier av registrerte | Alle brukere av plattformen og alle som kaller API-et, herunder kunder som åpner en bekreftelseslenke |
| Kategorier av opplysninger | IP-adresse, nettleser, tidspunkt, innloggingsresultat, sperrede IP-adresser, API-logger, databaselogger (pgAudit), skykontoens hendelseslogg (CloudTrail) |
| Rettsgrunnlag | Artikkel 6 nr. 1 bokstav f (berettiget interesse i sikkerhet) og artikkel 32 |
| Mottakere | AWS (CloudWatch, CloudTrail). Alarmer på e-post til Hi4s driftsansvarlige |
| Overføring til tredjeland | Nei |
| Lagringstid | Databaselogg og CloudTrail 365 dager. Innloggingshendelser [må fastsettes]. API- og applikasjonslogger [må fastsettes] |
| Sikkerhetstiltak | Loggene er kryptert med miljøets KMS-nøkkel. CloudTrail-bøtta er låst i 365 dager og kan ikke endres |
| System | `login_events`, `blocked_ips` (`0005_security.sql`), CloudWatch Logs, CloudTrail |

### 1.5 Brukertester i staging

| Felt | Innhold |
|---|---|
| Formål | Teste plattformen før lansering |
| Kategorier av registrerte | Interne testere hos Hi4 |
| Kategorier av opplysninger | Som 1.2, med ekte navn fra BankID og Vipps, siden staging bruker leverandørenes produksjonsmiljø. Testsamtaler med testerens stemme |
| Rettsgrunnlag | Artikkel 6 nr. 1 bokstav f |
| Mottakere | Som 1.2, i tillegg Soniox og Bedrock for testsamtaler |
| Overføring til tredjeland | Nei |
| Lagringstid | Slettes når testen er ferdig, senest etter lagringstiden (12 måneder) |
| Sikkerhetstiltak | Eget miljø med egne nøkler, adskilt fra produksjon |

## Del 2: Hi4 Solutions AS som databehandler (artikkel 30 nr. 2)

Hi4 behandler personopplysninger på vegne av hvert callsenter som bruker VeriQall. Callsenteret er behandlingsansvarlig. Behandlingen er regulert i databehandleravtalen (`databehandleravtale.md`), som også beskriver underdatabehandlerne (vedlegg B) og sikkerhetstiltakene (vedlegg C).

### 2.1 Behandlingsansvarlige

| Behandlingsansvarlig | Organisasjonsnummer | Kontaktperson | Databehandleravtale datert |
|---|---|---|---|
| [Callsenter 1] | [org.nr.] | [navn, e-post] | [dato] |
| … | | | |

*(Listen vedlikeholdes etter hvert som callsentre tas inn. Opplysningene står også i superadminportalen under Callsentre.)*

### 2.2 Kategorier av behandling utført på vegne av callsentrene

| Behandling | Hva som behandles | Underdatabehandlere som er involvert | Lagringstid |
|---|---|---|---|
| Opptak av salgssamtaler i nettleseren (mikrofon og fanelyd) og lagring av lydfilen | Stemmen til selger, kunde og eventuelle tredjepersoner; innholdet i samtalen | AWS (S3) | 3, 6, 9 eller 12 måneder etter callsenterets valg, deretter automatisk sletting |
| Transkripsjon (tale til tekst) | Lydfilen, språkhint; resultatet er tekst med taleradskillelse og tidsstempler | Soniox (EU-endepunkt; lyd og tekst slettes hos Soniox når teksten er hentet), AWS | Som opptaket |
| KI-kontroll mot produktmalen og generering av notater og rapporter | Transkripsjonen, produktmalen, notatmalene; resultatet er flagg, funn med sitat og tidspunkt, notater og rapport på valgt språk | AWS (Bedrock med Claude-modeller, EU-inferensprofiler) | Som opptaket |
| Kunderegister | Navn, fødselsdato, firma, organisasjonsnummer, kontaktperson, telefon, e-post, adresse. Ingen fødselsnumre | AWS (RDS) | Til callsenteret sletter eller avtalen opphører |
| Salg og salgshistorikk | Produkt, pris, bindingstid, angrefrist og vilkår på salgstidspunktet, status, hvem som gjorde hva | AWS | Som kunderegisteret |
| Kundens bekreftelse (tilleggsmodul Salgsverifisering) | Bekreftelseslenke (bare hash lagres), dokumentet kunden så med SHA-256, metode, navn fra BankID eller Vipps, verifisert mobilnummer (Vipps), hash av innloggings-ID, sikkerhetsnivå, tidspunkt, IP-adresse, nettleser. En avgjort bekreftelse kan aldri endres | Idura (BankID), Vipps MobilePay, AWS | Som kunderegisteret |
| Dokumentasjon per salg og klagesaker | Sammenstilling av salg, aksept, samtaler, transkripsjon, KI-kontroll og historikk. Klage med kanal, dato, beskrivelse, saksbehandler, status, utfall, notater | AWS | Som kunderegisteret |
| Brukeradministrasjon | Ansattes navn, mobilnummer, e-post, status, team, rolle, rettigheter, invitasjoner | AWS, SES (invitasjons-e-post) | Så lenge personen har tilgang, deretter som dokumentasjon til avtalen opphører |
| Innlogging og økter for callsenterets brukere | Innloggingsidentiteter (Vipps/BankID `sub`), passkeys, økter og innloggingshendelser med IP-adresse og nettleser | Idura, Vipps MobilePay, AWS | Økter til utløp; innloggingshendelser [må fastsettes] |
| Dashboard og coaching | Tall per selger, team og callsenter (samtaler, salg, bekreftelser, flagg, utvikling, sammenligning med teamets snitt), tilbakemeldinger fra leder, lest-status | AWS | Tallene beregnes fra samtaler og salg. Tilbakemeldinger beholdes til avtalen opphører |
| Revisjonslogg og tilgangslogg | Hvem som har gjort hvilke endringer, og hvem som har åpnet, spilt av eller søkt i opptak og transkripsjoner, med tidspunkt | AWS | Append-only, beholdes til avtalen opphører |
| Fakturaer til callsenteret vist i Administrasjon | Fakturaer, forfall, betaling | AWS | Som 1.3 |
| Søk | Fulltekstsøk i transkripsjoner på alle språk, søk på kunder, salg og samtalereferanser | AWS | Ingen egen lagring |

### 2.3 Overføring til tredjeland

Ingen planlagt. All lagring og behandling skjer i AWS-regionen `eu-north-1` (Stockholm), Bedrock bruker EU-inferensprofiler, og Soniox nås via EU-endepunktet. [Soniox' juridiske enhet og eventuelt overføringsgrunnlag må verifiseres. AWS' fjerntilgang fra tredjeland er dekket av AWS GDPR Data Processing Addendum.]

### 2.4 Generell beskrivelse av sikkerhetstiltakene

Se databehandleravtalen vedlegg C: kryptering i hvile (KMS) og i transitt (TLS), privat nettverk, radnivåsikkerhet per callsenter, innlogging med Vipps, BankID og passkey uten passord, BankID- eller passkey-krav for administrativ tilgang, økter på 60 minutter uten aktivitet og høyst 14 timer, kortlevde presignerte URL-er for lyd, append-only revisjons- og tilgangslogg, uforanderlige bevis for kundens aksept, point-in-time recovery, CloudTrail, pgAudit, alarmer, infrastruktur som kode og godkjent deploy til produksjon.

## Del 3: Vedlikehold

Protokollen oppdateres når en behandling, en underdatabehandler, en lagringstid eller et sikkerhetstiltak endres, og minst årlig. Endringer i plattformen som påvirker protokollen, skal nevnes i pull requesten som gjør endringen.

| Dato | Endring | Av |
|---|---|---|
| 3. oktober 2026 | Første utkast | [navn] |
