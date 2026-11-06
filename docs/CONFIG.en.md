# Configuration fields

> Chinese original: [CONFIG.md](CONFIG.md)

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
  "version": 4,
  "activeProfileId": "default",
  "customEnabled": false,
  "lastCustomProfileId": null,
  "language": "auto",
  "parked": null,
  "profiles": [ { "id": "default", "…": "…" } ]
}
```

| Top-level key | Type | Default | Notes |
| --- | --- | --- | --- |
| `version` | number | `4` | schema version; v1.6.1 raised it from 2 to 4 (3 was an in-development transitional shape and was never released) |
| `activeProfileId` | string | `default` | id of the profile in effect |
| `customEnabled` | bool | `false` | whether custom profiles may be used |
| `lastCustomProfileId` | string \| null | `null` | the profile to return to when re-enabled |
| `language` | enum `auto` / `zh` / `en` / `ru` | `auto` | UI language; `auto` follows the system |
| `parked` | object \| null | `null` | the halted scene, see section 5; the only **runtime state** written into the config file |
| `profiles` | array | one `default` | each entry is a behavioural snapshot |

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

**The value the user stored on disk is never rewritten**, so flipping the master switch back and forth never loses the user's original choice; when the master switch is off the settings page merely greys the control out.

## 3. profile fields

Each profile stores its own copy; they do not affect one another.

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `countdownSec` | number 10–600 | `60` | seconds of countdown before shutdown. **locked to 60 on the default profile** |
| `marginSec` | number 0–60 | `5` | extra headroom left for `shutdown /t`. **locked to 5 on the default profile** |
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
| `script` | object \| null | `null` | metadata of the uploaded script (`name` / `ext` / `file` / `bytes` / `sha256` / `savedAt`); the body is on disk, not in the config |
| `scriptAck` | object \| null | `null` | the user's acknowledgement of **this one** script: `{ sha256, at }` |
| `shutdownOnHalt` | bool | `true` | whether the action still runs after a halt (`halted`) |

- `script` and `scriptAck` only mean anything while `action: custom`; `scriptAck.sha256` must equal `script.sha256`, otherwise arming is refused (`script-not-acknowledged`); details in 4.3.
- `shutdownOnHalt: false` means "no action after a halt"; the default `true` matches the old behaviour (a halt only stops waiting for conditions and does not change the action itself).
- All four are in `PROFILE_PATCH_FIELDS`, so they can be set per profile. Note that `shutdownOnHalt` is **not** among the default profile's locked fields (the locked ones are `countdownSec`, `marginSec`, `onlyOnSuccess`, `blockOnJobs`, `afkAutoAnswer`), so the default profile can change it too.

## 4. `action`: what runs at zero

Eight ids, **seven usable**; `restart-dsh` is listed but greyed out.

| id | win32 | macOS | Linux |
| --- | --- | --- | --- |
| `shutdown` | `shutdown /s /t 0` | `osascript` shutdown | `systemctl poweroff` |
| `restart` | `shutdown /r /t 0` | `osascript` restart | `systemctl reboot` |
| `hibernate` | `shutdown /h` | no user-level hibernate command, **degrades to sleep** (`pmset sleepnow`) | `systemctl hibernate` |
| `sleep` | `rundll32 powrprof.dll,SetSuspendState` | `pmset sleepnow` | `systemctl suspend` |
| `lock` | `rundll32 user32.dll,LockWorkStation` | **unsupported** (no supported CLI) | `loginctl lock-session` |
| `signout` | `shutdown /l` | `osascript` sign-out | `loginctl terminate-user`, **which also ends DSH itself** (DSH runs inside that user session) |
| `restart-dsh` | **listed but not selectable today** | same | same |
| `custom` | runs the **user-uploaded script** (see 4.1) | same | same |

- All actions are **inline**: the plugin counts the countdown itself, and at zero it sends **exactly once** — sending means immediate execution. Cancel = nothing is sent.
- Cost: if DSH is killed or crashes during the countdown, the action **will not** run. The old implementation used a system timer (`shutdown /t N`), which would still have shut down in that case. This is a deliberate trade-off — better to miss a shutdown than to shut down wrongly.
- An unknown `action` falls back to `shutdown`: a corrupted config can never produce a state that is "armed with no action at all".
- **Why `restart-dsh` is greyed out**: restarting DSH has to go through `app.relaunch()`, a capability of the Electron main process that the plugin has no path to; `process.exit()` would skip host cleanup and could damage running sessions, so it is deliberately not done. The id is kept so the config file stays readable and can be lit up directly once the host exposes an interface.

### 4.1 A custom action = uploading a script file

`custom` no longer takes a command line — **you upload a file**:

```http
POST /config
{ "putScript": { "profileId": "p1", "name": "End-of-day cleanup", "ext": "ps1", "content": "<script body>" } }
```

| Field | Constraint |
| --- | --- |
| `profileId` | must be an existing profile |
| `name` | display name, 1–40 characters after trimming; it never becomes a path no matter what it says |
| `ext` | whitelist `js` / `cmd` / `bat` / `py` / `ps1`; anything else 400 |
| `content` | UTF-8 text, **at most 256 KiB** (counted in bytes, not characters); over the limit 400 |

- On success the profile's `action` is **forced to `custom`** — uploading a script means you intend to use it.
- Deleting the script: set `script` to `null` (`{"profileId":"p1","patch":{"script":null}}`).
- Storage location: `<DATA_DIR>/scripts/<profileId>.<ext>`. **Not in the npm package directory**: the package directory is replaced wholesale on upgrade and is usually not writable after install; `DATA_DIR` is the plugin's writable directory (`config.json` and `events.log` live there too).
- The file name is generated by the **host**; user input never takes part in building a path, which rules out path traversal; each profile keeps exactly one file, and a new file overwrites the old one.
- The script body **never** enters `config.json`, the event log or `/state` — those only ever carry metadata.
- The whole request body is capped at **1 MiB** (`BODY_LIMIT`): `/config` used to carry only small patches at 8 KiB, but scripts travel as JSON text and roughly double in size after escaping, so the limit was raised; exceeding it drops the connection outright instead of returning 413.

The script's shape inside a profile:

```json
"script": { "name": "End-of-day cleanup", "ext": "ps1", "file": "p1.ps1", "bytes": 412, "sha256": "9f2c…", "savedAt": 1762500000000 }
```

It is `null` when there is no script.

### 4.2 Execution mapping

| `ext` | Actual command | Notes |
| --- | --- | --- |
| `cmd` / `bat` | `cmd /c <path>` | Windows `CreateProcess` will not execute script files, so it must be wrapped in `cmd` |
| `ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <path>` | does not read the user's PowerShell profile; the policy bypass applies to this one invocation only |
| `py` | `python <path>`, falling back to `python3` | neither found → `missing-interpreter` |
| `js` | `node <path>` | node not found → `missing-interpreter` |

Interpreter detection reuses action capability probing (`subprocess.resolveExecutable`), and the result lands in `/state.actions.custom`. When the interpreter is missing or there is no script, the action area shows unavailable with a reason, and arming is refused.

### 4.3 The acknowledgement is bound to the script content

A profile also carries `scriptAck: { "sha256": "9f2c…", "at": 1762500100000 } | null`.

- **Before arming, `scriptAck.sha256 === script.sha256` must hold**, otherwise arming is refused with the reason `script-not-acknowledged`.
- When the script content changes (re-uploaded, different file), `sha256` changes and **the previous acknowledgement becomes invalid automatically**; it must be ticked again. Changing only the display name does not affect `sha256`, and the acknowledgement stays valid.
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
| `no-script` | `action: custom` but no script uploaded yet |
| `missing-interpreter` | the script is there, but none of `python` / `python3` / `node` / `powershell` can be found |
| `needs-elevation` | used for built-in actions on non-win32: availability reports `'unknown'` with this reason — the command was found, but TCC / polkit may require authorisation. **This is a conservative label, not a detection**: on non-Windows there is no way to know in advance whether an authorisation prompt will appear, so it is always marked "may require authorisation" |
| `unsupported-on-platform` | the platform has no honest way to do it (macOS `lock`) |
| `no-host-restart` | `restart-dsh`: Electron's `app.relaunch()` is out of reach |
| `script-not-acknowledged` | the script's `sha256` does not match `scriptAck`; confirmation is needed again |
| `no-cli` | the executable cannot be found during probing (the failure value of `argvReachable`; macOS icon/path problems land here too) |
| `no-session` | kept in the enum; no path currently produces it (an old branch for unavailable sessions) |

The old value `no-custom-command` has been removed (it belonged to the replaced command-line model and was never released).

### 4.6 What each of the four script kinds does on Windows

The user only uploads a file and writes no path at all — the path is generated by the host.

| Uploaded extension | Needs on the machine | Effect of a typical script |
| --- | --- | --- |
| `.cmd` / `.bat` | nothing (`cmd.exe` is always there) | close the browser, archive the logs, then `shutdown /s /t 0` |
| `.ps1` | PowerShell | the same, but it can call .NET / COM directly, e.g. signal a service to stop |
| `.py` | `python` or `python3` | notify over HTTP, clean up temp directories |
| `.js` | `node` | tidy local files, call `fetch` to send a message |

Note: scripts run with **the current user's permissions**; the plugin does not review the content and makes no guarantee about its safety — this is also why the disclaimer must be acknowledged before arming (see 4.3).

## 5. Endpoints

Prefix `/api/dsh-shutdown-guard`; local machine only.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/state?since=<ms>` | full state + incremental events |
| GET | `/events?since=&limit=` | event stream |
| POST | `/arm` `/disarm` `/cancel` | arm / disarm / cancel this countdown |
| POST | `/config` | change **behaviour**: profiles, switches, language, upload/delete scripts |
| POST | `/ui` | change **appearance**: card style, theme, language, floating-window compact mode |

