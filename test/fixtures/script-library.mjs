// Storage fixtures for the v5 script library. These describe what is on disk
// before migration (v4: one script file per profile, ack on the profile) and the
// byte samples used by the dedupe assertions. Everything is generated here so
// the fixture cannot drift from the hash the host will compute.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** One ps1 payload shared by two profiles in the legacy layout. */
export const SHARED_PS1 = 'Write-Output "library fixture"\r\n'
/** Same extension, different bytes: a second library entry after upload. */
export const OTHER_PS1 = 'Write-Output "other bytes"\r\n'
/** Same bytes as SHARED_PS1, different extension: NOT a duplicate. */
export const SHARED_PY = SHARED_PS1

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

export const SHARED_SHA = sha256(SHARED_PS1)
export const OTHER_SHA = sha256(OTHER_PS1)

export const SAMPLES = {
  shared: { ext: 'ps1', content: SHARED_PS1, sha256: SHARED_SHA },
  sameShaDiffExt: { ext: 'py', content: SHARED_PY, sha256: SHARED_SHA },
  sameExtDiffSha: { ext: 'ps1', content: OTHER_PS1, sha256: OTHER_SHA },
}

/**
 * Writes a v4 store whose two custom profiles each own a byte-identical script
 * file under the old `<profileId>.<ext>` name. p1 carries a valid ack, p2 none,
 * so the migration must keep the ack on the surviving library entry.
 *
 * @param {string} dataDir directory that holds config.json and scripts/
 */
export function writeV4SharedScripts(dataDir) {
  const scriptsDir = path.join(dataDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  const bytes = Buffer.byteLength(SHARED_PS1)
  const savedAt = 1762836000000
  const ackAt = 1762836900000
  const script = (file) => ({
    name: 'shared.ps1',
    ext: 'ps1',
    file,
    bytes,
    sha256: SHARED_SHA,
    savedAt,
  })
  for (const file of ['p1.ps1', 'p2.ps1']) {
    fs.writeFileSync(path.join(scriptsDir, file), SHARED_PS1, 'utf8')
  }
  const config = {
    version: 4,
    customEnabled: true,
    activeProfileId: 'p1',
    language: 'zh',
    profiles: [
      {
        id: 'p1',
        label: 'A',
        countdownSec: 60,
        marginSec: 5,
        onlyOnSuccess: true,
        blockOnJobs: true,
        afkAutoAnswer: true,
        action: 'custom',
        script: script('p1.ps1'),
        scriptAck: { sha256: SHARED_SHA, at: ackAt },
      },
      {
        id: 'p2',
        label: 'B',
        countdownSec: 90,
        marginSec: 5,
        onlyOnSuccess: true,
        blockOnJobs: true,
        afkAutoAnswer: true,
        action: 'custom',
        script: script('p2.ps1'),
        scriptAck: null,
      },
    ],
  }
  const configPath = path.join(dataDir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config) + '\n', 'utf8')
  return { configPath, scriptsDir, config, sha256: SHARED_SHA, bytes, ackAt }
}
