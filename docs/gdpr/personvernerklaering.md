# Personvernerklæring for VeriQall

> **Utkast, må gjennomgås av jurist før bruk.** Sist endret [dato]. Alt i hakeparenteser må fylles ut.

Denne erklæringen forklarer hvordan personopplysninger behandles på nettstedet veriqall.no og i VeriQall-appen. VeriQall er en plattform for callsentre som selger på telefon: samtalene tas opp og transkriberes, en KI-modell sjekker samtalen mot produktmalen, kunden kan bekrefte kjøpet digitalt, og alt samles som dokumentasjon for oppfølging, klager og coaching.

## 1. Hvem som er ansvarlig

Ansvaret er delt, og det avhenger av hvilke opplysninger det gjelder.

### Hi4 Solutions AS er behandlingsansvarlig for

- nettstedet veriqall.no og kontaktskjemaet der,
- brukerkontoene til våre egne administratorer (superadmin),
- kundeforholdet til callsentrene: kontaktpersoner, avtaler, fakturaer og betaling,
- driftsdata som er nødvendige for å holde plattformen sikker (innloggingslogg, sikkerhetslogger, sperring av IP-adresser).

Hi4 Solutions AS, organisasjonsnummer [organisasjonsnummer], [postadresse]. E-post for personvernhenvendelser: [e-postadresse].

### Callsenteret er behandlingsansvarlig for sine data

Hvert callsenter som bruker VeriQall, er behandlingsansvarlig for opplysningene om sine egne kunder og ansatte: samtaleopptak, transkripsjoner, KI-kontroller og notater, kunder, salg, kundens bekreftelse, klagesaker, tilbakemeldinger til selgere og tallene på dashboardet. Hi4 Solutions AS behandler disse opplysningene bare på vegne av callsenteret og etter dets instruks, som databehandler, i henhold til en databehandleravtale.

Er du kunde av et callsenter, eller ansatt i et, skal du henvende deg til callsenteret om rettighetene dine. Callsenteret har ansvar for å informere deg om at samtalen tas opp, og for grunnlaget for opptaket. Vi hjelper callsenteret med å finne og levere opplysningene dine når det ber om det.

## 2. Hvilke opplysninger som behandles, og hvorfor

### 2.1 Besøkende på veriqall.no

Nettstedet bruker ingen analyse- eller markedsføringsverktøy og setter ingen sporingskapsler. Det som behandles, er det som trengs for å vise siden (IP-adresse og nettleserinformasjon i tjenerloggene hos vår leverandør) og det du selv skriver i kontaktskjemaet.

**Kontaktskjemaet** lagrer navn, e-postadresse, telefonnummer (valgfritt), firma (valgfritt), meldingen, språket du skrev på, IP-adressen og nettleserinformasjon. IP-adressen brukes til å stoppe automatiserte innsendinger (høyst 10 i timen per adresse). Henvendelsen sendes på e-post til våre administratorer og vises for dem i plattformen til den er behandlet.

- Formål: svare på henvendelsen din og avtale en demo eller et kundeforhold.
- Rettsgrunnlag: berettiget interesse i å svare på henvendelser vi mottar (GDPR artikkel 6 nr. 1 bokstav f), og hvis henvendelsen fører til et kundeforhold, avtalen (bokstav b).
- Lagringstid: slettes når henvendelsen er behandlet, og senest etter [12 måneder]. *(Forslag; automatisk sletting er ikke bygget ennå.)*

### 2.2 Brukere i et callsenter (selgere, ledere, compliance og administratorer)

Callsenteret oppretter deg som bruker og er behandlingsansvarlig. Dette behandles om deg:

