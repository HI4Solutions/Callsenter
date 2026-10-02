# Brand-filer

Godkjente logo- og ikonfiler (se `docs/plan.md`, seksjon 6). Genereres av `tools/brand/`.

- `veriqall-logo-light.svg`, `veriqall-logo-dark.svg`: ordmerket
- `veriqall-symbol-light.svg`, `veriqall-symbol-dark.svg`: bare Q-en
- `veriqall-app-icon.svg`: hvit Q på merkefarge
- `favicon.svg`: bytter farge med lys og mørk modus
- `apple-touch-icon.png` (180 px) og `icon-512.png`: hjemskjermikoner

Denne mappen er kilden. `apps/web` kopierer den til `apps/web/public/brand/` (gitignorert) ved `dev` og `build`.
