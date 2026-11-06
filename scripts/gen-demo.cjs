// Builds docs/demo.html — one page with two panes behind a tab bar.
//
//   pane 1  了解      the README, as a page you can actually read
//   pane 2  试一试    the interactive playground
//
// Visual language matches docs/screenshots/banner.html (same wash, grid, grain,
// amber eyebrow, hazard rule) so the demo reads as the product's own page
// rather than a separate microsite.
//
// Same rule as the gallery: the card CSS comes from lib/client.js and the
// sidebar chrome from gen-gallery.cjs, so nothing here can drift from the
// product.
//
// All copy lives in scripts/demo/i18n.js as DEMO_MSG, so the page exists in
// zh / en / ru. zh is the default and the source of truth: every translated
// element keeps its zh markup in the HTML, and i18n.js restores that exact
// markup when you switch back.
//
// Run from the plugin root:  node scripts/gen-demo.cjs
const fs = require('node:fs')
const path = require('node:path')
const { CSS, SIDEBAR_CSS } = require('./gen-gallery.cjs')
const I18N = require('./demo/i18n.js')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(__dirname, 'demo', p), 'utf8')

const appCss = read('app.css')
const appJs = read('app.js')
const i18nJs = read('i18n.js')

// zh copy, straight from the message table.
const t = (key) => I18N.dt('zh', key)

const ICON = {
  chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  board: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  plug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v6M8 9h8v4a4 4 0 0 1-8 0V9zM12 17v4"/></svg>',
  skill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3z"/></svg>',
}

// The sidebar shell; #card-slot is filled by app.js after boot.
const sbShell = (slot) => `<div class="sb">
  <div class="sb-top"><span>deepseek</span><span class="sb-badge">HARNESS</span></div>
  <div class="sb-row">${ICON.chat}<span data-i18n="sb.chat">${t('sb.chat')}</span></div>
  <div class="sb-row">${ICON.board}<span data-i18n="sb.board">${t('sb.board')}</span></div>
  <div class="sb-row">${ICON.plug}<span data-i18n="sb.plug">${t('sb.plug')}</span></div>
  <div class="sb-row">${ICON.skill}<span data-i18n="sb.skill">${t('sb.skill')}</span></div>
  <div class="sb-gap"></div>
  <div id="${slot || 'card-slot'}"></div>
  <div class="sb-gap"></div>
  <div class="sb-sess"><i></i><span class="nm" data-i18n="sb.sess1">${t('sb.sess1')}</span><span class="tm" data-i18n="sb.t1">${t('sb.t1')}</span></div>
  <div class="sb-sess"><i></i><span class="nm" data-i18n="sb.sess2">${t('sb.sess2')}</span><span class="tm" data-i18n="sb.t2">${t('sb.t2')}</span></div>
  <div class="sb-sess"><i></i><span class="nm" data-i18n="sb.sess3">${t('sb.sess3')}</span><span class="tm" data-i18n="sb.t3">${t('sb.t3')}</span></div>
  <div class="sb-sess"><i></i><span class="nm" data-i18n="sb.sess4">${t('sb.sess4')}</span><span class="tm" data-i18n="sb.t4">${t('sb.t4')}</span></div>
</div>`

// Screenshots live beside this page under docs/screenshots/, so a plain
// relative path works both from disk and from GitHub Pages. They load eagerly:
// there are only five of them, and `loading="lazy"` left the shots collapsed to
// their caption height on Pages until something forced a reflow.
const img = (file, capKey, altKey) =>
  `<div class="shot"><img src="screenshots/${file}" alt="${t(altKey)}" data-i18n-alt="${altKey}" decoding="async"><span data-i18n="${capKey}">${t(capKey)}</span></div>`

// Language switcher: same pill as .tab, sitting to the right of the tab bar.
const langButtons = I18N.DEMO_LANGS.map((lang) =>
  `<button class="tab lang-tab${lang === 'zh' ? ' on' : ''}" type="button" data-lang-btn="${lang}" aria-pressed="${lang === 'zh'}">${I18N.DEMO_LABELS[lang]}</button>`
).join('\n      ')

