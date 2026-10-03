# Informasjonskapsler og lokal lagring i VeriQall

> **Utkast, må gjennomgås av jurist før bruk.** Sist endret [dato]. Beskriver nettstedet og appen slik de er bygget per 3. oktober 2026.

VeriQall bruker bare informasjonskapsler (cookies) og lokal lagring som er nødvendige for at tjenesten skal virke. Det finnes ingen analyse-, sporings- eller markedsføringskapsler, og ingen tredjeparter setter kapsler på våre sider. Nødvendige kapsler krever ikke samtykke etter ekomloven § 3-15, men vi informerer om dem her.

## Informasjonskapsler

| Navn | Settes av | Formål | Levetid | Innhold | Nødvendig |
|---|---|---|---|---|---|
| `vq_session` | API-domenet (`api.veriqall.no`, i staging `api.staging.veriqall.no`) når du logger inn | Holder deg innlogget. Sendes med hvert kall til API-et | Inntil 14 timer. Økten utløper også på serveren etter 60 minutter uten aktivitet, og slettes når du logger ut eller en administrator logger deg ut | En tilfeldig økt-ID. Bare en hash av den lagres på serveren. `HttpOnly`, `Secure`, `SameSite=Lax` | Ja |
| `vq_login` | API-domenet når du starter innlogging med Vipps eller BankID | Binder innloggingen til nettleseren som startet den, så ingen kan logge deg inn via en lenke de har laget selv (vern mot innloggings-CSRF) | 15 minutter | En tilfeldig verdi. Bare en hash lagres på serveren. `HttpOnly`, `Secure`, `SameSite=Lax` | Ja |
| `vq_confirm` | API-domenet når en kunde starter identifisering med BankID eller Vipps på en bekreftelseslenke | Binder godkjenningen til nettleseren som åpnet tilbudet, så lenken til BankID eller Vipps ikke kan sendes videre til en som ikke har sett tilbudet | 15 minutter | En tilfeldig verdi. Bare en hash lagres på serveren. `HttpOnly`, `Secure`, `SameSite=Lax` | Ja |
| `vq_locale` | Web-domenet (`veriqall.no`, i staging `staging.veriqall.no`) når du velger språk | Viser sidene på språket du har valgt (norsk, engelsk, svensk, dansk eller tysk) med en gang, uten språk i adressen | 1 år | Språkkoden, for eksempel `nb` | Ja (funksjonell) |

Ingen av kapslene inneholder navn, e-post eller andre opplysninger som identifiserer deg direkte. Økt-ID-en i `vq_session` knytter nettleseren til brukerkontoen din på serveren så lenge du er innlogget.

## Lokal lagring i nettleseren (`localStorage`)

Lokal lagring ligger bare i din egen nettleser, sendes aldri til serveren og kan slettes av deg når som helst (slett nettstedsdata i nettleseren). Verdiene blir liggende til du sletter dem.

| Nøkkel | Formål | Innhold |
|---|---|---|
| `veriqall-theme` | Husker fargetemaet du har valgt: system, lyst eller mørkt | `system`, `light` eller `dark` |
| `veriqall-dismissed-announcements` | Husker hvilke kunngjøringer fra Hi4 du har lukket, så de ikke vises igjen | ID-ene til kunngjøringene |
| `veriqall.periode` | Husker perioden du sist valgte på dashboardet (i dag, denne uken, …) | Periodevalget |
| `veriqall.oversikt.niva` | Husker hvilken fane du sist så på dashboardet (Meg, Teamet, Callsenteret eller Kvalitet) | Fanens navn |
| `veriqall.okonomi` | Husker hvilken underfane du sist brukte under Økonomi (bare for Hi4s administratorer) | Underfanens navn |
| `veriqall.studio.languages` | Husker språkene du sist valgte for samtalen i Samtalestudio | Språkkoder |

## Det som ikke brukes

- Ingen analyseverktøy (Google Analytics eller tilsvarende).
- Ingen markedsførings- eller sporingskapsler, og ingen deling med annonsenettverk.
- Ingen kapsler fra tredjeparter på våre sider. Når du logger inn eller bekrefter et tilbud, sendes du til Vipps eller BankID (via Idura) på deres egne domener, og de kan sette egne kapsler der etter sine vilkår. Det skjer utenfor VeriQall.
- Skriften er selvhostet, så ingen skriftleverandør får vite at du besøker siden.

## Slik styrer du dette

Du kan slette eller blokkere informasjonskapsler i nettleserens innstillinger. Blokkerer du `vq_session`, kan du ikke logge inn. Blokkerer du `vq_locale`, vises sidene på callsenterets standardspråk eller nettleserens språk. Lokal lagring kan slettes under nettstedsdata i nettleseren; da går valgene tilbake til standard.

## Kontakt

Spørsmål om informasjonskapsler og personvern: Hi4 Solutions AS, [e-postadresse]. Se også [personvernerklæringen](personvernerklaering.md).
