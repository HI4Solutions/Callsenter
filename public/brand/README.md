# Brand-filer

**Dette er plassholdere.** De godkjente logo- og ikonfilene (se `docs/plan.md`, seksjon 6) lå ikke i repoet da
fase 0 PR 1 ble laget. Plassholderne har riktige filnavn og farger, men er enkle former og ikke den
egentegnede Q-en. Overskriv dem med de ekte filene; ingen kode må endres.

Forventede filer:

- `veriqall-logo-light.svg`, `veriqall-logo-dark.svg`: ordmerket
- `veriqall-symbol-light.svg`, `veriqall-symbol-dark.svg`: bare Q-en
- `veriqall-app-icon.svg`: hvit Q på merkefarge
- `favicon.svg`: bytter farge med lys og mørk modus
- `apple-touch-icon.png` (180 px) og `icon-512.png`: hjemskjermikoner (mangler ennå)

Kilden er denne mappen. `apps/web` kopierer den til `apps/web/public/brand/` ved `dev` og `build`.