| Opplysninger | Hvorfor |
|---|---|
| Navn, mobilnummer, e-postadresse, status, callsenter, team og rolle | Opprette og styre tilgangen din. Mobilnummeret brukes også til å koble første Vipps-innlogging til invitasjonen |
| Innloggingsidentiteter: leverandør (Vipps eller BankID) og leverandørens identifikator (`sub`), eventuelle passkeys (bare den offentlige nøkkelen) | Logge deg inn uten passord. Fødselsnummer hentes ikke fra BankID og lagres ikke; hvis det en gang blir nødvendig, lagres bare en nøkkelbasert hash (HMAC), aldri selve nummeret |
| Innloggingshendelser: tidspunkt, leverandør, resultat, IP-adresse og nettleser | Sikkerhet, oppdage misbruk og følge kostnaden per innlogging |
| Økter: tidspunkter, sikkerhetsnivå, IP-adresse og nettleser | Holde deg innlogget. En økt utløper etter 60 minutter uten aktivitet og senest etter 14 timer |
| Opptak av samtalene du fører, transkripsjonen av dem, KI-kontrollen og notatene | Dokumentere salget. Opptaket inneholder stemmen din og det du sier |
| Tall om arbeidet ditt: samtaler, salg, andel bekreftet, flagg fra KI-kontrollen, utvikling over tid, sammenligning med teamets snitt | Dashboard for deg selv og dine ledere, og oppfølging (coaching) |
| Tilbakemeldinger fra leder («Ros» eller «Kan bli bedre»), og om du har lest dem | Coaching |
| Hendelser du utfører i plattformen (revisjonslogg) og hver gang du åpner, spiller av eller søker i et opptak eller en transkripsjon (tilgangslogg) | Sporbarhet, slik at callsenteret kan vise hvem som har gjort hva og hvem som har hørt på en samtale |
| Språkvalg | Vise plattformen på ditt språk |

- Formål og rettsgrunnlag fastsettes av callsenteret, som er behandlingsansvarlig. Normalt vil grunnlaget være arbeidsavtalen og callsenterets berettigede interesse i å dokumentere salg, behandle klager og sikre kvalitet (artikkel 6 nr. 1 bokstav b og f). Callsenteret må vurdere dette selv, og opptak av ansattes samtaler er et kontrolltiltak som skal drøftes med og informeres om til de ansatte etter arbeidsmiljøloven.
- Lagringstid: brukeropplysninger så lenge du har tilgang, og deretter så lenge callsenteret trenger dem for dokumentasjon. Samtaleopptak, transkripsjoner, KI-kontroller og notater slettes automatisk etter 3, 6, 9 eller 12 måneder, slik callsenteret har valgt. Revisjonsloggen og tilgangsloggen beholdes som dokumentasjon, men inneholder ikke teksten i samtalene.

### 2.3 Kunder av et callsenter

Callsenteret registrerer sine kunder i VeriQall og er behandlingsansvarlig. Dette kan behandles om deg som kunde:

| Opplysninger | Hvorfor |
|---|---|
| Navn og fødselsdato (privatperson), eller firmanavn, organisasjonsnummer og kontaktperson (bedrift), telefonnummer, e-postadresse og postadresse | Kundeforholdet og salget. **Fødselsnummer registreres ikke** |
| Salg: produkt, pris, bindingstid, angrefrist og vilkår slik de var da salget ble gjort, status og historikk | Dokumentere hva som ble tilbudt og akseptert |
| Opptak av salgssamtalen, transkripsjonen og KI-kontrollen | Dokumentere hva som faktisk ble sagt. Opptaket inneholder stemmen din |
| Din bekreftelse av tilbudet (hvis callsenteret bruker denne modulen): dokumentet du så, metode (BankID eller Vipps), navnet fra e-ID-en, verifisert mobilnummer (ved Vipps), en hash av innloggings-ID-en, sikkerhetsnivå, tidspunkt, IP-adresse og nettleser | Bevis for at du godtok tilbudet skriftlig. En avgjort bekreftelse kan aldri endres |
| Klagesaker: kanal, dato, beskrivelse, saksbehandler, status, utfall og dokumentasjon | Behandle klagen din |

- Formål og rettsgrunnlag fastsettes av callsenteret. Normalt vil det være avtalen med deg (artikkel 6 nr. 1 bokstav b), callsenterets berettigede interesse i å dokumentere og kunne forsvare salget (bokstav f) og rettslige forpliktelser ved telefonsalg og klager (bokstav c). Callsenteret er ansvarlig for å informere deg om at samtalen tas opp, og for grunnlaget for opptaket.
- Lagringstid: opptak, transkripsjon og KI-kontroll slettes automatisk etter 3, 6, 9 eller 12 måneder etter callsenterets valg. Kunde-, salgs-, bekreftelses- og klageopplysninger beholdes så lenge callsenteret trenger dem som dokumentasjon, og lagringstiden fastsettes av callsenteret.

