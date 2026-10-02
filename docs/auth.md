# Innlogging i VeriQall: Vipps og BankID på AWS

Gjelder fase 0, PR 3. Beslutninger som fortsatt er åpne står nederst.

## Mål

- Ingen passord. Brukere logger inn med Vipps Logg inn eller BankID via Idura.
- Brukere opprettes av admin med invitasjon. Det finnes ingen selvregistrering.
- Hele OIDC-flyten skjer på serveren. Nettleseren ser aldri koder eller tokens, bare en httpOnly-cookie.

## Flyten, likt for begge leverandører

1. Brukeren trykker «Logg inn med Vipps» eller «Logg inn med BankID». Nettleseren går til `GET /auth/{vipps|bankid}/start` på API-et (API Gateway og Lambda), eventuelt med `?invite=<token>` og `?next=<relativ sti>`.
2. Lambdaen lager `state`, `nonce` og en PKCE-verifier, lagrer dem i `auth_states` med tidspunkt, og svarer med 302 til leverandørens autorisasjons-URL.
3. Leverandøren sender brukeren tilbake til `GET /auth/{provider}/callback?code=…&state=…` på API-et. Redirect-URI-en er fast per miljø og registrert hos leverandøren, tegn for tegn.
4. `state` må finnes, være ubrukt og yngre enn 10 minutter. Den merkes som brukt før koden veksles, så den ikke kan brukes to ganger.
5. Koden veksles mot tokens på serveren.
6. Identiteten valideres og kobles til en bruker, som beskrevet under.
7. Lambdaen oppretter en økt, setter cookien og svarer med 302 til `next`. Bare relative stier godtas, så ingen kan sende brukeren videre til et annet nettsted.
8. Avbryter brukeren hos leverandøren, kommer hun tilbake med `error` i stedet for `code`. Da vises en forståelig melding på innloggingssiden, ikke en tom side.

## BankID via Idura

- Autorisasjon: `https://{IDURA_DOMAIN}/oauth2/authorize` med `response_type=code`, `scope=openid`, `acr_values=urn:grn:authn:no:bankid`, `state`, `nonce` og `code_challenge` (S256).
- Token: `POST https://{IDURA_DOMAIN}/oauth2/token` med `code`, samme `redirect_uri`, `code_verifier` og klientautentisering.
- Id-tokenet valideres fullt ut: signatur mot leverandørens JWKS, `iss`, `aud` (lik client_id), `exp`, og `nonce` lik den lagrede. Mangler `nonce`, avvises innloggingen.
- Fødselsnummer hentes ikke (ingen `ssn`-scope). `sub` er nøkkelen. Trengs fødselsnummer senere, lagres det bare som HMAC med en hemmelig nøkkel, aldri i klartekst og aldri som del av lagrede claims.
- Rå claims lagres ikke. Bare feltene vi trenger (navn og `sub`) hentes ut.

## Vipps Logg inn

- Vert per miljø: `https://apitest.vipps.no` for staging og `https://api.vipps.no` for produksjon. Verten er en miljøvariabel.
- Autorisasjon: `{VIPPS_HOST}/access-management-1.0/access/oauth2/auth` med `scope=openid name phoneNumber`. Be ikke om mer enn dette, for brukeren må godta hele lista.
- Token: `POST {VIPPS_HOST}/access-management-1.0/access/oauth2/token` med Basic-autentisering (client_id og client_secret) og `Ocp-Apim-Subscription-Key`.
- Profildata: `GET {VIPPS_HOST}/vipps-userinfo-api/userinfo` med en gang, siden tokenet bare varer i ti minutter. Skriv koden så den tåler både `phone_number` og `phoneNumber`.
- Vipps gir ikke fødselsnummer i Norge og er ikke en elektronisk ID. Nøkkelen er `sub`, som er stabil per bruker per salgsenhet (MSN). Mobilnummer brukes bare til å koble en invitert bruker første gang, siden et nummer kan bytte eier.
- Bruk Vipps' egne knapper. Egendesignede knapper er ikke tillatt.

## Kobling til bruker

- Admin oppretter brukeren med navn, mobilnummer, e-post, rolle og callsenter. `identities` (user_id, provider, sub) kobler innloggingsmetodene til brukeren.
- Senere innlogginger slås opp på `(provider, sub)`.
- Første innlogging:
  - Med Vipps kobles brukeren automatisk når det verifiserte mobilnummeret matcher en invitert bruker som ikke har Vipps-kobling ennå.
  - Med BankID, og med Vipps fra en invitasjonslenke, bæres invitasjonen gjennom `auth_states`. Lenken inneholder et engangstoken på SMS eller e-post og utløper etter 72 timer.
