# Testing and verification guide for v1.6.2

> [中文](BETA.md) · **English** · [Русский](BETA.ru.md)

## 1. What this version is

`1.6.2` is the **stable release**; this document is kept as a regression checklist you can still walk through after release.

- To re-verify a specific behaviour, follow section 3 item by item; those expectations hold on 1.6.2.
- Install with an explicit version number (see section 2) so a moving `latest` can never install something else.
- Behaviour may keep evolving after 1.6.2; this document is authoritative for the documentation.

## 2. How to install

```bash
npm i -g dsh-shutdown-guard@1.6.2
```

After installing, **fully quit DSH and start it again** (on macOS, quit with ⌘Q — closing the window or refreshing the page does not count). The client bundle is compiled into the module graph only at startup, so closing the window or refreshing never loads new code; the same applies after you change code or upgrade the plugin.

If you are on 1.6.1, just install 1.6.2 over it — every item and expected behaviour here describes 1.6.2.

**Back up `data/config.json` and `data/scripts/` before upgrading**: they live inside the plugin package directory, and `npm i` replaces that whole directory (reason: antepenultimate item in section 4).

Rollback:

```bash
npm i -g dsh-shutdown-guard@1.6.1
```

(If the local PowerShell forbids `npm.ps1`, use `npm.cmd`.)

Platform: the `os` restriction in `package.json` has been removed, so macOS and Linux can now `npm install` normally (for behavioural maturity see 3.6).

Upgrading from beta.1 **needs no manual migration**: the config schema was finalised as 4 in beta.1 and the script library took it to 5; later versions only change behaviour, not the config format — install and restart DSH.

## 3. What to test in this version

Each item is written as "how to act / what you should see / what it looks like when it fails". Report results as described in section 5.

**Arm the card first.** The plugin does not start a countdown just because a task finished — the order is "arm the card, then run the work". If you never arm it, nothing happens no matter how long you wait.

### 3.1 Uploading a script

- **Action**: Settings → Night watch → Custom command → Choose file; try one each of `js` / `cmd` / `bat` / `py` / `ps1` (a harmless one-liner is enough).
- **Expected**: a pill appears showing the extension's flag colour plus the file name; the input accepts a custom display name; after clicking "Remove" the pill disappears and the action area returns to the unselected state.
- **Failure**: the pill stays empty, the display name snaps back after editing, or arming still works after removal.

### 3.2 Disclaimer acknowledgement

- **Action**: upload a script and click "Arm" without ticking the disclaimer; then tick it and arm; then change the script content and arm again.
- **Expected**: arming is rejected with a reason while unticked; arming works once ticked; **the acknowledgement is invalidated automatically after a script change** and must be confirmed again.
- **Failure**: arming works without ticking; or arming still works right after swapping the script (which means the sha256 check is not in effect).

### 3.3 Missing interpreter

- **Action**: upload a `.py` on a machine **without Python installed**; or upload a `.js` where node is not available.
- **Expected**: the action area reports unavailable with the reason (missing interpreter) and arming is rejected; switching back to `.bat` or `.ps1` restores normal behaviour.
- **Failure**: it reports available, executes nothing at zero, and the log offers no explanation.

### 3.4 Execution at zero

- **Action**: choose "Custom command", set the countdown to 10 seconds, and write a script that **only writes one file** or **pops up a message box**.
- **Expected**: after the countdown ends the script runs exactly once; `data/events.log` records the execution and the exit code; the "Status" tab of the settings page shows the result.
- **Failure**: it runs twice; or nothing is recorded at all (not even a failure).

### 3.5 Cancelling

- **Action**: same 10-second countdown, click "Cancel shutdown" at second 5.
- **Expected**: **not one of them runs**; `events.log` has no execution record.
- **Failure**: the script still runs after cancelling.

### 3.6 Three platforms

- **Windows**: fully verified; it is the primary test platform.
- **macOS**: **shutdown, restart, sleep and sign out have all been exercised on real hardware** (Apple Silicon / macOS 27.2 / DSH Desktop: arm → task finishes → countdown → command sent → system accepts → the machine actually powers off, restarts, sleeps, or ends the session). **Provided no app is blocking the action** — a terminal running a foreground command or an editor with unsaved changes makes the system hold it, see the first item in section 4. **Hibernate has no user-level command on macOS**, so the plugin does not perform a real hibernate (it is treated as sleep, see section 7 of the architecture doc); **lock is unsupported**, see section 4.
- **Linux**: **all six actions have been verified on real hardware** (Ubuntu 24.04.5 LTS / desktop session, plugin `1.6.1-beta.5`): shutdown, restart, sleep, hibernate, lock and sign out all really execute. **Known limitation**: "sign out" ends the whole login session, so DSH exits with it and no further events are recorded (see section 4). **Not verified yet**: automatic retries under real rate limiting / timeouts, and whether the armed state survives a plugin reload.

