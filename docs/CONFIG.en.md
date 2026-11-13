# Configuration fields

> [中文](CONFIG.md) · **English** · [Русский](CONFIG.ru.md)

For maintainers and for people who want to hand-edit the config. The user-facing settings guide is in [README](../README.en.md).
The gating logic and the motivation behind retries are in [ARCHITECTURE](./ARCHITECTURE.en.md).

## 1. Three sources and their precedence

From low to high:

1. `cordis.patch.yml` — the factory patch inside the plugin package
2. `data/config.json` — runtime persistence; whatever the settings page changes lands here
3. `POST /config`, `POST /ui` — runtime changes, which are persisted the same way

The settings page never bypasses layer 2: every change it makes goes through the same write-to-disk function (`saveStore()`).

## 2. The shape of `data/config.json`

```json
{
  "version": 5,
  "activeProfileId": "default",
  "customEnabled": false,
  "lastCustomProfileId": null,
  "language": "auto",
  "parked": null,
  "scriptSeq": 2,
  "scripts": [ { "id": "s1", "…": "…" } ],
  "profiles": [ { "id": "default", "…": "…" } ]
}
```

| Top-level key | Type | Default | Notes |
| --- | --- | --- | --- |
| `version` | number | `5` | schema version; v1.6.1 took it from 2 to 4, and the script library pushed it to 5 |
| `activeProfileId` | string | `default` | id of the profile in effect |
| `customEnabled` | bool | `false` | whether custom profiles may be used |
| `lastCustomProfileId` | string \| null | `null` | the profile to return to when re-enabled |
| `language` | enum `auto` / `zh` / `en` / `ru` | `auto` | UI language; `auto` follows the system |
| `parked` | object \| null | `null` | the halted scene, see `### parked` below in this section; the only **runtime state** written into the config file |
| `scriptSeq` | number | `0` | id issuer for scripts, only ever increases; deleted ids are never reused |
| `scripts` | array | `[]` | the **globally shared** script library, metadata only, see `### scripts[]` |
| `profiles` | array | one `default` | each entry is a behavioural snapshot |

### `scripts[]`: the shared script library

A script used to be a field of one profile; it is now a **top-level shared library**: one file is one record, any number of profiles point at it through `scriptId`, and acknowledging it once covers every profile that points at it.

```json
{
  "id": "s1",
  "name": "wrap up",
  "ext": "ps1",
  "file": "s1.ps1",
  "bytes": 412,
  "sha256": "9f2c…",
  "savedAt": 1762500000000,
  "ack": { "sha256": "9f2c…", "at": 1762500100000 }
}
```

| Key | Type | Notes |
| --- | --- | --- |
| `id` | `s1` / `s2` … | issued by `scriptSeq`, never reused; must match `^s[1-9][0-9]*$` on read-back, otherwise the whole record is dropped |
| `name` | string | display name, 1–40 characters; UI only, never part of a path |
| `ext` | enum `js` / `cmd` / `bat` / `py` / `ps1` | decides which interpreter runs it |
| `file` | string | **must** be exactly `<id>.<ext>`, otherwise the record is dropped — hand-editing the config cannot point the runner at an arbitrary path |
| `bytes` | number | file size, display only |
| `sha256` | 64 hex characters | hash of the content when it was stored, and what the acknowledgement is pinned to |
| `savedAt` | number | when it entered the library |
| `ack` | object \| null | `{ sha256, at }`; dropped on read-back when its `sha256` no longer matches the record (treated as unacknowledged) |

- The body lives **only** on disk: `<plugin directory>/data/scripts/<scriptId>.<ext>` (that is `DATA_DIR/scripts`). It never enters `config.json`, the event log or `/state`. **That directory is inside the plugin package directory**: it is not published in the npm tarball, but an `npm i` upgrade replaces the whole package directory — back up `data/config.json` and `data/scripts/` before upgrading.
- A deleted file or a hand-edited one does not make the record disappear: the first makes `custom` report `no-script`, the second makes it report `script-not-acknowledged` (see 4.5).
- A profile only stores `scriptId` (`null` meaning nothing selected); `script` and `scriptAck` **no longer exist**, and writing them is rejected with `400` (see 4.1).