`/config` and `/ui` are two write entry points on the same HTTP service, split by "behaviour / appearance" because the two layers of data live in different files and are consumed by different UIs:

- `/config` writes `data/config.json`. It accepts `customEnabled`, `activeProfileId`, `language`, `profileId` + `patch` (plus a top-level `afkAutoAnswer`), and additionally `putScript` for uploading a script and `recheck:true` for re-probing action capabilities (see 4.1 and 4.4).
- `/ui` writes `data/ui.json`. It accepts `variant` (`A`/`B`/`C`), `theme` (`auto`/`dark`/`light`/`claude`), `lang` (`auto`/`zh`/`en`/`ru`) and `compact` (boolean).
- `/ui` rejects `notify`: notifications are behaviour, not appearance. It returns `400 {"error": "notify belongs to the active profile; use /config updateProfile"}`.

**The default profile is locked.** Writing any of the following fields to `default` yields a 400:

```
{"error": "default profile is locked: <field> cannot change"}
```

`<field>` values: `countdownSec`, `marginSec`, `onlyOnSuccess`, `blockOnJobs`, `afkAutoAnswer`. To change any of these, create a custom profile first.

Other errors: invalid language `400 unknown language`, unknown profile `400 unknown profile`, POST from a non-local Origin `403`, non-POST method `405`.

