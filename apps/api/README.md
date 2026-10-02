# apps/api

Lambda-handlere bak API Gateway (TypeScript), bygget med esbuild til `dist/` (`npm run build -w apps/api`).

- `src/api.ts`: API-et. Foreløpig bare `GET /health`, som sjekker at Lambdaen når databasen som `veriqall_api` (IAM-innlogging, TLS, underlagt RLS).
- `src/migrator.ts`: kjører migrasjonene og provisjonerer innloggingsbrukerne. Startes av deploy-workflowen etter hver deploy.

Infrastrukturen ligger i `infra/app.yml`.
