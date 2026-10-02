# packages/db

SQL-migrasjoner for Postgres (RDS), RLS og tilgangsregler, og et lite migreringsverktøy.

- `migrations/NNNN_navn.sql`: kjøres i rekkefølge, hver i sin egen transaksjon. En migrasjon som er kjørt, endres aldri. Verktøyet nekter å kjøre hvis en kjørt fil er endret eller fjernet, eller hvis en ny fil sorterer før den siste som er kjørt.
- `src/migrate.ts` og `src/cli.ts`: `DATABASE_URL=... npm run migrate -w packages/db`. I skyen kjøres dette av migrator-Lambdaen i VPC-en (fase 0, PR 4), aldri manuelt mot produksjon.
- `test/`: hver testkjøring lager en egen database, kjører migrasjonene som en eier uten superbruker-rettigheter (slik som på RDS), og kobler til som innloggingsroller i `app_user` og `app_auth`.

## Databaseroller

| Rolle | Brukes av | Tilgang |
|---|---|---|
| eier | migrasjoner | eier alle objekter, ikke underlagt RLS |
| `app_user` | API-et | underlagt RLS; API-et setter `app.current_user_id` og `app.current_org_id` med `SET LOCAL` i hver transaksjon |
| `app_auth` | innloggings-Lambdaen | bare `auth_states`, `invitations`, `identities`, `sessions`, `login_events` og det den må lese i `users` |

Begge app-rollene er `NOLOGIN`. Innloggingsbrukerne opprettes per miljø av infrastrukturen og får medlemskap i én av dem.

## Kjøre testene lokalt

Testene trenger en Postgres (16 eller nyere) og en admin-tilkobling som kan opprette roller og databaser:

```
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test -w packages/db
```

Uten `TEST_DATABASE_ADMIN_URL` brukes verdien over.
