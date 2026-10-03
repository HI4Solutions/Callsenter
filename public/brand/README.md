# Brand-filer

Godkjente logo- og ikonfiler (se `docs/plan.md`, seksjon 6). Genereres av `tools/brand/`.

- `veriqall-logo-light.svg`, `veriqall-logo-dark.svg`: ordmerket
- `veriqall-symbol-light.svg`, `veriqall-symbol-dark.svg`: bare Q-en
- `veriqall-app-icon.svg`: hvit Q på merkefarge
- `favicon.svg`: bytter farge med lys og mørk modus
- `apple-touch-icon.png` (180 px) og `icon-512.png`: hjemskjermikoner

Denne mappen er kilden. `apps/web` kopierer den til `apps/web/public/brand/` (gitignorert) ved `dev` og `build`.

Fra andre:

- `bankid-logo.svg` og `bankid-logo-white.svg`: BankID-logoen i BankIDs lilla (#39134C) og i hvitt, levert av Nadeem 3. oktober 2026. Knappene (`apps/web/src/components/provider-buttons.tsx`) bruker symbolet, de åtte strekene, i hvitt på BankIDs lilla. Bør byttes med filene fra BankIDs merkevaresider før produksjon.

- `og-image.png` (1200 × 630): delingsbildet for sosiale medier og søkemotorer, laget 3. oktober 2026 med Chromium fra en HTML-side med logoen, løftet fra landingssiden og Schibsted Grotesk. Lages på nytt på samme måte når løftet endres.