- En innlogget bruker kan legge til den andre metoden fra profilen sin.
- En ukjent identitet uten invitasjon avvises med beskjed om å kontakte admin. Brukere opprettes aldri automatisk.
- Superadmin opprettes med et eget skript og kobles med BankID.

## Økt

- Tabellen `sessions` har id-hash, user_id, provider, opprettet, sist sett, utløper, IP og user agent. Selve økt-ID-en er 32 tilfeldige byte, og bare SHA-256 av den lagres.
- Cookien heter `vq_session` og settes med `HttpOnly; Secure; SameSite=Lax; Path=/`. Appen kaller API-et med credentials, og CORS tillater bare appens egen origin.
- Bruk egne domener også i staging, for eksempel `staging.veriqall.no` og `api.staging.veriqall.no`. Med standarddomenene til Amplify og API Gateway blir app og API ulike nettsteder, og nettleseren blokkerer da cookien.
- Forslag til tidsavbrudd: 30 minutter uten aktivitet og maks 12 timer totalt.
- Utlogging sletter økten. Admin kan logge en bruker ut av alle økter.
- API-et sjekker økten i hvert kall, i en Lambda-autoriserer eller felles mellomvare, og setter `app.current_user_id` og `app.current_org_id` for RLS.

## Logging

- Hver innlogging, både vellykkede og mislykkede, skrives til `login_events` med leverandør, resultat, bruker, IP og user agent. Den gir også grunnlag for å følge kostnaden per BankID-innlogging hos Idura.
- Koder, tokens og innholdet i userinfo logges aldri. Ved feil logges bare statuskode, svarkropp fra leverandøren og hvilke felt som kom.

## Hemmeligheter og oppsett per miljø

- Secrets Manager: `IDURA_CLIENT_ID`, `IDURA_CLIENT_SECRET`, `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN`.
- Konfigurasjon (ikke hemmelig): `IDURA_DOMAIN`, `VIPPS_HOST`, `APP_ORIGIN` og `AUTH_CALLBACK_BASE`.
- Staging har egen Idura-applikasjon og Vipps' testmiljø med egen salgsenhet, egne testbrukere og egne redirect-URI-er.
- Hos Vipps må salgsenheten være satt opp for innlogging i portal.vippsmobilepay.com. Det er ikke på som standard.

## Nettverk

Callback-Lambdaen må nå både internett (Idura og Vipps) og databasen. Det er det tydeligste eksempelet på det åpne valget mellom NAT Gateway og Aurora Serverless v2 med Data API (se `plan.md`, seksjon 8).

## Åpne beslutninger

- Skal admin og compliance kreve BankID, siden Vipps ikke er en elektronisk ID, mens selgere også kan bruke Vipps?
- Tidsavbrudd for økter.

## Tillegg fra gjennomgangen 2. oktober 2026

- **Nettverk er avgjort:** Lambdaene ligger i VPC, med NAT-instans i staging og NAT Gateway i produksjon (se `plan.md`, seksjon 3 og 9). Innloggingen er én Lambda.
- **Egen databaserolle for innloggingen:** før innlogging finnes verken bruker eller callsenter å sette for RLS. Innloggings-Lambdaen bruker derfor rollen `app_auth`, som bare når `auth_states`, `invitations`, `identities`, `sessions`, `login_events` og det den må lese i `users`. Resten av API-et bruker `app_user`, som er underlagt RLS.
- **`state` lagres som hash**, på samme måte som økt-ID og invitasjonstoken. Nonce og PKCE-verifier må lagres slik de er, fordi de skal sendes videre.
- **Automatisk Vipps-kobling** via mobilnummer krever også at invitasjonen ikke er utløpt eller trukket tilbake.
- **`acr` lagres på økten.** Forslag til BankID-kravet: knytt det til rettigheter, ikke rollenavn. Rettighetene `audit.read`, `users.manage`, `roles.manage` og `calls.read.all` krever en økt startet med BankID.
- **Sist sett** oppdateres høyst én gang i minuttet, så hvert kall ikke gir en skriving.
- **Rate limiting** på `/auth/*` i API Gateway, og sjekk av `Origin` på kall som endrer data, siden `SameSite=Lax` ikke dekker alt.