Når du godtar et tilbud via lenke, identifiserer du deg med BankID (via Idura) eller Vipps. Da behandler også BankID-utstederen, Idura og Vipps MobilePay opplysninger om deg, etter sine egne vilkår. Identifiseringen oppretter ingen brukerkonto og ingen innlogging i VeriQall.

### 2.4 Administratorer hos Hi4 Solutions AS (superadmin)

Våre egne administratorer har brukerkonto på samme vilkår som brukere i callsentrene (punkt 2.2, unntatt samtaler og dashboardtall). Administrativ tilgang krever innlogging med BankID eller passkey, og alle handlinger på tvers av callsentre logges. Rettsgrunnlag: berettiget interesse i å drifte plattformen sikkert (artikkel 6 nr. 1 bokstav f) og arbeids- eller oppdragsavtalen (bokstav b).

### 2.5 Kontaktpersoner og fakturering hos callsentrene

Om callsenteret som kunde lagrer vi firmanavn, organisasjonsnummer, kundenummer, fakturaadresse, faktura-e-post, avtalte pakker og moduler, forbruk, fakturaer, betalinger og kreditnotaer. Fakturaer sendes på e-post til faktura-e-posten, og hver utsending logges.

- Rettsgrunnlag: avtalen med callsenteret (artikkel 6 nr. 1 bokstav b) og bokføringsloven (bokstav c).
- Lagringstid: regnskapsmateriale oppbevares i fem år etter regnskapsårets slutt, slik bokføringsloven krever. *(Må bekreftes av jurist eller regnskapsfører.)*

### 2.6 Sikkerhet og drift

For å beskytte plattformen behandler vi IP-adresser og nettleserinformasjon i innloggingsloggen, i API-loggene og i sikkerhetsloggene i skyen. Gjentatte mislykkede innlogginger kan føre til at en IP-adresse sperres. Rettsgrunnlag: berettiget interesse i sikkerhet (artikkel 6 nr. 1 bokstav f). Driftslogger beholdes i inntil [365 dager]. *(Databaseloggen har 365 dagers lagringstid; lagringstiden for API- og applikasjonslogger må bekreftes og settes.)*

## 3. Hvor opplysningene lagres og hvem som får dem

Vi selger ikke opplysninger og deler dem ikke med andre enn leverandørene som er nødvendige for å levere tjenesten. Alle leverandørene behandler opplysninger på våre vegne etter avtale.

| Leverandør | Hva | Hvor |
|---|---|---|
| Amazon Web Services EMEA SARL (AWS) | Drift av hele plattformen: database (PostgreSQL på RDS), lagring av lydfiler (S3), applikasjonskjøring (Lambda), nettsted (Amplify), e-post (SES), logger og alarmer | Region `eu-north-1` (Stockholm, Sverige). Alt er kryptert i hvile med egne nøkler og i transitt med TLS |
| AWS, Amazon Bedrock | KI-kontroll og notater med Claude-modeller. Transkripsjonen og produktmalen sendes til modellen; svaret lagres i databasen. Modellen trenes ikke på dataene | Kallene går fra `eu-north-1` med EU-inferensprofiler, slik at behandlingen bare skjer i EU-regioner |
| Soniox | Tale til tekst. Lydfilen sendes til Soniox' EU-endepunkt, og lydfilen og transkripsjonen slettes hos Soniox så snart teksten er hentet | EU. *(Hvilken juridisk enhet som er avtalepart, og om det skjer en overføring til et tredjeland, må verifiseres før lansering.)* |
| Idura | Innlogging og identifisering med BankID (OIDC). Vi mottar navn og en identifikator, ikke fødselsnummer | Norge |
| Vipps MobilePay AS | Innlogging og identifisering med Vipps (OIDC). Vi mottar navn, verifisert mobilnummer og en identifikator | Norge |