UI appearance (card style / theme / folding / floating-window compact mode) is **not** in this file; see section 7.

### `parked`: the only runtime state written into the config

```json
{ "code": "RATE_LIMIT", "level": "halted", "reasonKey": "halted.RATE_LIMIT", "at": 1762400000000 }
```

- **Only `halted` is persisted.** `waiting` has a timer and recovers on its own; storing it would turn into "still waiting forever after a restart".
- On read-back `code` must be in `HALTED_CODES`, otherwise the whole entry is dropped (`null`): an unknown code renders an empty reason, which is worse than forgetting it.
- **Clear boundaries**:
  - Cleared: arm, disarm, a successful turn, `shutdownOnHalt` firing.
  - Not cleared: restart, profile switch, language change, appearance change — none of those change the fact that "this batch has already been halted".
- `/state`'s `parkedAt` is its timestamp (`null` when not halted), used by the UI to show "last halted 3 hours ago".

### The effective value of `shutdownOnHalt`

The switch shown on the settings page is the derived value `shutdownOnHaltEffective`; the master switch is `onlyOnSuccess`:

| Condition | Effective value |
| --- | --- |
| `onlyOnSuccess: false` (master switch off) | forced `false` |
| `onlyOnSuccess: true` | honours the `shutdownOnHalt` the user stored |

**The value the user stored on disk is never rewritten**, so flipping the master switch back and forth never loses the user's original choice; when the master switch is off the settings page merely makes the control unclickable (the value is kept).

## 3. profile fields

Each profile stores its own copy; they do not affect one another.

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `countdownSec` | number 10–600 | `60` | seconds of countdown before shutdown. **locked to 60 on the default profile** |
| `marginSec` | number 0–60 | `5` | how much longer the card keeps showing the countdown after the command has gone out (plus a fixed 5 seconds); it does not move the moment the command fires and has nothing to do with system timers, see ARCHITECTURE section 3. **locked to 5 on the default profile** |
| `onlyOnSuccess` | bool | `true` | skip when any session in the batch reported an error. **locked to `true` on the default profile** |
| `blockOnJobs` | bool | `true` | skip while background jobs are running. **locked to `true` on the default profile** |
| `afkAutoAnswer` | bool | `true` | answer questions and do error recovery on the user's behalf while armed. **locked to `true` on the default profile** |
| `notify` | object | all four `true` | `{ countdown, fired, blocked, recovered }`, one boolean each |
| `retrySec` | number 10–600 | `30` | fallback retry interval when no named policy matches |
| `retryPolicies` | object | see section 6 | policy name → `{ mode: 'backoff', base, max }` or `{ mode: 'fixed', every }` |
| `retryAssign` | object | see section 6 | error code → policy name |

**New in v1.6.1 (already in the schema)**

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `action` | enum (8 ids) | `shutdown` | what to run when tasks finish, see section 4 |
| `scriptId` | string \| null | `null` | which entry of the shared script library this profile uses; the script itself is not stored per profile any more |
| `shutdownOnHalt` | bool | `true` | whether the action still runs after a halt (`halted`) |

- `scriptId` only means anything while `action: custom`; if the file is missing you get `no-script`, if it does not match the acknowledged bytes you get `script-not-acknowledged`; details in 4.3.
- Writing `script` or `scriptAck` into a profile patch is rejected with `400` — see section 5.
- `shutdownOnHalt: false` means "no action after a halt"; the default `true` matches the old behaviour (a halt only stops waiting for conditions and does not change the action itself).
- All four are in `PROFILE_PATCH_FIELDS`, so they can be set per profile. Note that `shutdownOnHalt` is **not** among the default profile's locked fields (the locked ones are `countdownSec`, `marginSec`, `onlyOnSuccess`, `blockOnJobs`, `afkAutoAnswer`), so the default profile can change it too.

## 4. `action`: what runs at zero

Eight action ids exist and **all of them can run**; whether one shows up in the menu depends on this machine and the switch (next paragraph).

