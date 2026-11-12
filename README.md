<div align="center">
  <h1>Writing Dashboard</h1>
  <p><strong>See your writing activity without leaving Obsidian.</strong></p>
  <p>Yearly heatmap · Monthly trends · Live word counts</p>
  <p><strong>在 Obsidian 右侧栏，查看每天的写作进度。</strong></p>
  <p>年度热力图 · 月度字数趋势 · 实时统计</p>
  <p>
    <a href="#installation">Installation</a> ·
    <a href="#basic-usage">Basic usage</a> ·
    <a href="#界面预览">界面预览</a> ·
    <a href="#统计规则">统计规则</a> ·
    <a href="#开发">开发</a>
  </p>
  <p>
    <a href="https://github.com/Ckxkx/writing-dashboard/releases/latest"><img src="https://img.shields.io/github/v/release/Ckxkx/writing-dashboard?label=Release&amp;color=238636" alt="最新版 Release"></a>
    <img src="https://img.shields.io/badge/Obsidian-1.8.7%2B-7C3AED?logo=obsidian&amp;logoColor=white" alt="Obsidian 1.8.7 及以上">
    <img src="https://img.shields.io/badge/Tracking-Local%20only-238636" alt="仅本地追踪">
  </p>
  <img src="docs/screenshots/overview.png" alt="年度摘要、年份切换、总字数和总篇数" width="620">
  <p><em>用年度摘要看趋势，用 Vault 总量看手头有多少内容。</em></p>
</div>

---

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 年度概览 | 切换年份，查看该年的写作天数和累计字数；总字数和总篇数始终反映当前 Vault 中纳入统计的笔记。 |
| 写作热力图 | 打开时定位到今天；悬停查看数据，点击日期查看并打开当日笔记。支持键盘导航。 |
| 月度趋势 | 查看所选年份各月累计计入的字数。 |
| 实时统计 | 输入时预览更新，Obsidian 保存后确认记录。桌面状态栏显示今日篇数和字数，点击可展开或收起仪表盘。 |
| 笔记索引 | 首次启用扫描已有笔记；可在右上角「···」重建索引，已记录的日常写作活动会保留。 |
| 本地配置 | 可排除文件或文件夹、调整颜色阈值和日期格式、设置计数范围或暂停追踪。无需账户、服务器或遥测。 |

## Installation

Requires **Obsidian 1.8.7 or later**. The status-bar shortcut is for desktop.

