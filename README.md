# ptz-web-control
Web interface for PTZ camera control.

## Use
Download the files and run index.html in a browser.

## Build
Install dependencies once with `npm install`, then use one of these commands:

- `npm run build` — Compiles `ts/app.ts` into `js/app.js` using `tsconfig.json`,
  then builds the production site in `dist/` with Webpack.
- `npm run build:ts` — Compiles only `ts/app.ts` into `js/app.js` using
  `tsconfig.json`.
- `npm run watch:ts` — Watches for TypeScript changes and automatically
  recompiles whenever you save. Keep this command running while editing.

Edit `ts/app.ts`; compilation overwrites `js/app.js`.

### To Do:
- [ ] There may be a problem with hex commands. The packet display shows 09
instead of 0A.