**What is visible by default**: with "custom profiles" off, **on Windows** only the custom script needs that switch — lock goes through `rundll32 user32.dll,LockWorkStation` and sign out through `shutdown /l`, plain commands running with your own rights, so they are selectable right away; **on macOS and Linux** lock, sign out and the custom script stay behind the switch, because those three borrow the desktop's own tooling (`pmset`, `loginctl`, `osascript`) and vary far too much between environments. Turning the switch on is what makes the whole custom-script block (file picker, display name, warning and confirmation) appear in the settings page; the block is also only rendered when the action is set to the custom script.

**An action this machine cannot run does not appear in the menu at all** — it is not left behind as a dead entry. Actions that can only be probed as `'unknown'` (the system actions on macOS and Linux) stay selectable: whether they really run is decided by the OS at that moment, and a failure is explained on the card. If a profile still stores `custom` while the switch is off, the top of the dropdown keeps an unselectable "Custom script (unavailable)" placeholder; it disappears as soon as the value changes to one of the listed actions — otherwise the dropdown would look blank and say nothing.

| id | win32 | macOS | Linux |
| --- | --- | --- | --- |
| `shutdown` | `shutdown /s /t 0` | `osascript` shutdown | `systemctl poweroff` |
| `restart` | `shutdown /r /t 0` | `osascript` restart | `systemctl reboot` |
| `hibernate` | `shutdown /h` | no user-level hibernate command, **degrades to sleep** (`pmset sleepnow`) | `systemctl hibernate` |
| `sleep` | `rundll32 powrprof.dll,SetSuspendState` | `pmset sleepnow` | `systemctl suspend` |
| `lock` | `rundll32 user32.dll,LockWorkStation` | **unsupported** (no supported CLI) | `loginctl lock-session` |
| `signout` | `shutdown /l` | `osascript` sign-out | `loginctl terminate-user`, **which also ends DSH itself** (DSH runs inside that user session) |
| `restart-dsh` | ends the host process and starts it again (on the desktop build the whole app exits and comes back) | same | same |
| `custom` | runs the **script selected from the library** (see 4.1) | same | same |

- All actions are **inline**: the plugin counts the countdown itself, and at zero it sends **exactly once** — sending means immediate execution. Cancel = nothing is sent.
- Cost: if DSH is killed or crashes during the countdown, the action **will not** run. The old implementation used a system timer (`shutdown /t N`), which would still have shut down in that case. This is a deliberate trade-off — better to miss a shutdown than to shut down wrongly.
- An unknown `action` falls back to `shutdown`: a corrupted config can never produce a state that is "armed with no action at all".
- **How `restart-dsh` works**: the plugin calls no internal host API; it writes a one-shot helper into the plugin data directory that first ends the host process and then starts the same executable again — on the desktop build the whole app exits and comes back, on the command line it is the same command with its original arguments. The run goes to `data/restart.log`, the outcome to `data/restart.status`, and the next launch reads that and records "restart completed" in the event log. If `dsh-autorestart` is installed it owns restarts and this plugin stays out of the way — two restarters would race over the same process.

### 4.1 A custom action = one file picked from the script library

`custom` takes no command line; it runs one entry of the **script library**. The library is global: one upload is one record, and any number of profiles may point at it.

```http
POST /config
{ "putScript": { "name": "End-of-day cleanup", "ext": "ps1", "content": "<script body>" } }
```

| Field | Constraint |
| --- | --- |
| `name` | display name, 1–40 characters after trimming; whatever it says, it never becomes a path |
| `ext` | whitelist `js` / `cmd` / `bat` / `py` / `ps1`; anything else 400 |
| `content` | UTF-8 text, **at most 256 KiB** (counted in bytes, not characters); over the limit 400 |
| `profileId` | **optional**. When given, the new entry is also selected for that profile and its `action` is set to `custom`; without it the entry is only stored |

- **Deduplication**: an entry with the same `sha256` and the same `ext` is reused, the response says `reused: true`, and the existing entry's `name` is **not** overwritten (a duplicate upload must not quietly rename somebody else's entry).
- If the entry exists but its file was hand-edited or deleted, uploading the same content again **repairs the file** instead of storing a second copy.
- Storage location: `<plugin directory>/data/scripts/<scriptId>.<ext>` (`PLUGIN_DIR/data/scripts`; `config.json` and `events.log` live in the same `data/`). **This is inside the plugin package directory**: `data/` is not published in the npm tarball, but an upgrade replaces the whole package directory, so back it up first.
- The file name is generated by the **host** (`<scriptId>.<ext>`); user input never takes part in building a path, which rules out path traversal.
- The script body **never** enters `config.json`, the event log or `/state` — those only ever carry metadata.
- The whole request body is capped at **1 MiB** (`BODY_LIMIT`): `/config` used to carry only small patches at 8 KiB, but scripts travel as JSON text and roughly double in size after escaping, so the limit was raised; exceeding it drops the connection outright instead of returning 413.

