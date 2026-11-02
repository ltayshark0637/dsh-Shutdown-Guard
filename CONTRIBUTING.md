# 贡献指南

## 环境

- Windows（插件只在这个平台挂载）
- DSH Desktop，版本 `>= 0.1.5-rc.1`
- Node.js 22.19+（插件用 ESM 和 `node:crypto`）

## 本地开发

```bash
# 服务端断言：mock ctx，不会真的关机
node test/host.test.mjs

# 客户端 bundle smoke：用假 React 跑真实 client.js
node test/client.test.cjs
```

两条命令都从插件根目录运行。改动 `lib/*.js` 后都要重跑。

## 让它生效

把插件目录链到 profile 下：

```
profiles\web\node_modules\dsh-shutdown-panel  ->  <本插件目录>
```

并确认 `profiles\web\package.json` 里 `dsh.profile.bundles` 含 `dsh-shutdown-panel`。

然后**重启 DSH**——客户端 bundle 只在启动时编入模块图，刷新页面不会加载新代码。

## 截图

README 里的图全部由 `lib/client.js` 里的真实 CSS 生成，避免文档和产品脱节：

```bash
node scripts/gen-gallery.cjs    # 生成 docs/screenshots/*.html
pwsh scripts/screenshot.ps1     # 渲染成 PNG（需要 Edge）
```

改了样式就重新跑这两条，别手工 P 图。

## 提交前

- [ ] `node test/host.test.mjs` 通过
- [ ] `node test/client.test.cjs` 通过
- [ ] 改了可见行为就更新 `CHANGELOG.md` 和 `package.json` 的 `version`
- [ ] 改了截图相关的样式就重新生成截图
- [ ] README 里的配置表与实际 `normalizeProfile` 一致

## 代码约定

- 服务端只用 `node:fs` / `node:path` / `node:crypto`，不引第三方依赖
- 浏览器侧只 `require('react')`
- 不修改 `app.asar` 或 DSH 自身源码，全部通过槽位与事件挂载
- 日志走 `log(message, kind)`，别直接 `console.log`

## 提 issue 时

请附上：

1. `data/events.log` 的相关片段（脱敏后）
2. `GET /api/dsh-shutdown-panel/state` 的返回
3. DSH 版本与插件版本
4. 复现步骤——尤其是「武装后没关机」，这条几乎总是能从日志里读出原因
