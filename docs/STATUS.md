# dsh-shutdown-panel · 归档状态（2026-11-02）

## 一句话

插件功能完整、已装进 `profiles\web`、旧插件已清除；**唯一未完成的是重启 DSH 验证 v1.0.12**（重启才能加载新的客户端 bundle）。

## 版本

- 当前 `1.0.12`，tag `v1.0.12`，commit `294800d`
- `node --check` 通过；`_test_client_bundle.cjs`、`_test_shutdown_panel.mjs` 通过
- 历史：v0.1 → v1.0 → 1.0.1 (DOM 挂载) → 1.0.2/1.0.3 (配色、接缝) → 1.0.4/1.0.5 (误改，已回退) → 1.0.6 (按稿回退) → 1.0.7/1.0.8 (圆环/光晕) → 1.0.9–1.0.11 (圆环自裁切 → SVG 正圆 → 尺寸回设计) → 1.0.12 (环比例 + 点落在可见区)

## 安装状态（已生效，与代码无关）

- `profiles\web\node_modules\dsh-shutdown-panel` → junction 指向 `plugins\dsh-shutdown-panel`
- `profiles\web\package.json`：`dependencies['dsh-shutdown-panel'] = link:…`，`dsh.profile.bundles` 共 29 项且包含它
- 旧插件 `dsh-shutdown-after-task` 已从 bundles/dependencies/overrides/generationProjection/desired.json/软链/代际目录中删除，`profiles\web\node_modules\dsh-shutdown-after-task` 不存在
- 备份：`profiles\web\package.json.bak-*`、`cordis.patch.yml.bak-*`

## 下次开工第一件事

1. 重启 DSH（客户端 bundle 只在启动时装配）
2. 自检四条：
   - 侧边栏「技能中心」下方出现卡片，宽度与上面一行对齐
   - 设置页出现「任务完成后关机」分区，可切 A/B/C、深/浅
   - `GET /api/dsh-shutdown-panel/state` 返回含 `jobsRunning`
   - 右下角旧的 `任务完成后关机` 浮动按钮不再出现
3. 若雷达仍不符，先看 `preview/sidebar-live.html`（设计稿）与 `preview/rings-design.png`（1.0.12 实拍），不要再自行改设计

## 设计源

- 交互设计稿：`preview/sidebar-live.html`（B 段 CSS 在第 147–198 行）
- 视觉预览：`preview/card-v108.png`、`preview/size-back.png`、`preview/rings-design.png`
- 回归复盘：`docs/radar-regression.md`

## 已知待办 / 清理

- 重启后确认 v1.0.12 生效
- 工作区根的临时脚本可删：`_test_*.mjs/cjs`、`_gen_card_preview.cjs`、`_install_panel.cjs`、`_remove_old_plugin.cjs`、`_probe_asar.cjs`、`_slice_asar.cjs`、`_grep_asar.cjs`、`_diag_bundle.cjs`、`_new_css.txt`、`dsh-shutdown-panel.dev-backup\`
- `preview\` 里的 `_zoom.png`、`_ringtest*.png`、`_svgtest.png` 是一次性取证图，可删
- `dsh-shutdown-panel.log` 留在 DSH_HOME 根目录，属正常日志

## 功能回顾（都已实现）

- 全部任务结束 → 倒计时 → `shutdown /s /t`
- 后台任务（`ctx.jobs`）未结清不关机；倒计时中出现新任务会 `/a` 取消但保持武装
- 仅成功时关机（本轮有会话报错则跳过）；`/cancel` 只取消本次倒计时
- 侧边栏卡片三外观（A 警戒带 / B 雷达 / C 终端）、纵向折叠、深/浅/Claude 主题、判定原因人话化
- 设置页分区：外观、折叠、阈值