The rest of the library operations also live on `POST /config`, one key per request:

| Key | Body | Behaviour |
| --- | --- | --- |
| `selectScript` | `{ profileId, scriptId }` | select an entry for that profile (`scriptId: null` clears it); selecting also sets `action` to `custom`; an unknown id is `400 unknown script` |
| `renameScript` | `{ scriptId, name }` | display name only, 1–40 characters; `sha256` is untouched, so the acknowledgement stays valid |
| `deleteScript` | `{ scriptId }` | deletes the entry and its file; **an entry still used by profiles may be deleted**, those profiles fall back to having no script, and `affected` in the response is how many profiles were hit |
| `ackScript` | `{ scriptId }` | records "I acknowledge this content"; the host writes `ack` from the current `sha256` |
| `unackScript` | `{ scriptId }` | withdraws the acknowledgement |

See `### scripts[]` in section 2 for the entry shape. A profile only stores `scriptId`.

### 4.2 Execution mapping

| `ext` | Actual command | Notes |
| --- | --- | --- |
| `cmd` / `bat` | `cmd /c <path>` | Windows `CreateProcess` will not execute script files, so it must be wrapped in `cmd` |
| `ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <path>` | does not read the user's PowerShell profile; the policy bypass applies to this one invocation only |
| `py` | `python <path>`, falling back to `python3` | neither found → `missing-interpreter` |
| `js` | `node <path>` | node not found → `missing-interpreter` |

Interpreter detection reuses action capability probing (`subprocess.resolveExecutable`), and the result lands in `/state.actions.custom`. When the interpreter is missing or there is no script, the action area shows unavailable with a reason, and arming is refused.

### 4.3 The acknowledgement is pinned to the library entry's bytes

The acknowledgement belongs to the library entry (`scripts[].ack`), not to a profile:

- **Before arming, `ack.sha256 === that entry's sha256` must hold**, otherwise arming is refused with the reason `script-not-acknowledged`.
- When the entry's content changes (re-uploaded as different bytes), `sha256` changes and **the previous acknowledgement becomes invalid automatically**; it must be ticked again. Changing only the display name does not affect `sha256`, and the acknowledgement stays valid.
- If the file on disk was hand-edited so its bytes no longer match the recorded `sha256`, you get `script-not-acknowledged` as well — what you acknowledge is the content, not the file name.
- Acknowledge once and every profile pointing at that entry counts as acknowledged; withdraw once and they all lose it.
- This guards against "confirm once, then swap the file for something else" — an acknowledgement that lasts a lifetime after one tick is no acknowledgement at all.

### 4.4 Capability probing and the three-state value

Probing runs once at mount, and afterwards only on `POST /config {recheck:true}`; there is **no polling**. Each entry of `/state.actions` is `{ available, reason }`:

| `available` | Meaning |
| --- | --- |
| `true` | the command resolves and the system has no further veto behind it (win32 `shutdown` and the like) |
| `false` | the platform has no honest command, the command does not exist, the interpreter is missing, there is no script, or the acknowledgement blocks it |
| `'unknown'` | the command exists, but macOS (TCC) or Linux (polkit) may refuse at the last moment — reporting `true` here would be a lie |

On non-win32 every resolvable command reports `'unknown'`, never `true`.
If a re-probe finds that the **currently selected action** has become unavailable, the host only raises a flag (`/state.actionReady === false`; the card and the settings page show a hint) and **does not change the user's selection**.

### 4.5 The `reason` enum

`/state` emits protocol strings only; the settings page turns them into plain language.