// ---------------------------------------------------------------- settings demo
// A static copy of the four-tab settings panel. It reuses the product's own
// classes (.dsp-tabs/.dsp-srow/.dsp-vcard/...), so running gen-gallery keeps the
// look in sync; only the markup lives here. Nothing in it writes state — the
// panel in the real sidebar is the one that does.
const sRow = (titleKey, ctl, descKey) => `<div class="dsp-srow">
  <div class="dsp-srow-text"><span class="dsp-stitle" data-i18n="${titleKey}">${t(titleKey)}</span>${
    descKey ? `<span class="dsp-sdesc" data-i18n="${descKey}">${t(descKey)}</span>` : ''
  }</div>${ctl}</div>`

const sSwitch = (on) => `<span class="dsp-switch${on ? ' on' : ''}" aria-hidden="true"><i></i></span>`
const sSeg = (keys, onIndex, kind) => `<span class="dsp-seg"${kind ? ` data-seg="${kind}"` : ''}>${keys.map((k, i) =>
  `<button class="dsp-segbtn${i === onIndex ? ' on' : ''}" type="button" data-i18n="${k}">${t(k)}</button>`).join('')}</span>`
const sLink = (key) => `<span class="dsp-slink" data-i18n="${key}">${t(key)}</span>`
const sVCard = (v, labelKey) => `<button class="dsp-vcard${v === 'a' ? ' on' : ''}" type="button" data-vcard="${v}">
    <span class="dsp-thumb"><img class="dsp-thumb-img" data-thumb="${v}" src="assets/variant-${v}-zh-dark.png" alt="" decoding="async"></span>
    <span class="dsp-vcard-label" data-i18n="${labelKey}">${t(labelKey)}</span></button>`