Opplysningene lagres i EU/EØS. Skulle en leverandør overføre opplysninger til et land utenfor EU/EØS, skjer det bare med et gyldig overføringsgrunnlag etter GDPR kapittel V, og vi oppdaterer denne erklæringen.

Vi kan også utlevere opplysninger når loven krever det, for eksempel til Datatilsynet eller domstolene.

## 4. Informasjonskapsler og lokal lagring

VeriQall bruker bare informasjonskapsler som er nødvendige for at tjenesten skal virke: en øktkapsel når du er innlogget, en kortlevd kapsel mens du logger inn, en kapsel for språkvalg, og en kortlevd kapsel mens en kunde bekrefter et tilbud. Fargetema og noen visningsvalg huskes i nettleserens lokale lagring. Ingen analyse- eller markedsføringskapsler brukes. Se den fullstendige oversikten i [informasjonskapsler.md](informasjonskapsler.md).

## 5. Automatiserte vurderinger

KI-kontrollen sammenligner transkripsjonen av en salgssamtale med produktmalen og setter et flagg (grønt, gult eller rødt) med funn, sitat og tidspunkt. Gule og røde flagg vurderes av en person i callsenteret før de får konsekvenser. KI-en treffer ingen avgjørelser om kunden eller selgeren på egen hånd; den er et hjelpemiddel for den som behandler flaggene. Callsenteret er ansvarlig for hvordan resultatene brukes overfor de ansatte.

## 6. Dine rettigheter

Du har rett til innsyn i opplysningene om deg, til å få rettet uriktige opplysninger, til sletting, til begrensning av behandlingen, til å protestere mot behandling som bygger på berettiget interesse, og til å få utlevert opplysninger du selv har gitt i et maskinlesbart format (dataportabilitet). Rettighetene har unntak, for eksempel når opplysningene må beholdes som dokumentasjon av et salg eller etter bokføringsloven.

- Gjelder det kontaktskjemaet, nettstedet eller kundeforholdet til Hi4 Solutions AS, kontakt oss på [e-postadresse].
- Gjelder det opplysninger et callsenter har registrert (du er kunde eller ansatt i callsenteret), kontakt callsenteret. Vi hjelper callsenteret med å finne opplysningene.

Du kan klage til Datatilsynet (datatilsynet.no) hvis du mener vi behandler opplysningene dine i strid med loven. Vi ber om at du kontakter oss først, så vi kan rette opp.

## 7. Sikkerhet

- Alle data er kryptert i hvile med egne krypteringsnøkler per miljø og i transitt med TLS. Databasen godtar bare krypterte forbindelser, og lagringen godtar bare kryptert trafikk.
- Hvert callsenter ser bare sine egne data. Skillet er håndhevet i databasen (radnivåsikkerhet), ikke bare i applikasjonen.
- Ingen passord. Innlogging med Vipps, BankID eller passkey. Administrativ tilgang, tilgang til alle samtaler og til loggene krever innlogging med BankID eller passkey.
- Lydfiler nås bare gjennom kortlevde, signerte lenker.
- Alle endringer skrives til en revisjonslogg som ikke kan endres eller slettes, og hver visning eller avspilling av opptak og transkripsjon skrives til en tilgangslogg.
- Kundens bekreftelse lagres med en kryptografisk sjekksum av dokumentet og kan aldri endres når den er avgjort.
- Databasen har kontinuerlig sikkerhetskopiering (point-in-time recovery), og alle handlinger i skykontoen logges i en låst revisjonslogg.
- Ved et brudd på personopplysningssikkerheten varsler vi berørte callsentre uten ugrunnet opphold og senest innen 48 timer etter at vi ble kjent med det, og Datatilsynet innen 72 timer når loven krever det.

## 8. Endringer

Vi oppdaterer erklæringen når tjenesten eller leverandørene endres. Datoen øverst viser siste endring. Vesentlige endringer varsles til callsentrene.

## 9. Kontakt

Hi4 Solutions AS
[postadresse]
[e-postadresse for personvernhenvendelser]
Organisasjonsnummer [organisasjonsnummer]