| Value | When it appears |
| --- | --- |
| `no-custom-profile` | "custom profiles" is off so the action is unavailable: on Windows only `custom` hits this, on macOS / Linux `lock` and `signout` hit it too |
| `no-script` | `action: custom` but no script is selected, or the selected entry's file has been deleted |
| `missing-interpreter` | the script is there, but none of `python` / `python3` / `node` / `powershell` can be found |
| `needs-elevation` | used for built-in actions on non-win32: availability reports `'unknown'` with this reason — the command was found, but TCC / polkit may require authorisation. **This is a conservative label for "cannot be probed reliably", not a detection result**: do not read it as "needs sudo"; on a real Ubuntu 24.04.5 LTS desktop all six actions ran without any extra elevation |
| `unsupported-on-platform` | the platform has no honest way to do it (macOS `lock`) |
| `no-host-restart` | `restart-dsh`: this environment has no host executable that can be restarted safely |
| `host-restart-taken` | `restart-dsh`: `dsh-autorestart` is installed and owns restarts, so this one steps aside |
| `script-not-acknowledged` | never acknowledged, or the acknowledged bytes no longer match what is on disk — including a hand-edited file |
| `no-cli` | the executable cannot be found during probing (the failure value of `argvReachable`; macOS icon/path problems land here too) |
| `no-session` | kept in the enum; no path currently produces it (an old branch for unavailable sessions) |

The old value `no-custom-command` has been removed (it belonged to the replaced command-line model and was never released).

The boundary of `no-custom-profile`: it is decided by the "custom profiles" switch (plus the platform difference) and says nothing about whether anything is configured. On Windows only `custom` hits it; on macOS / Linux `lock` and `signout` do too. `custom` with the switch on but no script selected reports `no-script` — one says "this action is not open on this machine", the other says "it is open, but you have not set it up yet", and the two must not be conflated.

### 4.6 What each of the four script kinds does on Windows

The user only picks a file from the library and writes no path at all — the path is generated by the host.

| Uploaded extension | Needs on the machine | Effect of a typical script |
| --- | --- | --- |
| `.cmd` / `.bat` | nothing (`cmd.exe` is always there) | close the browser, archive the logs, then `shutdown /s /t 0` |
| `.ps1` | PowerShell | the same, but it can call .NET / COM directly, e.g. signal a service to stop |
| `.py` | `python` or `python3` | notify over HTTP, clean up temp directories |
| `.js` | `node` | tidy local files, call `fetch` to send a message |

Note: scripts run with **the current user's permissions**; the plugin does not review the content and makes no guarantee about its safety — this is also why the disclaimer must be acknowledged before arming (see 4.3).

### 4.7 The elevated retry on Linux

Only Linux has this layer. When one of `shutdown` / `restart` / `sleep` / `hibernate` / `lock` / `signout` exits **non-zero for the first time**, the host retries it **once** through `pkexec`:

- `pkexec` asks polkit for consent and runs the same command as root, so an authentication dialog may appear; the single wait is capped at 120 seconds (ordinary actions get 15).
- A command that exited 0 is **never** sent again — one shutdown is never delivered twice.
- `custom` scripts are **never** elevated: that is the user's own script and always runs as the current user.

The risk is stated plainly: this retry assumes that "non-zero exit" means "did not run". If a command **did have a side effect yet still returned non-zero**, it would in theory run twice — in the extreme, a shutdown or sign-out could be repeated once. That is accepted because a half-failed power action needs the elevated attempt more, and sending one extra shutdown costs less than a machine that never powers off.

## 5. Endpoints

