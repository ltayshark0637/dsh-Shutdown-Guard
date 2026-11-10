# Testing guide for v1.6.1-beta.2

> Chinese original: [BETA.md](BETA.md)

## 1. What this version is

`1.6.1-beta.2` is a **beta** that follows beta.1 in getting the "upload a script, run it at zero" capability right. This document covers the current beta, not a historical snapshot.

- **Do not install it on production machines**, and do not use it to test "really shutting the work machine down on time".
- npm's `latest` is still `1.6.0`; installing the beta requires an explicit version number.
- Behaviour may change at any time during the beta; this document is authoritative for the documentation.

## 2. How to install

```bash
npm i -g dsh-shutdown-guard@1.6.1-beta.2
```

After installing, **fully quit DSH and start it again** (on macOS, quit with ⌘Q — closing the window or refreshing the page does not count). The client bundle is compiled into the module graph only at startup, so closing the window or refreshing never loads new code; the same applies after you change code or upgrade the plugin.

If beta.1 is already installed, upgrade to beta.2 first and test against this guide — every item and expected behaviour here describes beta.2.

Rollback:

```bash
npm i -g dsh-shutdown-guard@1.6.0
```

(If the local PowerShell forbids `npm.ps1`, use `npm.cmd`.)

Platform: the `os` restriction in `package.json` has been removed, so macOS and Linux can now `npm install` normally (for behavioural maturity see 3.6).

Upgrading from beta.1 to beta.2 **needs no manual migration**: the config schema was finalised as 4 in beta.1, and beta.2 only changes behaviour, not the config format — install the new version and restart DSH.

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
- **macOS**: the **whole plugin-side path has been exercised on real hardware** (Apple Silicon / macOS 27.2 / DSH Desktop, plugin `1.6.1-beta.3`: arm → task finishes → countdown → command sent → the system accepts it and enters its shutdown flow). That run was then stopped by a still-running terminal holding a foreground process, so the machine did not power off — see the first item in section 4. **Restart, sign out, sleep and hibernate have not been verified on real hardware.**
- **Linux**: **no real-hardware test yet**; only code and assertions cover it. If you have a machine to hand, please report whether it installs, whether it mounts, and whether the availability decisions in the action area match your expectations.

## 4. Known limitations (read this before deciding something is a bug)

- **On macOS the shutdown gets stopped by the system**: macOS first checks whether an app claims to be busy. A terminal running a foreground command, or an editor with unsaved documents, makes it hold and wait for confirmation — exactly the same thing that happens when a manual "Shut Down" from the Apple menu is stopped, and not a sign that the plugin failed to send the command. Running it unconditionally would need root (`shutdown -h now`), and the plugin deliberately does not touch privilege escalation. Stop long-running terminal commands before testing.
- **The countdown is counted by the plugin itself.** If DSH is killed or crashes during the countdown, the action **will not** run. The old version used a system timer (`shutdown /t N`) and would still have shut down in that case. This is a deliberate trade-off: better to miss a shutdown than to shut down wrongly.
- Scripts run with **your current user's permissions**; the plugin **does not review** script content and makes no guarantee about its safety.
- `restart-dsh` is listed but **greyed out**: restarting DSH needs `app.relaunch()` from the Electron main process, which the plugin cannot reach.
- **macOS lock is unavailable**: it reports "unsupported" explicitly and never half-locks.
- **On macOS, "available but still unknown" is normal**: an action whose command resolves reports `"unknown"` + `needs-elevation`, because the system may only decide at the moment of execution. `"unknown"` can be armed, but it is not a promise that it will succeed. On real hardware the "command delivered, system entered its shutdown flow" path has been exercised once; **restart / sign out / sleep / hibernate are still unverified**.
- **Linux sign-out also ends DSH itself** (DSH runs inside that user session), so using it to test sign-out shuts DSH down along with it.
- Script stdout / stderr are each **truncated to 4096 bytes**; anything beyond that is not visible.
- Scripts live in the plugin's writable data directory (`data/scripts/`), not in the npm package directory; upgrading the plugin does not take them away.
- Upgrading from 1.6.0 bumps `config.json` to the new schema and migrates the old config automatically; internal experimental fields such as `customArgv` were never released with any version and take no part in the migration.
- beta.1 → beta.2 has **no config-format change**: the schema was finalised as 4 in beta.1 and beta.2 only changes behaviour, so there is nothing to edit or migrate — install over the top and restart DSH.

## 5. How to report

Please include the following, as specifically as you can:

1. the **relevant fragment** of `data/config.json`: the profile's `action`, `script` (`name` / `ext` / `bytes` / `sha256`) and `scriptAck`;
2. the **tail** of `data/events.log` (roughly the last 20 lines);
3. the system version (Windows version / macOS version / distribution and kernel), the DSH version and the plugin version;
4. reproduction steps: how many seconds the countdown was set to, at which second you acted, which button you clicked.

**Do not paste script content**; `ext`, `bytes` and `sha256` are enough to locate it.

## 6. What not to do

- Do not use it to test "really shutting the production machine down on time"; use a machine you can reboot at any time.
- Do not upload scripts of unknown origin, especially ones downloaded from the internet that you have not read line by line.
- Do not enable custom actions on a machine shared by several people.
- Do not treat beta behaviour as a promise: the point of this version is to find what else was not considered beyond the limitations above.
