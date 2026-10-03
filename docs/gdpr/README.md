# GDPR-dokumenter for VeriQall

> **Utkast, må gjennomgås av jurist før bruk.** Dokumentene er skrevet 3. oktober 2026 på grunnlag av [`docs/plan.md`](../plan.md), [`docs/auth.md`](../auth.md) og `CLAUDE.md`. Alt som står i hakeparenteser, som `[organisasjonsnummer]`, må fylles ut før bruk.

## Rollene

- **Hi4 Solutions AS** utvikler og drifter VeriQall. Selskapet er **behandlingsansvarlig** for nettstedet veriqall.no, kontaktskjemaet, superadmin-brukerne og kundeforholdet til callsentrene (fakturering), og **databehandler** for alt callsentrene legger inn i plattformen.
- **Hvert callsenter** er **behandlingsansvarlig** for opplysningene om sine kunder og sine ansatte i VeriQall: samtaleopptak, transkripsjoner, AI-kontroller, kunder, salg, klager og tall på dashboardet. Informasjon til kunden om opptak, og grunnlaget for opptaket, er callsenterets ansvar (besluttet 3. oktober 2026, `docs/plan.md` seksjon 8).

## Dokumentene

| Fil | Hva | For hvem |
|---|---|---|
| [`personvernerklaering.md`](personvernerklaering.md) | Personvernerklæring for veriqall.no og VeriQall-appen | Publiseres på nettstedet og lenkes fra appen. Leses av besøkende, brukere i callsentrene og kunder som får en bekreftelseslenke |
| [`databehandleravtale.md`](databehandleravtale.md) | Databehandleravtale etter GDPR artikkel 28 mellom callsenteret og Hi4 Solutions AS, med vedlegg A (behandlingen), B (underdatabehandlere) og C (tekniske og organisatoriske tiltak) | Inngås med hvert callsenter før det tar plattformen i bruk |
| [`behandlingsprotokoll.md`](behandlingsprotokoll.md) | Hi4 Solutions AS' protokoll over behandlingsaktiviteter (artikkel 30 nr. 1 som behandlingsansvarlig og nr. 2 som databehandler) | Internt dokument. Legges fram for Datatilsynet på forespørsel |
| [`informasjonskapsler.md`](informasjonskapsler.md) | Oversikt over informasjonskapsler og lokal lagring i nettleseren | Publiseres sammen med personvernerklæringen |

## Det som fortsatt er åpent

1. **Juridisk gjennomgang.** Ingen av dokumentene er gjennomgått av jurist. Rettsgrunnlagene, ansvarsfordelingen og vilkårene i databehandleravtalen (særlig ansvar, revisjon og oppsigelse) må vurderes.
2. **Avtaler med underdatabehandlerne må samles inn og gjennomgås:**
   - **AWS** (Amazon Web Services EMEA SARL): AWS GDPR Data Processing Addendum, som er en del av AWS Service Terms. Regionen er `eu-north-1` (Stockholm). Det må bekreftes at ingen tjenester vi bruker, behandler data utenfor EU/EØS. Bedrock bruker EU-inferensprofiler, som kan behandle i andre EU-regioner enn Stockholm.
   - **Soniox** (transkripsjon): hvilken juridisk enhet som er avtalepart, hvor den er etablert, databehandleravtale, og om EU-endepunktet garanterer behandling bare i EU/EØS. Hvis selskapet er etablert utenfor EU/EØS, trengs et overføringsgrunnlag (GDPR kapittel V) selv om serverne står i EU. Dette er ikke verifisert.
   - **Idura** (BankID-megler): databehandleravtale, eller avklaring av om Idura er selvstendig behandlingsansvarlig for selve identifiseringen.
   - **Vipps MobilePay AS** (Vipps Logg inn): Vipps' vilkår og personvernerklæring for Logg inn, og avklaring av rollefordelingen.
   - **Amazon SES** (e-post): dekkes av AWS-avtalen, men SES er ikke satt opp ennå (`docs/plan.md` seksjon 17). E-postene står i dokumentene fordi funksjonen er bygget.
3. **Personvernkonsekvensvurdering (DPIA, artikkel 35) anbefales.** VeriQall tar opp samtaler (stemmen til både kunde og selger), transkriberer dem og lar en KI-modell vurdere om selgeren fulgte produktmalen. Resultatet vises som flagg per samtale og som tall per selger på dashboardet, og brukes til coaching. Det er en systematisk vurdering av ansatte med ny teknologi, og det kan treffe Datatilsynets liste over behandlinger som alltid krever DPIA. Vurderingen bør gjøres av Hi4 Solutions AS for plattformen som helhet, og hvert callsenter må vurdere sin egen bruk. Hi4 bistår (databehandleravtalen punkt 9).
4. **Arbeidsrett.** Opptak av ansattes samtaler og KI-vurdering av arbeidsprestasjoner er kontrolltiltak som krever drøfting med og informasjon til de ansatte (arbeidsmiljøloven kapittel 9). Det er callsenterets ansvar, men bør stå i veiledningen til callsentrene.
5. **Lagringstid for kontakthenvendelser** er ikke bygget. Forslaget i dokumentene er sletting når henvendelsen er behandlet, og senest etter 12 måneder. Må besluttes og bygges (opprydding i workeren).
6. **Sletting på forespørsel** fra callsenteret, før lagringstiden utløper, er ikke bygget (`docs/plan.md` seksjon 8).
7. **Angrerettloven og aksepten:** om lenke med BankID eller Vipps oppfyller kravet til skriftlig aksept, og om Vipps Logg inn kan brukes til aksept, må vurderes før modulen Salgsverifisering tas i bruk (`docs/plan.md` seksjon 14). Det er ikke et GDPR-spørsmål, men dokumentene beskriver bevisene som lagres.
8. **Kontaktpunkt.** Adresse, e-post for personvernhenvendelser og eventuelt personvernombud må fylles inn. Et personvernombud er trolig ikke pålagt for Hi4 Solutions AS, men det må vurderes (artikkel 37).
9. **Produksjonsmiljøet** finnes ikke ennå. Dokumentene beskriver løsningen slik den er bygget og kjører i staging. Staging bruker ekte BankID og Vipps, så interne testere får navnet sitt lagret der.
