# Shutdown Guard · Shut down when tasks finish
[中文](README.md) · **English** · [Русский](README.ru.md)

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/banner.png" width="880" alt="Shutdown Guard — automatic shutdown when tasks finish, a night-watch card in the sidebar"></p>

[![version](https://img.shields.io/badge/version-1.5.2-2ea44f)](CHANGELOG.md)
[![demo](https://img.shields.io/badge/%E2%96%B6-LIVE%20DEMO-d97757)](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.5--rc.1-4a90d9)](https://github.com/deepseek-ai)
[![platform](https://img.shields.io/badge/platform-Windows-0078d4)](#constraints)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dshbase install-tested](https://dshbase.com/badges/dsh-shutdown-guard.svg)](https://dshbase.com/plugins/dsh-shutdown-guard/) [![awesome-dsh-plugin listed](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/ltayshark0637/dsh-Shutdown-Guard/)

Adds a "shut down automatically when all tasks finish" card to the DeepSeek Harness sidebar, with a more varied and polished visual treatment, decision logic, and customization. It sits below Skill Center and above the session list, and updates in real time with task state.

**▶ [Interactive demo](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)** — no installation needed; see what it looks like and how it decides. Two panes: **Learn** (rules, appearance, states) and **Try** (a random scenario where you arm the guard, cancel it, and release it yourself, all the way to a shutdown or a block). All data is generated locally at random; nothing is sent over the network.

## Why you need it

People who run long tasks know this scene: you hand the agent a batch of work in the evening, want the machine to shut down when it is done, and you are not at the desk.

But "task finished" does not mean "safe to shut down" — background jobs may still be running, a session may have errored, the agent may be waiting for your answer, or you may have stopped it halfway. Shutting down in any of those cases is an incident. The plugin blocks each of these situations and shuts down only when it is genuinely safe.

## Rules: when it actually shuts down

In a blocked state (see below) nothing is sent at all; otherwise all five gates must pass before `shutdown /s` is issued:

1. **Armed** — you turned it on manually
2. **No countdown already running** — avoids duplicate issuance
3. **All root sessions idle** — no agent is still working
4. **No running or stopping background jobs** — `blockOnJobs`, on by default
5. **No session error in this batch** — `onlyOnSuccess`, on by default

If any one is missing, it does not shut down and writes the reason on the card and in the settings page.

## Three looks

The same look in light and dark; the trilingual captures live in `docs/screenshots/` as `<nn>-armed-<look>-<lang>-<theme>.png`.

| Minimal (light)                                                             | Radar (light)                                                        | Terminal (light)                                                                             |
|:------------------------------------------------------------------------------:|:-----------------------------------------------------------------------:|:--------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/03-armed-a-en-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/09-armed-b-en-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/15-armed-c-en-light.png" width="250"> |

| Minimal (dark)                                                             | Radar (dark)                                                        | Terminal (dark)                                                                             |
|:------------------------------------------------------------------------------:|:-----------------------------------------------------------------------:|:--------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/04-armed-a-en-dark.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/10-armed-b-en-dark.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/16-armed-c-en-dark.png" width="250"> |
| Large status text + one-line explanation, scrolling red-and-yellow hazard tape at the bottom                                          | Radar + a status line, sessions and background jobs shown as dots                      | Three terminal lines (command, counts, waiting) over six gate indicator lights                                                      |

Dots in the radar are added and removed, never reordered: when the count changes, the dots you are looking at do not jump.

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/anim-radar.gif" width="330" alt="Radar sweep"></p>

Pick one of the three thumbnail cards in the Appearance tab; it takes effect immediately, no restart. The picture switches with the UI language and the lightness of the surface behind it.

## Six runtime states

| Off                                              | Standby                                                  | Waiting on background jobs                                                           |
|:---------------------------------------------------:|:-----------------------------------------------------:|:----------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/01-off.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/02-armed.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/03-hold.png" width="250"> |

| Countdown                                               | Issued                                                                  | Blocked                                                                     |
|:----------------------------------------------------:|:-----------------------------------------------------------------------:|:------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/04-fire.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/05-fired.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/08-blocked-halted.png" width="250"> |

`Off` → `Standby` → `Waiting on background jobs` → `Countdown` → `Issued`; a blocking error at any stage moves it to `Blocked`. You can cancel at any point during the countdown; **cancelling leaves it armed** — the next batch will still shut down.

Want to flip through all six states? In section 04 of the demo's Learn pane, the three capsules `A` `B` `C` at the top right switch which look the preview uses.

## Blocked states

| halted · needs manual action                                            | waiting · retries automatically                                                                |
|:--------------------------------------------------------------:|:---------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/08-blocked-halted.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/09-blocked-waiting.png" width="250"> |

For errors that cannot be handled as ordinary failures, the plugin **stays armed**, changes the card's colour, and writes out the reason:

- **`halted`** (slate blue) — insufficient quota, invalid credentials, context overrun, unsupported capability, disk full. Only a human can resolve it; click "disarm and retry".
- **`waiting`** (slate green, a breathing dot) — rate limiting, 5xx, network interruption, empty response, timeout, image offload. Retried automatically according to policy; at the right moment a "continue the original plan" instruction is injected.

<p align="center"><img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/anim-blocked.gif" width="380" alt="Waiting for recovery, the status dot breathing"></p>

Retry cadence is configured per failure type; see [Retry policies](#retry-policies).

## AFK auto-pilot

When nobody is at the desk, the plugin covers three things for you:

- **Auto-answer questions** (on by default): when the agent asks something, it replies "The user is AFK. Finish the tasks already assigned, write up a summary report to disk, and do not touch branches that were not assigned." It returns `selected: []` plus custom text, so **it never selects an option for you**; turn this off and questions come to you as usual.
- **Error recovery**: when a session errors, the agent is first asked to investigate and continue the original plan; a second failure in the same session switches to "stop retrying and write up a report".
- **Interruption protection**: if you stop a task yourself midway, that does not trigger a shutdown.

## Where it lives

| Armed: below Skill Center, above the session list                                                          | Countdown: same spot, the whole strip turns red                                                              |
|:-------------------------------------------------------------------------------------------:|:---------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/10-sidebar-hold.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/11-sidebar-fire.png" width="250"> |

The card is pinned to this sidebar slot by default; the button on the card header opens it as a standalone floating window that stays in view when you switch sessions (see "Other details" below).

## Other details

- **Floating window**: the button in the card's top-right corner opens the status panel in a window of its own, so it stays in view when you switch to another session. The "compact floating window" switch in settings is on by default and keeps only the status and countdown; turn it off for the full panel.

- **Vertical collapse**: collapsed it keeps only the title and status; click the title to expand.

  <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/16-folded.png" width="250" align="right" alt="Collapsed state">

- **Theme adaptation**: the card carries its own `--dsp-*` palette and picks light or dark automatically from the host surface's brightness; you can also force dark / light / Claude Style. The settings page always follows the host theme.

- **Language**: "follow system" by default — `LC_ALL` / `LC_MESSAGES` / `LANG`, then the `Intl` locale, finally `en`; you can also pin Chinese / English / Russian. The "follow" state for language and theme is held by the host, so it is not duplicated per device.

- **Event log**: the settings page shows recent events and "why it did not shut down last time"; the full stream is in `data/events.log`.

<br clear="all">

## Settings page

| Dark                                                                                          | Light                                                                                           |
|:---------------------------------------------------------------------------------------------:|:----------------------------------------------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/12-settings-dark.png" width="380"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/13-settings-light.png" width="380"> |

Four tabs: **Appearance** (profiles included) / **Vigil** (when to shut down + watch behaviour) / **Notifications** / **Status**. It opens on Appearance, and every switch takes effect immediately.

- **Appearance**: three thumbnail cards at the top — Minimal (large title plus one line), Radar (radar plus a status line), Terminal (three terminal lines); the picture follows the UI language and the lightness of the surface. Below them: theme (follow / dark / light / Claude), collapse by default, compact floating window, UI language.
- **Profiles** (further down the same tab): one default profile plus any number of custom profiles. The default is locked at 60 seconds and acts as the floor; a custom profile starts as a copy of the current one and can then be tuned.
- **Vigil**: the top half is when to shut down — "All sessions idle" is the floor condition, always on and not switchable; "Background jobs finished" blocks background jobs, "skip this round if any session errored" blocks erroring batches; the countdown length is only editable in a custom profile. The bottom half is watch behaviour — "AFK auto-answer" controls whether questions are answered for you while armed; the description states "replies never select an option for you; turn this off and questions come to you as usual."
- **Notifications**: one master switch plus four per-kind switches (countdown started / shutting down / first block / block recovered). Arming, disarming and cancelling by hand stay silent.
- **Status**: current block, why it did not shut down last time, recent events.

## Light and third-party themes

| Light card                                              | Claude Style                                           |
|:-----------------------------------------------------:|:------------------------------------------------------:|
| <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/14-light.png" width="250"> | <img src="https://cdn.jsdelivr.net/gh/ltayshark0637/dsh-Shutdown-Guard@main/docs/screenshots/15-claude.png" width="250"> |

The card does not inherit the host palette; it brings its own, while the settings page follows the host theme. The third-party Claude Style theme has a matching palette too.

## Installation

Published on npm; recommended:

```bash
dsh plugin --profile web add dsh-shutdown-guard
```

Or install straight from GitHub:

```bash
dsh plugin --profile web add github:ltayshark0637/dsh-Shutdown-Guard
```

Then **restart DSH**.

> ⚠️ **The client bundle is only wired into the module graph at DSH startup**: after editing `lib/client.js` you must restart; refreshing the page does nothing. The same applies to the server side.

**On a restricted network**: the GitHub command is essentially `pnpm add github:...` and needs a clone. If cloning fails, prefer the npm command (it goes through the registry); if neither works, install from a local path — DSH Settings → Plugins → Add, enter the **absolute path** of this directory → Install → restart.

**Manual fallback**: create a symlink `node_modules\dsh-shutdown-guard` under `profiles\web` pointing at this directory, then:

- add `link:<absolute path of this directory>` to `dependencies` and `pnpm.overrides` in `profiles\web\package.json`
- append `dsh-shutdown-guard` to `dsh.profile.bundles`

## Permissions and impact

Once installed, the plugin does the following:

| Area | Concrete behaviour |
| --- | --- |
| **Command execution** | Calls Windows `shutdown.exe` through `subprocess`: `/s /t <seconds>` schedules the shutdown, `/a` cancels it. **Only invoked when armed and all five gates pass** |
| **File access** | Only `data/` inside the plugin directory: `config.json` (configuration) and `events.log` (event log) |
| **Events** | `agent/status`, `agent/error`, `session/event`, `user-questions/request` |
| **HTTP routes** | Under the local DSH Web server, `/api/dsh-shutdown-guard/`: `GET /state`, `GET /events`, `POST /arm`, `POST /disarm`, `POST /cancel`, `POST /config`; POST validates that Origin is `127.0.0.1` or `localhost` |
| **Network** | **No external requests at all**, no data collection |
| **Platform** | **Windows only**. On anything other than `win32` the plugin silently does not load |

While AFK auto-pilot is on, the plugin answers the agent's questions and injects recovery instructions into erroring sessions during armed periods; you can switch this off at any time in settings.

## Configuration

Configuration has two layers: one **default profile** and any number of **custom profiles**. Each profile carries its own countdown length, both gate switches, AFK and the four notification switches.

Three sources, lowest priority first:

1. `cordis.patch.yml` (the shipped patch inside the plugin package)
2. `data/config.json` (persisted at runtime; whatever the settings page changes lands here)
3. `POST /config` (runtime change, also persisted)

### Why the default profile is locked

The default profile is **everyone's safe floor**: 60 seconds, wait for background jobs, skip erroring batches — all hard-wired, not editable. The reasoning is practical:

- 60 seconds is the shortest window in which you can still see the card and hit cancel; at 10 seconds the cost of an accidental shutdown dwarfs the minute you saved.
- Because the default cannot drift, you can always switch back to it without wondering whether your last tweak is still in effect.
- Want something else? Fine — but you have to create a custom profile explicitly, and the edit lands there, never on the floor.

### Creating a custom profile

Settings → **Profiles** → `+ New`: it copies the current profile, you name it (≤24 characters) and save; it becomes the active profile.

- Every custom profile can be made the default, renamed, or deleted.
- Deleting the profile in use falls back to the default profile, with a confirmation first.
- When the "custom profiles" master switch is off, no custom profile applies and the default is used.

### Keys

These live per profile:

| Key              | Range   | Default   | Description                                      |
| --------------- | ------ | ------ | ----------------------------------------- |
| `countdownSec`  | 10–600 | 60     | Seconds of countdown before shutdown (fixed at 60 in the default profile, not editable) |
| `onlyOnSuccess` | bool   | `true` | Skip the shutdown when any session in this batch errored |
| `blockOnJobs`   | bool   | `true` | Skip the shutdown while background jobs are running |
| `afkAutoAnswer` | bool   | `true` | Answer questions and perform error recovery for the user while armed |
| `notify`        | object | all `true` | The four notification switches: `countdown` / `fired` / `blocked` / `recovered` |

Global (not tied to a profile):

| Key        | Range   | Default   | Description |
| ---------- | ------ | ------ | ---- |
| `language` | enum   | `auto` | UI language; `auto` follows the system language (`LC_ALL` / `LC_MESSAGES` / `LANG` → `Intl` → `en`), or pin it to `zh` / `en` / `ru` |
| `customEnabled` | bool | `false` | Whether custom profiles may be used |
| `activeProfileId` | string | `default` | The profile currently in effect |

`marginSec` (0–60, default 5) adds extra headroom to `shutdown /t`.

### Retry policies

Each error code is assigned a policy name; the policies themselves are configurable:

| Policy         | Default cadence                               | Assigned to                             |
| ------------ | -------------------------------------- | ---------------------------------- |
| `rate-limit` | backoff 30 → 60 → 120 → 240 → 300, capped | `RATE_LIMIT`                       |
| `transient`  | fixed 20 seconds                             | `SERVER` / `TRANSPORT` / `TIMEOUT` |
| `empty`      | fixed 30 seconds                             | `EMPTY_RESPONSE`                   |
| `offload`    | fixed 5 seconds                              | `IMAGE_OFFLOAD_REQUIRED`           |

Rate limiting uses backoff rather than a fixed interval because hammering a rate-limited service **extends** the limit rather than just wasting requests. 5xx and network failures recover on a predictable timescale, so a fixed interval is simply faster. Image offload is a local disk operation and is almost immediately retryable, hence 5 seconds.

Override a single error code:

```yaml
retryAssign:
  RATE_LIMIT: slow-limit
retryPolicies:
  slow-limit: { mode: backoff, base: 60, max: 900 }
```

An unknown `code` falls back to `transient`; malformed policies are dropped and the defaults are kept. The currently effective assignments are available from `retryAssign` and `retryPolicies` in `/state`.

**Where preferences live**: card look, theme and collapse are pure UI preferences and live in the browser's `localStorage` (`dsh-shutdown-guard.variant` / `.theme` / `.folded`); the compact floating window and the four notification switches are owned by the host (`data/ui.json`); language and the profile keys land in `data/config.json`.

## HTTP API

Prefix `/api/dsh-shutdown-guard`, used by the card's own same-origin polling:

| Method | Path                       | Description                                                                             |
| ---- | -------------------------- | -------------------------------------------------------------------------------- |
| GET  | `/state?since=<ms>`        | Full state plus incremental events                                                              |
| POST | `/arm` `/disarm` `/cancel` | Arm / disarm / cancel this countdown                                                     |
| POST | `/config`                  | Change configuration: `customEnabled`, `activeProfileId`, `profileId`+`patch`, `afkAutoAnswer`, `language` |
| GET  | `/events?since=&limit=`    | Event stream                                                                         |

POSTs from a non-local Origin return 403; non-POST returns 405.

## Logs

- `<plugin directory>\data\events.log` — human-readable event stream (categories `config` / `afk` / `skip`); the settings page's "Event log" reads it
- `<DSH_HOME>\dsh-shutdown-guard.log` — process-level append log

## Development

```bash
node test/host.test.mjs        # server: 26 assertions, mock ctx, never actually shuts down
node test/client.test.cjs      # client bundle smoke test
node scripts/gen-gallery.cjs   # generate the screenshot page from the real CSS in lib/client.js
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1    # headless Edge renders PNGs (transparent background + auto crop)
node scripts/gen-gif.cjs       # generate the three animated GIFs used in the README
node scripts/gen-banner.cjs    # generate the 1280x640 social preview image
node scripts/gen-demo.cjs      # generate docs/demo.html (the interactive demo)
```

All screenshots are generated from the real CSS in `lib/client.js`, so they cannot drift from the product. The animations work the same way: CSS animations are frozen at several points in time via `animation-delay`, captured frame by frame, and assembled with a built-in GIF89a encoder — no ffmpeg or ImageMagick needed on the machine.

The Learn section of the demo page is rendered live too: the six states are generated on the spot with the same `card()` markup as the product, not captured as screenshots.

## FAQ

**Q: Why does changing a setting do nothing?**
A: Both the server and the client need DSH restarted to load new code. Local HMR does not apply to locally linked plugins.

**Q: Why didn't it shut down after arming?**
A: Check "why it did not shut down last time" in settings; it names the specific reason (background jobs, errors, not armed, etc.).

**Q: Can I change my mind during the countdown?**
A: Yes. Use "Cancel shutdown" on the card or just run `shutdown /a`; cancelling keeps it armed, so the next batch still applies.

**Q: Can it shut down by mistake?**
A: With the default configuration, the plugin acts only when all four hold — all sessions idle, no background jobs, no errors, and you armed it manually. Breaking any one of them cancels or skips the shutdown. Manual task termination is also detected and excluded.

**Q: Does it work outside Windows?**
A: Not yet; that is planned for later.

## Constraints

- Windows only: exits early on anything other than `win32` and mounts nothing.
- Zero runtime dependencies: the server uses only `node:fs` / `node:path` / `node:crypto`, the browser only `require('react')`.
- Does not modify `app.asar` or DSH source.

## License

[MIT](LICENSE)
