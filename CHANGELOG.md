# Changelog

## [0.3.6]

- Fixed the reset buttons' API compatibility with Obsidian 1.8.7. Both buttons retain destructive styling and clearing statistics still requires confirmation.

Update all three plugin files together and keep data.json.

## [0.3.5]

- Removed automatic Vault-wide enumeration. Startup refreshes known notes and activity follows the notes you open, create, or edit.
- Added explicit historical import for selected Markdown paths and folders. Upgrades preserve existing statistics.
- Fixed unsafe threshold parsing, switched to window-owned timers, and updated destructive buttons while keeping compatibility with older Obsidian versions.

Update all three plugin files together and keep data.json.

## [0.3.4]

- Added searchable settings on Obsidian 1.13+ while retaining support for Obsidian 1.8.7+.
- Improved validation of saved statistics and settings, and updated timers and CSS for Obsidian compatibility.
- Adopted Apache License 2.0 and added signed build provenance for the three Obsidian release files.
- Made English the default README; a separate Simplified Chinese README is still available.

Install or update by placing main.js, manifest.json and styles.css in the same plugin folder. Keep your existing data.json.

## [0.3.3]

首个 GitHub Release。

- 年度概览包含写作天数、累计字数和 Vault 总量；年份筛选和维护操作集中在侧栏顶部。
- 热力图打开时定位到今天，支持查看每日笔记明细；月度柱状图用于浏览全年趋势。
- 编辑旧笔记时，新写入的内容归到编辑当天。桌面状态栏实时显示今日篇数和字数，点击可展开或收起仪表盘。
- 提供本地笔记索引、Markdown 计数设置、路径排除及重建索引功能。

支持 Obsidian 1.8.7 或更新版本。首次安装请下载 ZIP 解压；从本地开发版升级时，覆盖插件文件并保留 `data.json`。