const settingsDemo = `<div class="sect full">
  <h2 data-i18n="a8.title">${t('a8.title')}</h2>
  <p data-i18n="a8.p">${t('a8.p')}</p>
  <div class="setWrap">
    <div class="dsp-shead">
      <span class="dsp-shead-title" data-i18n="card.title">${t('card.title')}</span>
      <span class="dsp-shead-links"><span class="dsp-slink" data-i18n="s.head.gh">${t('s.head.gh')}</span><span class="dsp-slink" data-i18n="s.head.npm">${t('s.head.npm')}</span></span>
    </div>
    <div class="dsp-tabs" id="demo-tabs" role="tablist" data-ready>
      <button class="dsp-tab on" type="button" role="tab" aria-selected="true" data-tab="look" data-i18n="s.tab.look">${t('s.tab.look')}</button>
      <button class="dsp-tab" type="button" role="tab" aria-selected="false" data-tab="watch" data-i18n="s.tab.watch">${t('s.tab.watch')}</button>
      <button class="dsp-tab" type="button" role="tab" aria-selected="false" data-tab="notify" data-i18n="s.tab.notify">${t('s.tab.notify')}</button>
      <button class="dsp-tab" type="button" role="tab" aria-selected="false" data-tab="status" data-i18n="s.tab.status">${t('s.tab.status')}</button>
    </div>

    <div class="dsp-tabpanel" data-pane="look">
      <div class="dsp-cards">${sVCard('a', 's.look.a')}${sVCard('b', 's.look.b')}${sVCard('c', 's.look.c')}</div>
      ${sRow('s.look.theme', sSeg(['s.theme.auto', 's.theme.dark', 's.theme.light', 's.theme.claude'], 0, 'theme'))}
      ${sRow('s.look.fold', sSwitch(false), 's.look.foldDesc')}
      ${sRow('s.look.compact', sSwitch(true), 's.look.compactDesc')}
      ${sRow('s.look.lang', sSeg(['s.lang.auto', 's.lang.zh', 's.lang.en', 's.lang.ru'], 0, 'lang'))}
    </div>

    <div class="dsp-tabpanel" data-pane="watch" hidden>
      <div class="dsp-srow dsp-srow-standalone">
        <div class="dsp-srow-text"><span class="dsp-stitle" data-i18n="s.watch.custom">${t('s.watch.custom')}</span>
          <span class="dsp-sdesc" data-i18n="s.watch.customDesc">${t('s.watch.customDesc')}</span></div>${sSwitch(true)}
      </div>
      <div class="dsp-sgroup-box"><div class="dsp-sgroup"><span class="dsp-sgroup-title" data-i18n="s.prof.group">${t('s.prof.group')}</span></div>
        ${sRow('s.prof.pick', `<span class="dsp-sval" data-i18n="s.prof.cur">${t('s.prof.cur')}</span>`)}
        ${sRow('s.prof.default', `<span class="dsp-sval" data-i18n="s.cd.60">${t('s.cd.60')}</span>`)}
        ${sRow('s.prof.c1', `<span class="dsp-sval" data-i18n="s.cd.90">${t('s.cd.90')}</span><span class="dsp-sacts">${sLink('s.prof.setDefault')}${sLink('s.prof.rename')}${sLink('s.prof.del')}</span>`)}
        <div class="dsp-srow dsp-srow-new" data-new><span class="dsp-stitle" data-i18n="s.prof.new">${t('s.prof.new')}</span></div>
      </div>
      <div class="dsp-sgroup-box"><div class="dsp-sgroup"><span class="dsp-sgroup-title" data-i18n="s.watch.group">${t('s.watch.group')}</span></div>
        ${sRow('s.row.sessions', `<span class="dsp-sval" data-i18n="s.always">${t('s.always')}</span>`, 's.row.sessionsDesc')}
        ${sRow('s.row.jobs', sSwitch(true), 's.row.jobsDesc')}
        ${sRow('s.row.errors', sSwitch(false), 's.row.errorsDesc')}
        ${sRow('s.row.cd', sSeg(['s.cd.30', 's.cd.60', 's.cd.120', 's.cd.300'], 2), 's.row.cdDesc')}
      </div>
    </div>

    <div class="dsp-tabpanel" data-pane="notify" hidden>
      <div class="dsp-sgroup-box"><div class="dsp-sgroup"><span class="dsp-sgroup-title" data-i18n="s.notify.group">${t('s.notify.group')}</span></div>
        ${sRow('s.notify.master', sSwitch(true), 's.notify.masterDesc')}
        ${sRow('s.notify.countdown', sSwitch(true))}
        ${sRow('s.notify.fired', sSwitch(true))}
        ${sRow('s.notify.blocked', sSwitch(true))}
        ${sRow('s.notify.recovered', sSwitch(false))}
      </div>
    </div>

    <div class="dsp-tabpanel" data-pane="status" hidden>
      <div class="dsp-sgroup-box"><div class="dsp-sgroup"><span class="dsp-sgroup-title" data-i18n="s.status.group">${t('s.status.group')}</span></div>
        ${sRow('s.status.blocked', `<span class="dsp-sval" data-i18n="s.status.blockedV">${t('s.status.blockedV')}</span>`)}
        ${sRow('s.status.last', `<span class="dsp-sval" data-i18n="s.status.lastV">${t('s.status.lastV')}</span>`)}
        ${sRow('s.status.log', `<span class="dsp-sval" data-i18n="s.status.logV">${t('s.status.logV')}</span>`)}
      </div>
    </div>
  </div>
  <p data-i18n="a8.p2">${t('a8.p2')}</p>
</div>`

