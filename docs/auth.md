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
- Tidsavbrudd (besluttet 2. oktober 2026): 60 minutter uten aktivitet og maks 14 timer totalt.
- Utlogging sletter økten. Admin kan logge en bruker ut av alle økter.
- API-et sjekker økten i hvert kall, i en Lambda-autoriserer eller felles mellomvare, og setter `app.current_user_id` og `app.current_org_id` for RLS.

## Logging

- Hver innlogging, både vellykkede og mislykkede, skrives til `login_events` med leverandør, resultat, bruker, IP og user agent. Den gir også grunnlag for å følge kostnaden per BankID-innlogging hos Idura.
- Koder, tokens og innholdet i userinfo logges aldri. Ved feil logges bare statuskode, svarkropp fra leverandøren og hvilke felt som kom.

## Hemmeligheter og oppsett per miljø

- Secrets Manager: `IDURA_CLIENT_ID`, `IDURA_CLIENT_SECRET`, `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN`.
- Konfigurasjon (ikke hemmelig): `IDURA_DOMAIN`, `VIPPS_HOST`, `APP_ORIGIN` og `AUTH_CALLBACK_BASE`.
- Staging har egen Idura-applikasjon og Vipps' testmiljø med egen salgsenhet, egne testbrukere og egne redirect-URI-er.
- Redirect-URI-ene i staging er `https://api.staging.veriqall.no/auth/vipps/callback` og `https://api.staging.veriqall.no/auth/bankid/callback`.
- Hos Vipps må salgsenheten være satt opp for innlogging i portal.vippsmobilepay.com. Det er ikke på som standard.

## Nettverk

Callback-Lambdaen må nå både internett (Idura og Vipps) og databasen. Det er det tydeligste eksempelet på det åpne valget mellom NAT Gateway og Aurora Serverless v2 med Data API (se `plan.md`, seksjon 8).

## Beslutninger (2. oktober 2026)

- **BankID kreves for administrativ tilgang.** Rettighetene `audit.read` (revisjons- og tilgangslogg), `users.manage` (brukere, ansatte og team), `roles.manage` (roller og rettigheter), `calls.read.all` (alle samtaler i callsenteret) og `billing.read` (fakturaer) gjelder bare i en økt startet med BankID. En økt startet med Vipps har de andre rettighetene i rollen, men ikke disse. Kravet er knyttet til rettigheter, ikke rollenavn, og listen ligger i `STRONG_AUTH_PERMISSIONS` i `packages/shared`.
- **Tidsavbrudd:** 60 minutter uten aktivitet og maks 14 timer totalt.
- **Ekte BankID i staging:** staging-applikasjonen ligger i Iduras produksjonsmiljø, så vi kan teste med egen BankID i stedet for testbrukere. Staging lagrer da ekte navn på interne testere (ikke fødselsnummer, som aldri hentes). Hver innlogging koster etter Iduras pris.
- **Ekte Vipps i staging:** Vipps' testmiljø krever test-appen Vipps MT, så staging bruker også Vipps' produksjonsmiljø (`api.vipps.no`) med nøkler fra en salgsenhet der. Testmiljøet kan tas i bruk igjen ved å sette verten i `infra/deploy.sh`.
- **Superadmins:** den første opprettes via migrator-Lambdaen (`invite-platform-admin`, se `infra/README.md`). Fra 2. oktober kan en superadmin også gi og fjerne superadmin i portalen (fanen Brukere, migrasjon `0004_superadmin_users.sql`), bare i en BankID-økt. Ingen kan fjerne sin egen tilgang, og det må alltid finnes minst én superadmin. Invitasjonen har ikke noe callsenter, og superadmin-rettighetene gjelder bare i økter startet med BankID.

- **Passkeys (2. oktober 2026):** for å slippe kostnaden per BankID-innlogging kan brukere legge til en passkey (WebAuthn: Face ID, Touch ID, Windows Hello eller sikkerhetsnøkkel) under Min konto, men bare i en økt startet med BankID. En innlogging med passkey teller som sterk, akkurat som BankID, fordi den er knyttet til enheten, krever brukerverifisering og ikke kan fiskes. Gjelder i begge miljøer. Første innlogging og invitasjoner går fortsatt via BankID eller Vipps. Superadmin kan se og fjerne en brukers passkeys (for eksempel ved mistet telefon), og brukeren logges da ut overalt. Relying party er appens vertsnavn (`staging.veriqall.no`), så passkeys virker bare der, ikke på Amplify-adressen. Utfordringer er engangs og gjelder i fem minutter (`webauthn_challenges`), og bare den offentlige nøkkelen lagres (`passkeys`, migrasjon `0007_passkeys.sql`).