1. Download the versioned ZIP from [GitHub Releases](https://github.com/Ckxkx/writing-dashboard/releases/latest).
2. Extract the `writing-dashboard` folder into `<Vault>/.obsidian/plugins/`.
3. Restart Obsidian and enable **Writing Dashboard** under **Settings → Community plugins**.

You can also install the three individual assets, `main.js`, `manifest.json`, and `styles.css`, into the same plugin folder. For upgrades, replace all three together and keep `data.json`.

### 中文安装说明

1. 从 [GitHub Releases](https://github.com/Ckxkx/writing-dashboard/releases/latest) 下载 ZIP 安装包。
2. 将包内的 `writing-dashboard` 文件夹解压到 Vault 的 `.obsidian/plugins/` 目录。如使用自定义配置目录，请替换 `.obsidian`。
3. 重启 Obsidian，在 **设置 → 第三方插件** 中启用 **Writing Dashboard**。
4. 升级时同时替换 `main.js`、`manifest.json` 和 `styles.css`，**保留 `data.json`**。

使用插件无需安装 Node.js 或 Git。Release 附有独立插件文件和 SHA-256 校验文件。

## Basic usage

- Click the ribbon icon, the desktop status-bar item, or run **Open Writing Dashboard** from the command palette.
- Pick a year or select a day to see its notes. Use **今天** (Today) to jump back to the current date.
- If notes are missing from the timeline, use **··· → 重建索引** (Rebuild index).

## 界面预览

<table>
  <tr>
    <td align="center" width="50%"><strong>热力图与每日笔记</strong></td>
    <td align="center" width="50%"><strong>月度字数与桌面状态栏</strong></td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <img src="docs/screenshots/heatmap.png" alt="写作热力图和选中日期的笔记清单" width="380">
    </td>
    <td align="center" valign="top">
      <img src="docs/screenshots/monthly.png" alt="月度写作字数柱状图" width="380"><br><br>
      <img src="docs/screenshots/status-bar.png" alt="桌面状态栏上的今日篇数和字数" width="220">
    </td>
  </tr>
</table>

<details>
<summary>查看完整仪表盘</summary>

<img src="docs/screenshots/dashboard.png" alt="右侧栏完整仪表盘，包括年度概览、热力图和月度趋势" width="500">

</details>

## 使用指南

1. 点击左侧折线图图标、桌面底部的今日统计，或运行命令 **Open Writing Dashboard**。再次点击底部状态栏可收起正在显示的仪表盘。
2. 用右上角选择年份。打开时热力图默认定位到今天；向左滚动可查看更早的记录，点击「今天」可返回。
3. 点击日期查看当天的笔记和字数，点击笔记名即可打开。旧笔记的日期来源可在笔记名的悬停提示中查看。
4. 若发现遗漏，选择 **··· → 重建索引**，或运行命令 **重建写作索引**。设置中也可以调整统计范围和计数规则。

## 统计规则

| 指标 | 口径 |
| --- | --- |
| 总字数与总篇数 | 当前纳入统计的 Markdown 笔记正文长度和笔记数量。删除文字会减少总字数。 |
| 每日与每月字数 | 旧笔记正文通过索引归到笔记日期；之后可确认的新增内容归到本地编辑日期。删除内容不扣减已确认的新增记录，因此累计字数可能与当前总字数不同。 |
| 每日篇数与写作天数 | 同一天的同一篇笔记只计一次；有正数计入字数的日期算一个写作日。 |

汉字逐字计数，英文等非汉字文本按单词计数，连续数字算一个单位。Markdown 标记不计入，标题、列表、表格、引用和链接文字会计入。默认排除 YAML、代码块、行内代码、图片和嵌入；可在设置中启用 YAML 和代码块计数，行内代码始终不计入。

<details>
<summary>旧笔记日期与计数限制</summary>

- **旧笔记日期**：优先使用文件创建时间；缺失、无效或在未来时，使用 YAML 的 `created` 属性，例如 `created: 2026-11-08`。两者都无效时，笔记仍纳入总量，但不会放进时间线。复制和迁移可能改变文件创建时间，索引无法还原插件启用前逐日的真实写作量。
- **编辑中的字数**：编辑时先显示预览，Obsidian 保存后才写入长期统计；重复保存同一内容不重复计数。
- **未完整计量**：跨午夜且无法可靠拆分的改动、超出差异预算的改写会标记为未完整计量。读取失败或超过计数上限的笔记不贡献总字数。

</details>

## 故障排查

| 情况 | 建议操作 |
| --- | --- |
| 插件未出现在列表 | 确认安装目录下直接包含 `manifest.json`，然后重启 Obsidian。 |
| 有旧笔记没显示在热力图 | 检查文件是否被排除、文件创建时间或 YAML `created` 是否有效，再重建索引。 |
| 底栏数字与总字数不同 | 底栏显示今天计入的字数；总字数反映当前笔记正文。 |
| 升级后需要恢复统计 | 检查原插件目录中的 `data.json` 是否仍在，或在退出 Obsidian 后恢复备份。 |

仍有问题？请在 [GitHub Issues](https://github.com/Ckxkx/writing-dashboard/issues) 提供插件版本、Obsidian 版本、操作系统和复现步骤；无需上传整个 Vault 或 `data.json`。

## 开发

<p>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Obsidian_API-7C3AED?logo=obsidian&amp;logoColor=white" alt="Obsidian Plugin API">
  <img src="https://img.shields.io/badge/esbuild-FFCF00?logo=esbuild&amp;logoColor=black" alt="esbuild">
</p>

使用 Node.js 22：

```sh
npm ci
npm run check
npm test
npm run build
```

构建会生成 `main.js`；运行 `npm run dev` 可持续构建。[版本记录](CHANGELOG.md) · [第三方依赖许可](THIRD-PARTY-NOTICES.txt)

## 网络与隐私

Writing Dashboard runs locally and does not collect telemetry or send your notes or writing statistics to a server.

设置和统计保存在当前 Vault 的 `.obsidian/plugins/writing-dashboard/data.json`，其中包含笔记路径与字数统计，不包含笔记正文。备份时建议先退出 Obsidian；插件不会合并多个设备同时写入的统计文件。