## 4. Known limitations (read this before deciding something is a bug)

- **On macOS the shutdown may be stopped by the system**: macOS first checks whether an app claims to be busy. A terminal running a foreground command, or an editor with unsaved documents, makes it hold and wait for confirmation — exactly the same thing that happens when a manual "Shut Down" from the Apple menu is stopped, and not a sign that the plugin failed to send the command; **clear the foreground apps and it shuts down normally**. Running it unconditionally would need root (`shutdown -h now`), and the plugin deliberately does not touch privilege escalation. Stop long-running terminal commands before testing.
- **The countdown is counted by the plugin itself.** If DSH is killed or crashes during the countdown, the action **will not** run. The old version used a system timer (`shutdown /t N`) and would still have shut down in that case. This is a deliberate trade-off: better to miss a shutdown than to shut down wrongly.
- Scripts run with **your current user's permissions**; the plugin **does not review** script content and makes no guarantee about its safety.
- `restart-dsh` is listed but **greyed out**: restarting DSH needs `app.relaunch()` from the Electron main process, which the plugin cannot reach.
- **macOS lock is unavailable**: it reports "unsupported" explicitly and never half-locks.
- **On macOS, "available but still unknown" is normal**: an action whose command resolves reports `"unknown"` + `needs-elevation`, because the system may only decide at the moment of execution. `"unknown"` can be armed, but it is not a promise that it will succeed. On real hardware shutdown, restart, sleep and sign out have all succeeded; **hibernate is not offered on macOS** (no user-level command) and **lock is unsupported** (no reliable CLI).
- **On Linux, "sign out" also ends DSH itself** (DSH runs inside that user session, and `loginctl terminate-user` ends the whole session), so no events are recorded afterwards. That is not a defect, it is what the command means.
- **`needs-elevation` is a conservative label, not a detection result**: on non-Windows every action is marked "may need authorisation"; on a real Ubuntu 24.04.5 all six ran without extra privileges. Do not read it as "requires sudo".
- **Linux may show one authentication dialog**: when an action first exits non-zero, the host retries it once through `pkexec` (waiting up to 120 seconds), and polkit may ask for a password. The premise is "non-zero means it did not run"; if a command produced a side effect yet still returned non-zero, it could in the extreme run twice.
- **No timer, no automatic retry**: when the host cannot provide a timer, `retryAt` is set to 0, the log gets a `log.retryUnavailable` entry, and the UI stops showing "retrying in N seconds".
- Script stdout / stderr are each **truncated to 4096 bytes**; anything beyond that is not visible.
- **Config, scripts and the event log all live in `data/` inside the plugin package directory** (`data/config.json`, `data/scripts/`, `data/events.log`): they are not published in the npm tarball, but their location is inside the package directory, and an `npm i` upgrade replaces that whole directory — `data/` may go with it. **Back up `data/config.json` and `data/scripts/` before upgrading.**
- Upgrading from 1.6.0 bumps `config.json` to the new schema and migrates the old config automatically; internal experimental fields such as `customArgv` were never released with any version and take no part in the migration.
- The schema in 1.6.2 is 5 (the global script library `scripts[]` is new); upgrading from 1.6.0 migrates automatically at startup and writes the result immediately — no manual edits, just install over the top and restart DSH. Upgrading from 1.6.1 changes nothing in the config format, so no migration is needed.

## 5. How to report

Please include the following, as specifically as you can:

1. the **relevant fragment** of `data/config.json`: the profile's `action` and `scriptId`, plus that one entry in the top-level `scripts[]` (`name` / `ext` / `bytes` / `sha256`);
2. the **tail** of `data/events.log` (roughly the last 20 lines);
3. the system version (Windows version / macOS version / distribution and kernel), the DSH version and the plugin version;
4. reproduction steps: how many seconds the countdown was set to, at which second you acted, which button you clicked.

**Do not paste script content**; `ext`, `bytes` and `sha256` are enough to locate it.

## 6. What not to do

- Do not use it to test "really shutting the production machine down on time"; use a machine you can reboot at any time.
- Do not upload scripts of unknown origin, especially ones downloaded from the internet that you have not read line by line.
- Do not enable custom actions on a machine shared by several people.
- Do not treat this document as a guarantee for every environment: what is written above is the range we actually tested; for anything outside it, report the real situation as described in section 5.