Prefix `/api/dsh-shutdown-guard`; local machine only.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/state?since=<ms>` | full state + incremental events |
| GET | `/events?since=&limit=` | event stream |
| POST | `/arm` `/disarm` `/cancel` | arm / disarm / cancel this countdown |
| POST | `/unblock` | clear the block only (halted or waiting); never changes the armed state; 200 with no event when nothing is blocked |
| POST | `/config` | change **behaviour**: profiles, switches, language, script-library operations |
| POST | `/ui` | change **appearance**: card style, theme, language, floating-window compact mode |

`/config` and `/ui` are two write entry points on the same HTTP service, split by "behaviour / appearance" because the two layers of data live in different files and are consumed by different UIs:

- `/config` writes `data/config.json`. It accepts `customEnabled`, `activeProfileId`, `language`, `profileId` + `patch` (plus a top-level `afkAutoAnswer`), and the script-library keys `putScript`, `selectScript`, `renameScript`, `deleteScript`, `ackScript`, `unackScript` (see 4.1), as well as `recheck:true` for re-probing action capabilities (see 4.4).
- `/ui` writes `data/ui.json`. It accepts `variant` (`A`/`B`/`C`), `theme` (`auto`/`dark`/`light`/`claude`), `lang` (`auto`/`zh`/`en`/`ru`) and `compact` (boolean).
- `/ui` rejects `notify`: notifications are behaviour, not appearance. It returns `400 {"error": "notify belongs to the active profile; use /config updateProfile"}`.

**The default profile is locked.** Writing any of the following fields to `default` yields a 400:

```
{"error": "default profile is locked: <field> cannot change"}
```

`<field>` values: `countdownSec`, `marginSec`, `onlyOnSuccess`, `blockOnJobs`, `afkAutoAnswer`. To change any of these, create a custom profile first.

Other errors: invalid language `400 unknown language`, unknown profile `400 unknown profile`, unknown script `400 unknown script`, POST from a non-local Origin `403`, non-POST method `405`.

Writing the old fields is rejected explicitly rather than quietly ignored — otherwise a beta client would believe its upload or acknowledgement went through:

| Written | Response |
| --- | --- |
| `patch.script` | `400 script must be uploaded through the script library` |
| `patch.scriptAck` | `400 scriptAck can only be written by acknowledging a library script` |

### Fields in `/state` related to the action layer

| Field | Shape | Notes |
| --- | --- | --- |
| `actions` | `{ [id]: { available, reason } }` | all 8 ids listed, including the hyphenated `restart-dsh`; `{}` after mount and before the first probe |
| `actionReady` | bool | whether the current profile's `action` is available (`available !== false`); `'unknown'` counts as available |
| `script` | object \| null | metadata of the entry the current profile uses (`name` / `ext` / `bytes` / `sha256` / `savedAt`); **no body, no file name** |
| `scriptAckOk` | bool | whether the current entry is acknowledged and still byte-identical |
| `scripts` | array | metadata of the whole library, each `{ id, name, ext, bytes, sha256, savedAt, ackOk, ackAt, usedBy }`; again never the body |
| `lastAction` | object \| null | the last command this process actually dispatched; diagnostics only; `{ action, at, argv, code, failed, error?, elevated? }` |
| `lastAction.failed` | bool | the verdict for that command: non-zero exit, or the spawn itself failed. "Ran" and "worked" are different answers; this field only answers the latter |
| `lastAction.elevated` | bool (may be absent) | `true` only when the Linux `pkexec` retry happened; when there was no retry the key is absent — do not read that as `false` |
| `parkedAt` | number \| null | when the halt started (only for `halted`), see section 2 |
| `shutdownOnHaltEffective` | bool | the derived rule from section 2 |

`script` / `scriptAck` inside `profiles[]` are a **compatibility projection**: filled in from the library by that profile's `scriptId` so the settings page can render one row without walking `scripts[]`. The authoritative data is the top-level `scripts[]`.

The manual re-probe entry point is `POST /config {"recheck": true}`: it reruns capability probing immediately and refreshes `actions`; **no polling**.

### The `/arm` refusal contract

When the action cannot run, `POST /arm` does **not** arm and then fail: it refuses up front with **409**, and the body is `{ error: <reason>, ...statePayload() }` — you still get a full state payload, and `armed` stays `false`. The value of `error` comes from `armRefusal()`:

| `error` | When |
| --- | --- |
| `no-script` | `action: custom`, but no script is selected or the selected file has been deleted |
| `script-not-acknowledged` | the selected script was never acknowledged, or the bytes on disk differ from the acknowledged ones |
| that action's probe `reason` | probing already found it unavailable (`no-script`, `missing-interpreter`, `no-cli`, …; `no-custom-profile` only when that action is behind the switch) |
| `action-unavailable` | fallback: no specific reason available, but the action really cannot run |

The UI shows that refusal reason instead of a switch that pretends to have armed.

## 6. Retry policies

Each error code is assigned a policy name, and the policies themselves are configurable:

| Policy | Default cadence | Assigned to |
| --- | --- | --- |
| `rate-limit` | backoff 30 → 60 → 120 → 240 → 300, capped | `RATE_LIMIT` |
| `transient` | fixed 20 seconds | `SERVER` / `TRANSPORT` / `TIMEOUT` |
| `empty` | fixed 30 seconds | `EMPTY_RESPONSE` |
| `offload` | fixed 5 seconds | `IMAGE_OFFLOAD_REQUIRED` |

Rate limiting uses backoff rather than a fixed interval because retrying a rate-limited service at high frequency **extends** the rate-limit period instead of merely wasting requests; 5xx and network failures recover in a predictable time, so a fixed interval is actually faster; image offload is a local disk operation and is retryable almost immediately.

Overriding a single error code:

```yaml
retryAssign:
  RATE_LIMIT: slow-limit
