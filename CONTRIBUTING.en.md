# Contributing

> Chinese original: [CONTRIBUTING.md](CONTRIBUTING.md)

Thanks for taking the time. This plugin exists for one concrete situation — "the work is done, shut the machine down" — so the codebase is small, but a few constraints are deliberate. Reading this first is cheaper than getting a PR sent back.

## 1. What we want, and what we do not

**Welcome:**

- **Bug fixes**, with reproduction steps in the PR description (which state, what you clicked, what you expected, what happened).
- **More assertions**: any behaviour that currently has no test behind it is a net win when covered.
- **Documentation corrections**: wrong, stale, or examples that no longer run.
- **Performance and UX improvements**: card rendering, floating-window refresh, settings-page interaction.
- **New platform support for an action**: e.g. a better lock command on a particular distribution.

**Not accepted** (closed without much discussion, and it is not about tone):

- **Third-party dependencies.** **Zero runtime dependencies** is a hard constraint: the host uses only `node:fs` / `node:path` / `node:crypto`, the browser side requires only `react`. One extra package breaks "install it and it works in any DSH environment".
- **Changes to `.github/workflows/publish.yml`.** The release pipeline belongs to the maintainer.
- **Version bumps or edits to the version section of CHANGELOG.** Versions are written in one place at release time; a PR that changes them collides with everyone else.
- **Copy changes that touch only one language.** A missing translation makes one language render as another, which is worse than leaving it alone.
- **`process.exit()` inside the host process.** It skips host cleanup and can corrupt running sessions; if you need to exit, go through an existing action path.

## 2. Read these first

Depending on what you are touching:

- [`docs/ARCHITECTURE.en.md`](docs/ARCHITECTURE.en.md) — the five gates, the state machine, why the countdown is run by the plugin itself.
- [`docs/CONFIG.en.md`](docs/CONFIG.en.md) — the shape of `data/config.json`, profile fields, HTTP endpoints, the `reason` enum.
- [`docs/DEVELOPING.en.md`](docs/DEVELOPING.en.md) — how to mount it locally, why a full DSH restart is required, where the logs are.

## 3. Repository layout

The easiest mistake is assuming the copy lives in the i18n file. Three entry points:

- **`lib/index.mjs`** — host side: gates, countdown, action table, `/state` and the other HTTP endpoints.
- **`lib/client.js`** — the client bundle: sidebar card, settings page, floating window. **Single file, hand-bundled, no build step**; CSS and React both live in it. Changes here only take effect after a full DSH restart.
- **`lib/i18n.mjs`** — the **host** message catalogue (event log, notifications — text the server emits). **Client copy lives in `MSG` inside `lib/client.js`, not here.**

## 4. Environment

- Node **≥ 22.19** (pinned in `package.json` under `engines`).
- **No third-party dependencies**: `npm install` only exists so the dependency tree is present for scripts; there is no build step and no `dist`.
- Platforms: Windows is fully verified; macOS has been verified to shut down on real hardware (the system holds it when an app blocks shutdown); Linux is covered by code and assertions only (see the known limitations in [`docs/BETA.en.md`](docs/BETA.en.md)).

## 5. Running the tests

Both must be run from the repository root, and both must exit 0:

```bash
node test/host.test.mjs     # host assertions, ctx is mocked, nothing ever shuts down — 66 assertions today
node test/client.test.cjs   # client bundle smoke, real client.js against a fake React — 15 assertions today
```

`npm test` chains the two and is equivalent. After touching `lib/*`, run both; for docs or screenshot-script changes, at least run `client.test.cjs` (card styles and screenshots come from the same source).

One more you will want when card styles change:

```bash
node scripts/gen-gallery.cjs                                              # writes docs/screenshots/*.html
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1  # renders PNGs, needs Edge
```

## 6. Assertion requirements

This is the most important section; following it saves a round trip.

- **New behaviour must ship with an assertion.** A PR without one will be asked to add it, even when the feature is correct — untested behaviour means nobody notices when the next person breaks it.
- **Bug fixes require reverse verification**: revert your fix and confirm the assertion goes red. **Paste the failing line plus actual / expected into the PR description.** This is how the project has always worked, not an extra hoop.
- **Assertion names use the `xxx-ok` kebab style**, one name per behaviour, e.g. `parked-clear-ok`, `custom-hidden-without-profiles-ok`. The name should say what it protects.
- Assertion messages should carry the actual value so a failure reads without opening the code.

## 7. The three-language rule

`zh` / `en` / `ru` are supported and **their key sets must stay level**:

- Adding copy means adding it in all three; removing means removing in all three. A single-language PR is sent back.
- The host catalogue is checked per language by the `i18n-coverage-ok` assertion in `test/host.test.mjs` — one missing key fails.
- Client `MSG` copy is checked by `test/client.test.cjs`, which asserts the settings-page labels are all present.
- Translations must read like prose, not machine output; use one term per concept in each language.

## 8. Commits and branches

- **One commit, one concern.** Keep bug fixes and drive-by refactors apart; review and rollback both get easier.
- **Commit messages**: `type(scope): lowercase english description`, with `type` from `fix` / `feat` / `docs` / `test` / `chore` / `ci` and an optional `scope` (`client`, `config`, `readme`, `release`…). Example: `fix(client): hide the script rows when custom profiles are off`.
- **Do not use `git add .`** It swallows other people's uncommitted work in a shared tree — this repository has been bitten twice; everything goes through `git commit -m "…" -- <explicit paths>`.
- Branch from `main`. For large changes (contract, state machine, on-disk format) **open an issue first** so the direction is agreed before you write it. An issue should include: reproduction steps, the relevant slice of `data/events.log` (redacted), the response of `GET /api/dsh-shutdown-guard/state`, and the DSH and plugin versions.
- Do not reformat unrelated files: incidental whitespace, quote, or indentation churn turns the diff into noise and will be asked to be reverted.

## 9. What review looks at

- **Whether it says something wrong to the user**: user-visible text may not contain internal ids, status codes, function names, or `[object Object]`. The settings page turns protocol strings into plain language.
- **Whether failure paths explain themselves**: an unavailable action must carry a `reason` and translate it, not fail silently or leave a grey button with no explanation.
- **Whether it touched only what it had to**: unrelated comment, formatting, or reordering changes get reverted.
- **Whether the tests actually block a regression**: assertion names match their content, and reverse verification was done.
- Merged work is credited in `CHANGELOG.md` under your GitHub handle; that is the convention here.