- **Bare innlogging for besøkende (2. oktober 2026):** `/` sender til `/logg-inn`. Innloggingssiden viser valgene med en gang, og sender en innlogget bruker videre til startsiden sin (Superadmin, Administrasjon eller Min konto). Det skjer ikke når siden viser en feil eller en invitasjon, og heller ikke med `?neste=`, fordi en side da allerede har avvist økten (for eksempel en Vipps-økt der BankID kreves).
- **Returstier:** `?neste=` og stien etter OIDC- og passkey-innlogging godtas bare når de peker inn i appen. Kontrolltegn og bakstreker avvises, også prosentkodet, fordi nettlesere fjerner tabulatorer og leser `\` som `/` (`/<tab>/evil.example` ville ellers forlatt siden). Regelen ligger i `safeAppPath` i `packages/shared` og brukes av både web og API. I tillegg har `auth_states.return_to` en tilsvarende sjekk i databasen.

## Slik er det bygget (PR 3)

- `packages/db/migrations/0002_login.sql`: BankID-kravet håndheves i databasen. API-et setter `app.session_strong` for BankID-økter, og `app.current_permissions()` og `app.is_platform_admin()` filtrerer på den, så alle RLS-policyer og vern følger kravet.
- `apps/api/src/auth/`: OIDC-flyten (PKCE, state, nonce, verifisering av `id_token` mot leverandørens nøkler), kobling til bruker og økter. Testet mot en falsk OIDC-leverandør i `apps/api/test/fake-idp.ts`.
- Rutene: `GET /auth/{vipps|bankid}/start`, `GET /auth/{vipps|bankid}/callback`, `POST /auth/logout` og `GET /me`.
- `apps/web`: `/logg-inn` med feilmeldinger på norsk, og innloggingsstatus i toppen. Før produksjon må Vipps-knappen byttes til Vipps' offisielle knapp.

## Tillegg fra gjennomgangen 2. oktober 2026

- **Nettverk er avgjort:** Lambdaene ligger i VPC, med NAT-instans i staging og NAT Gateway i produksjon (se `plan.md`, seksjon 3 og 9). Innloggingen er én Lambda.
- **Egen databaserolle for innloggingen:** før innlogging finnes verken bruker eller callsenter å sette for RLS. Innloggings-Lambdaen bruker derfor rollen `app_auth`, som bare når `auth_states`, `invitations`, `identities`, `sessions`, `login_events` og det den må lese i `users`. Resten av API-et bruker `app_user`, som er underlagt RLS.
- **`state` lagres som hash**, på samme måte som økt-ID og invitasjonstoken. Nonce og PKCE-verifier må lagres slik de er, fordi de skal sendes videre.
- **Kobling av BankID fra Min konto (3. oktober 2026):** navnet fra BankID må stemme med navnet på brukeren. Fornavnet og etternavnet i BankID må begge finnes i navnet callsenteret har registrert (store og små bokstaver, aksenter og mellomnavn teller ikke). Ellers kunne den som har en Vipps-økt, koble sin egen BankID og få administrative rettigheter. Stemmer ikke navnet, avvises koblingen (`navn_ulikt`), og en administrator må rette navnet først. Koblingen skrives til `audit_log` via `identities`.
- **Automatisk Vipps-kobling** via mobilnummer krever også at invitasjonen ikke er utløpt eller trukket tilbake.
- **Invitasjon av eksisterende brukere (3. oktober 2026, migrasjon `0025_invitation_claims.sql`):** en invitasjonslenke kan bare knytte en ny innlogging til en bruker som aldri har logget inn (ingen identitet eller passkey), ikke er superadmin og ikke er medlem av noe annet callsenter. Det sjekkes både når invitasjonen lages og når lenken brukes. Er personen allerede bruker, legges hen til callsenteret uten lenke og ser det ved neste innlogging med sin egen BankID, Vipps eller passkey. Ellers kunne en admin i ett callsenter invitere en bruker fra et annet, åpne lenken med sin egen BankID og overta kontoen. Ubrukte lenker som ikke lenger oppfyller kravet, ble trukket tilbake av migrasjonen. Et callsenters admin kan bare endre den globale brukerraden (navn, telefon, e-post, status) til brukere som bare er medlem der. Kjent begrensning: en person som er invitert av to callsentre før første innlogging, må bruke Vipps (kobles via mobilnummeret), eller få hjelp av superadmin.
- **BankID-nivået sjekkes i id-tokenet (3. oktober 2026):** `acr` må være nøyaktig `urn:grn:authn:no:bankid`. `acr_values` i lenken til Idura går via nettleseren og beviser ingenting, så en annen e-ID-metode avvises i stedet for å gi en sterk økt.
- **`acr` lagres på økten**, så API-et vet hvilket sikkerhetsnivå økten har og kan håndheve BankID-kravet over.
- **Sist sett** oppdateres høyst én gang i minuttet, så hvert kall ikke gir en skriving.
- **Rate limiting** på `/auth/*` i API Gateway, og sjekk av `Origin` på kall som endrer data, siden `SameSite=Lax` ikke dekker alt.
