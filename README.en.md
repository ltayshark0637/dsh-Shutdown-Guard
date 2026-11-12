# Shutdown Guard · Shut down when tasks finish
[中文](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/README.md) · **English** · [Русский](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/README.ru.md)

Stable `v1.6.0` · beta `v1.6.1-beta.5` · [Changelog](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CHANGELOG.md)

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/banner.png" width="880" alt="Shutdown Guard — shut down automatically when every task is done, a night-watch card in the sidebar"></p>

[![DSH](https://img.shields.io/badge/DeepSeek-Harness-blue)](https://github.com/deepseek-ai/deepseek-harness) [![DSH requirement](https://img.shields.io/badge/DSH-%E2%89%A50.1.5--rc.1-4a90d9)](https://github.com/deepseek-ai/deepseek-harness) [![license](https://img.shields.io/npm/l/dsh-shutdown-guard.svg)](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/LICENSE) [![downloads](https://img.shields.io/npm/dm/dsh-shutdown-guard.svg)](https://www.npmjs.com/package/dsh-shutdown-guard) [![demo](https://img.shields.io/badge/%E2%96%B6-interactive%20demo-d97757)](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)

[![npm](https://img.shields.io/badge/npm-dsh--shutdown--guard-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-shutdown-guard) [![awesome-dsh-plugin listed](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/ltayshark0637/dsh-Shutdown-Guard/) [![dsh-plugin.org listed](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/ltayshark0637/dsh-shutdown-guard) [![dpharness listed](https://img.shields.io/badge/dpharness-listed-6f42c1)](https://dpharness.com/plugin/ltayshark0637/dsh-Shutdown-Guard) [![dshbase install-tested](https://dshbase.com/badges/dsh-shutdown-guard.svg)](https://dshbase.com/plugins/dsh-shutdown-guard/) [![dsh.so runtime-tested](https://cdn.dsh.so/badge/dsh-shutdown-guard.svg)](https://www.dsh.so/artifact/dsh-shutdown-guard/?ref=badge)

Adds a "shut down when every task is done" card to the DeepSeek Harness sidebar — right under Skill Centre and above the session list, following the task state live.

It does not shut down the moment a task ends. Background jobs still running, a session that errored, an agent waiting for your answer: each of those blocks it. It only acts when shutting down is genuinely safe, and it writes the reason on the card.

**▶ [Interactive demo](https://ltayshark0637.github.io/dsh-Shutdown-Guard/demo.html)** — see what it looks like and how it decides without installing anything. All data is generated locally; nothing leaves your machine.

## Installation

Published on npm — this is the recommended route:

```bash
dsh plugin --profile web add dsh-shutdown-guard
```

The beta needs an explicit version; without one you get the stable `1.6.0`:

```bash
dsh plugin --profile web add dsh-shutdown-guard@1.6.1-beta.5
```

Or straight from GitHub:

```bash
dsh plugin --profile web add github:ltayshark0637/dsh-Shutdown-Guard
```

It installs into the DSH plugin directory. Afterwards, quit DSH completely and start it again — a page refresh is not enough.

> On a restricted network prefer the npm route (it goes through the registry). The GitHub route is really `pnpm add github:...` and needs a clone; if that fails, install from a local path: DSH Settings → Plugins → Add, enter the absolute path to this directory → install → restart.

## Three looks

| Minimal (light) | Radar (light) | Terminal (light) |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/01-armed-a-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/07-armed-b-zh-light.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/13-armed-c-zh-light.png" width="250"> |

| Minimal (dark) | Radar (dark) | Terminal (dark) |
|:---:|:---:|:---:|
| <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/02-armed-a-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/08-armed-b-zh-dark.png" width="250"> | <img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/14-armed-c-zh-dark.png" width="250"> |

One card, three ways to draw it: Minimal keeps a big headline and one line, Radar turns sessions and jobs into dots that never reshuffle, Terminal writes three command lines plus six condition LEDs. Pick a thumbnail on the Appearance page of the settings and it applies immediately — no restart — and the thumbnails follow your UI language and background.

The hazard tape along the bottom of the card and of the floating window follows the state: from stand-by on it is the classic red-and-yellow, while disarmed or blocked it settles into two quiet tonal steps of the same hue, with a 280 ms cross-fade and no flicker.

The window icon at the right of the card header pulls the card out into a floating window you can park in a corner and keep watching; its look, theme and language all follow the settings.

## Settings

<p align="center"><img src="https://ltayshark0637.github.io/dsh-Shutdown-Guard/screenshots/12-settings-dark.png" width="380" alt="Settings page (dark)"></p>

Four tabs; it opens on Appearance and every switch applies immediately.

- **Appearance**: card style (three thumbnailed cards, thumbnails following UI language and background), theme, fold by default, compact floating window, UI language.
- **Watch**: the "custom profile" switch on its own, then the profile list (switch, set as default, rename, delete, create) once it is on; below that the four gating rows, "AFK auto-answer", and the **what to do at the deadline** picker (shut down / restart / sleep / hibernate / lock screen / sign out / custom script).
- **Notifications**: one master switch plus four per-event switches (countdown started, about to shut down, first block, block cleared).
- **Status**: current block, why it did not shut down last time, recent events.

## FAQ

**Q: Can it shut down by mistake?**
A: The default profile requires all four of "every session idle", "no background jobs", "no errors in the batch" and "you armed it yourself"; breaking any one cancels or skips the run, and a task you stopped by hand is already excluded.

**Q: I armed it, why didn't it shut down?**
A: Open Status → "why it did not shut down last time"; it names the reason (background jobs, errors, not armed, …).

**Q: Can I back out during the countdown?**
A: Yes — use the "cancel shutdown" button on the card. Cancelling sends **no command at all** for that round, and it stays armed for the next batch; once a command has gone out it cannot be taken back.

**Q: I changed a setting and nothing happened.**
A: Both the host and the client bundle load only when DSH starts; HMR does not apply to locally linked plugins.

**Q: Does it support macOS and Linux?**
A: Per platform, and the distinction matters:

- **Windows**: fully verified, including actually running shutdown / restart / sleep.
- **macOS**: **shutdown has been verified on real hardware — it actually shut the machine down** (Apple Silicon / macOS 27.2 / DSH Desktop, plugin `1.6.1-beta.3`): the plugin sent the command, the system accepted it, and the machine powered off. **Provided no app is blocking shutdown** — a terminal running a foreground command or an editor with unsaved changes makes macOS stop it and wait for confirmation, exactly like a manual "Shut Down" from the Apple menu. Restart, sign out, sleep and hibernate have **not** been verified on real hardware yet.
- **Linux**: **all six actions have been verified on real hardware** (Ubuntu 24.04.5 LTS / desktop session, plugin `1.6.1-beta.5`): shutdown, restart, sleep, hibernate, lock and sign out all really execute. **Known limitation**: "sign out" ends the whole login session, so DSH exits with it and no further events are recorded — that is the meaning of `loginctl terminate-user`, not a defect. **Not verified yet**: automatic retries under real rate limiting / timeouts, and whether the armed state survives a plugin reload.

On macOS, probing reports `"unknown"` rather than `true`: the system may only decide at the moment of execution. `"unknown"` means "you can arm with it, but the OS decides at that moment" — it is not a fault.

## More

The technical details live in their own files: [architecture and gating](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.en.md) · [configuration keys](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/CONFIG.en.md) · [local development](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/DEVELOPING.en.md) · [beta testing guide](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/BETA.en.md) · [contributing guide](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/CONTRIBUTING.en.md)

Also available in [Chinese](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.md) and [Russian](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/docs/ARCHITECTURE.ru.md).

## License

[MIT](https://github.com/ltayshark0637/dsh-Shutdown-Guard/blob/main/LICENSE)