### Fields in `/state` related to the action layer

| Field | Shape | Notes |
| --- | --- | --- |
| `actions` | `{ [id]: { available, reason } }` | all 8 ids listed, including the hyphenated `restart-dsh`; `{}` after mount and before the first probe |
| `actionReady` | bool | whether the current profile's `action` is available (`available !== false`); `'unknown'` counts as available |
| `lastAction` | object \| null | the last command this process actually dispatched; diagnostics only |
| `parkedAt` | number \| null | when the halt started (only for `halted`), see section 2 |
| `shutdownOnHaltEffective` | bool | the derived rule from section 2 |

The manual re-probe entry point is `POST /config {"recheck": true}`: it reruns capability probing immediately and refreshes `actions`; **no polling**.

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

## 7. Where UI preferences live

| Preference | Stored in | Key |
| --- | --- | --- |
| Card style / theme / folding | browser `localStorage` | `dsh-shutdown-guard.variant` / `.theme` / `.folded` |
| Language / floating-window compact mode / the four notification kinds | host | `data/ui.json` (`notify` actually lands in the profile) |
| Every behaviour tied to a profile | host | `data/config.json` |

`localStorage` is partitioned by storage partition (the sidebar and the floating window may not share one), so state that "both UIs must agree on", such as language and compact mode, is held by the host and delivered as `ui` in every `/state`; `localStorage` is only a first-paint fallback.

## 8. Schema migration

- The current `CONFIG_VERSION = 4`. On read the `version` is checked first: anything below 4 is parsed with the old structure and then written back as `version: 4`.
- v2 → v3 introduced `parked` and per-profile notification switches; v3 → v4 replaced the never-released `customArgv` with **scripts** (that field only existed briefly on the in-progress 1.6.1 branch, and no released version ever wrote it, so nothing is carried over).
- The old `profiles[]` are kept as they are: ids are not changed, entries are not split or reordered, and **values you edited by hand are not lost**.
- New fields (`action`, `script`, `scriptAck`, `shutdownOnHalt`) are filled with defaults when missing: `shutdown` / `null` / `null` / `true`.
- v2 files have no `parked` field, so it reads back as `null` (equivalent to "no halted scene"); there is no old state to carry over.
- Keys such as `afkAutoAnswer` and `notify` that once existed both at the top level and inside a profile: the profile value wins, and the old top-level value is used only when a profile has no value.
- On upgrade, empty profile slots that were never touched are cleaned up; a profile whose name was changed or whose switches were touched is always kept.

## 9. Event log

`data/events.log` is a human-readable append-only stream categorised as `config` / `afk` / `skip`; the "Event log" in the settings page's "Status" tab reads exactly this. The process-level log lives separately at `<DSH_HOME>\dsh-shutdown-guard.log`.