// ---------------------------------------------------------------- pane 1
const aboutPane = `<div class="about">

  <div class="sect">
    <h2 data-i18n="a1.title">${t('a1.title')}</h2>
    <p data-i18n="a1.p1">${t('a1.p1')}</p>
    <p data-i18n="a1.p2">${t('a1.p2')}</p>
  </div>

  <div class="sect">
    <h2 data-i18n="a2.title">${t('a2.title')}</h2>
    <p data-i18n="a2.p">${t('a2.p')}</p>
    <ol class="gates">
      <li data-i18n="a2.g1">${t('a2.g1')}</li>
      <li data-i18n="a2.g2">${t('a2.g2')}</li>
      <li data-i18n="a2.g3">${t('a2.g3')}</li>
      <li data-i18n="a2.g4">${t('a2.g4')}</li>
      <li data-i18n="a2.g5">${t('a2.g5')}</li>
    </ol>
  </div>

  <div class="sect full">
    <h2 data-i18n="a3.title">${t('a3.title')}</h2>
    <div class="strip three" id="show-variants"></div>
    <p data-i18n="a3.p1">${t('a3.p1')}</p>
    <p data-i18n="a3.p2">${t('a3.p2')}</p>
  </div>

  <div class="sect full">
    <h2 class="with-pills">
      <span data-i18n="a4.title">${t('a4.title')}</span>
      <span class="pills" id="show-variant-pills" role="group" aria-label="用哪种外观预览" data-i18n-aria="a4.pillsAria">
        <button data-v="A" class="on">A</button>
        <button data-v="B">B</button>
        <button data-v="C">C</button>
      </span>
    </h2>
    <div class="strip three" id="show-states"></div>
    <p data-i18n="a4.p">${t('a4.p')}</p>
  </div>

  <div class="sect">
    <h2 data-i18n="a5.title">${t('a5.title')}</h2>
    <p data-i18n="a5.p">${t('a5.p')}</p>
    <ul class="levels">
      <li class="halted" data-i18n="a5.li1">${t('a5.li1')}</li>
      <li class="waiting" data-i18n="a5.li2">${t('a5.li2')}</li>
    </ul>
  </div>

  <div class="sect">
    <h2 data-i18n="a6.title">${t('a6.title')}</h2>
    <p data-i18n="a6.p">${t('a6.p')}</p>
    <ul class="levels">
      <li data-i18n="a6.li1">${t('a6.li1')}</li>
      <li data-i18n="a6.li2">${t('a6.li2')}</li>
      <li data-i18n="a6.li3">${t('a6.li3')}</li>
    </ul>
  </div>

  <div class="sect full">
    <h2 data-i18n="a7.title">${t('a7.title')}</h2>
    <div class="strip two">
      <div class="shot">
        <div class="sbWrap">${sbShell('card-slot-hold')}</div>
        <span data-i18n="a7.cap1">${t('a7.cap1')}</span>
      </div>
      <div class="shot">
        <div class="sbWrap">${sbShell('card-slot-fire')}</div>
        <span data-i18n="a7.cap2">${t('a7.cap2')}</span>
      </div>
    </div>
    <p data-i18n="a7.p">${t('a7.p')}</p>
    <p data-i18n="a7.p2">${t('a7.p2')}</p>
  </div>

  ${settingsDemo}

  <div class="install full">
    <span data-i18n="install.text">${t('install.text')}</span>
    <span class="go"><a href="https://github.com/ltayshark0637/dsh-Shutdown-Guard" data-i18n="install.link">${t('install.link')}</a></span>
  </div>

  <div class="cta full">
    <div class="cta-text">
      <b data-i18n="cta.b">${t('cta.b')}</b>
      <span data-i18n="cta.span">${t('cta.span')}</span>
    </div>
    <button class="cta-btn" data-goto="try">
      <span data-i18n="cta.btn">${t('cta.btn')}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </button>
  </div>

</div>`

// ---------------------------------------------------------------- pane 2
const tryPane = `<div class="main">
  <div class="stage-col">
    <div class="stage-frame">${sbShell()}</div>
  </div>

  <div class="panel">
    <div class="block">
      <div class="blabel" data-i18n="try.appearance">${t('try.appearance')}</div>
      <div class="seg" id="variants" role="group" aria-label="外观" data-i18n-aria="try.appearanceAria">
        <button data-v="A" class="on" data-i18n="try.vA">${t('try.vA')}</button>
        <button data-v="B" data-i18n="try.vB">${t('try.vB')}</button>
        <button data-v="C" data-i18n="try.vC">${t('try.vC')}</button>
      </div>
    </div>

    <div class="block">
      <div class="blabel" data-i18n="try.scene">${t('try.scene')}</div>
      <button class="roll" id="roll" data-i18n="try.roll">${t('try.roll')}</button>
      <div class="armhint" id="arm-hint" hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
        <span data-i18n="try.armHint">${t('try.armHint')}</span>
      </div>
      <div class="now" id="now" role="status" aria-live="polite">${t('try.now').replace('{state}', t('state.off.t'))}</div>
      <button class="stop" id="stop">${t('try.stop')}</button>
    </div>

    <div class="block log-block">
      <div class="blabel" data-i18n="try.log">${t('try.log')}</div>
      <ul class="log" id="log"><li class="empty" data-i18n="try.logEmpty">${t('try.logEmpty')}</li></ul>
    </div>
  </div>

  <aside class="tipscol">
    <div class="blabel" data-i18n="try.tips">${t('try.tips')}</div>
    <ol class="tips">
      <li data-i18n="try.tip1">${t('try.tip1')}</li>
      <li data-i18n="try.tip2">${t('try.tip2')}</li>
      <li data-i18n="try.tip3">${t('try.tip3')}</li>
      <li data-i18n="try.tip4">${t('try.tip4')}</li>
      <li data-i18n="try.tip5">${t('try.tip5')}</li>
    </ol>
  </aside>
</div>`