retryPolicies:
  slow-limit: { mode: backoff, base: 60, max: 900 }
```

An unknown `code` falls back to `transient`; a policy with a malformed shape is dropped and the default is kept. The live assignments can be read from `retryAssign` and `retryPolicies` in `/state`.

**No timer, no promise of a retry**: when the host cannot provide a timer, `retryAt` is set to `0`, the log gets one `log.retryUnavailable` entry, and the UI stops showing "retrying in N seconds". Better to say "will not retry automatically" than to show a countdown that never arrives.

## 7. Where UI preferences live

| Preference | Stored in | Key |
| --- | --- | --- |
| Card style / theme / folding | browser `localStorage` | `dsh-shutdown-guard.variant` / `.theme` / `.folded` |
| Language / floating-window compact mode / the four notification kinds | host | `data/ui.json` (`notify` actually lands in the profile) |
| Every behaviour tied to a profile | host | `data/config.json` |

`localStorage` is partitioned by storage partition (the sidebar and the floating window may not share one), so state that "both UIs must agree on", such as language and compact mode, is held by the host and delivered as `ui` in every `/state`; `localStorage` is only a first-paint fallback.

## 8. Schema migration

- The current `CONFIG_VERSION = 5`. On read the `version` is checked first: anything below 5 is parsed with the old structure and then written back as `version: 5`.
- v2 → v3 introduced `parked` and per-profile notification switches; v3 → v4 replaced the never-released `customArgv` with **scripts** (that field only existed briefly on the in-progress 1.6.1 branch, and no released version ever wrote it, so nothing is carried over); v4 → v5 moved "one script per profile" into a **shared top-level library**.
- **The v4 → v5 move** (2 / 3 / 4 all upgrade straight to 5):
  - Each profile's `script` metadata becomes one entry in the library, the file is renamed from `<profileId>.<ext>` to `<scriptId>.<ext>`, and the profile keeps only `scriptId`.
  - **Old files with the same `sha256` and the same `ext` merge into one entry**, duplicate copies are deleted, and the acknowledgement (`scriptAck`) is carried over to the merged entry.
  - The move is followed by an **immediate write to disk**: `scripts[]` and the renamed files have to land together; waiting for the user's next write would leave orphaned files behind if the process is killed in between.
- The old `profiles[]` are kept as they are: ids are not changed, entries are not split or reordered, and **values you edited by hand are not lost**.
- New fields (`action`, `scriptId`, `shutdownOnHalt`, `scripts`, `scriptSeq`) are filled with defaults when missing: `shutdown` / `null` / `true` / `[]` / `0`.
- v2 files have no `parked` field, so it reads back as `null` (equivalent to "no halted scene"); there is no old state to carry over.
- Keys such as `afkAutoAnswer` and `notify` that once existed both at the top level and inside a profile: the profile value wins, and the old top-level value is used only when a profile has no value.
- On upgrade, empty profile slots that were never touched are cleaned up; a profile whose name was changed or whose switches were touched is always kept.
- The migration works field by field and is idempotent: once `script` has been moved the field is gone, so reading again does not import it twice.

## 9. Event log

`data/events.log` is a human-readable append-only stream categorised as `config` / `afk` / `skip`; the "Event log" in the settings page's "Status" tab reads exactly this. The process-level log lives separately at `<DSH_HOME>\dsh-shutdown-guard.log`.
