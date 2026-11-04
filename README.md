# SPOTS Tutorial (Practice Guide)

Interactive practice walkthrough for [SPOTS](https://github.austin.utexas.edu/caet-saga/spots-app) — a pediatric symptom-reporting tool from UTHealth Houston Cizik School of Nursing. Kids and caregivers can try the flow without signing in or talking to REDCap.

This is a **static** site (HTML / CSS / vanilla JS). No backend, no auth.

## Local development

Requires [Node.js](https://nodejs.org/) (any recent LTS is fine).

```bash
npm install
npm run dev
```

That starts [Vite](https://vitejs.dev/) on **http://localhost:5500** with live reload when you change source files. Port `5500` avoids clashing with the main spots-app (`3000`).

Stop with `Ctrl+C`.

## Project layout

| File / folder | Role |
| --- | --- |
| `index.html` | Shell page + CSP |
| `app.js` | Screens, checklist, question modal, session flow |
| `data.js` | Body parts, activities, feelings, symptom lists (mirrors spots-app seed data) |
| `styles.css` | Layout and visuals |
| `translations.csv` | English → Spanish strings used by `t('…')` in `app.js` |
| `assets/` | Images, SVGs, fonts |
| `package.json` / `vite.config.js` | Local preview only — not used in production hosting |

## Making changes

1. Branch from `main` (or your team’s working branch).
2. Edit the file that matches the change (copy/flow → `app.js`, symptom lists → `data.js`, look → `styles.css`, Spanish → `translations.csv` + matching English keys).
3. Preview with `npm run dev`.
4. Commit and push; Amplify rebuilds the static app separately from spots-app.

**Spanish:** add a row to `translations.csv` whose English column exactly matches the string passed to `t('…')`. Reload to pick up CSV changes.

**Parity with the real app:** symptom lists and UI here are a fixed mirror of spots-app, not live REDCap. When the product changes, update this tutorial by hand if the practice guide should stay in sync.

## How it ships

- Hosted as a static Amplify app (`spots-tutorial`), e.g. `https://main.dci1qtzdmfsva.amplifyapp.com`.
- Custom domain `tutorial.spotsymptoms.org` may be wired later.
- The main SPOTS app opens this URL in a footer modal via `NEXT_PUBLIC_TUTORIAL_URL` (see spots-app `app/_lib/config/tutorial-config.ts`). Changing that env var is the only spots-app change needed when the tutorial URL moves.

Original upstream: [danpinguc/SpotsTutorial](https://github.com/danpinguc/SpotsTutorial).

## License

See repository license / project ownership with the SPOTS team and UTHealth Houston.