const html = `<!doctype html>
<html lang="zh" data-lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title data-i18n="meta.title">${t('meta.title')}</title>
<meta name="description" content="${t('meta.desc')}" data-i18n-content="meta.desc">
<style>
${appCss}
</style>
<style>
${SIDEBAR_CSS}
/* the demo sidebar fills its frame instead of sitting at screenshot width */
.sb { width: 100% }
</style>
<style>
${CSS}
</style>
</head><body>

<div class="bg bg-wash"></div>
<div class="bg bg-lobe"></div>
<div class="bg bg-grid"></div>
<div class="bg bg-grain"></div>

<div class="page">
  <div class="repo-links">
    <a class="repo-link" href="https://github.com/ltayshark0637/dsh-Shutdown-Guard" aria-label="在 GitHub 上查看 dsh-shutdown-guard" data-i18n-aria="repo.gh.aria" title="在 GitHub 上查看" data-i18n-titleattr="repo.gh.title">
      <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      <span>GitHub</span>
    </a>
    <a class="repo-link" href="https://www.npmjs.com/package/dsh-shutdown-guard" aria-label="在 npm 上查看 dsh-shutdown-guard" data-i18n-aria="repo.npm.aria" title="在 npm 上查看" data-i18n-titleattr="repo.npm.title">
      <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" focusable="false"><rect x="1.3" y="4.4" width="13.4" height="7.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="8" y="9.55" text-anchor="middle" font-family="ui-monospace, &quot;Cascadia Mono&quot;, Consolas, monospace" font-size="4.4" font-weight="700" fill="currentColor">npm</text></svg>
      <span>npm</span>
    </a>
  </div>
  <div class="eyebrow"><i></i>DeepSeek Harness Plugin</div>
  <h1>Shutdown <em>Guard</em></h1>
  <div class="zh" data-i18n="hero.sub">${t('hero.sub')}</div>
  <p class="lede" data-i18n="hero.lede">${t('hero.lede')}</p>
  <div class="chips">
    <span class="chip" data-i18n="chip.1">${t('chip.1')}</span>
    <span class="chip" data-i18n="chip.2">${t('chip.2')}</span>
    <span class="chip" data-i18n="chip.3">${t('chip.3')}</span>
    <span class="chip" data-i18n="chip.4">${t('chip.4')}</span>
    <span class="chip" data-i18n="chip.5">${t('chip.5')}</span>
  </div>

  <div class="tabs-row">
    <div class="tabs" role="tablist">
      <button class="tab on" id="tab-about" role="tab" aria-selected="true" aria-controls="pane-about" data-pane="about" data-i18n="tab.about">${t('tab.about')}</button>
      <button class="tab" id="tab-try" role="tab" aria-selected="false" aria-controls="pane-try" data-pane="try" data-i18n="tab.try">${t('tab.try')}</button>
    </div>
    <div class="langs" role="group" aria-label="切换语言" data-i18n-aria="langs.aria">
      ${langButtons}
    </div>
  </div>

  <div class="pane" id="pane-about" role="tabpanel" aria-labelledby="tab-about">
    ${aboutPane}
  </div>

  <div class="pane" id="pane-try" role="tabpanel" aria-labelledby="tab-try" hidden>
    ${tryPane}
  </div>
</div>

<div class="rule"></div>
<div class="colophon">
  <span><b>dsh-shutdown-guard</b></span>
  <span>MIT</span>
  <span data-i18n="colophon.note">${t('colophon.note')}</span>
  <a href="https://github.com/ltayshark0637/dsh-Shutdown-Guard">GitHub</a>
</div>

<script>
${i18nJs}
</script>
<script>
${appJs}
</script>
</body></html>
`

const out = path.join(root, 'docs', 'demo.html')
fs.writeFileSync(out, html)
console.log('wrote', path.relative(root, out), `(${(html.length / 1024).toFixed(1)} KB)`)
