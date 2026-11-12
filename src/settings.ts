import { App, Modal, normalizePath, Notice, PluginSettingTab, Setting } from "obsidian";
import type WritingDashboard from "./main";
import type { Settings } from "./model";

class ResetModal extends Modal {
  constructor(app: App, private readonly reset: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("清空写作统计？");
    this.contentEl.createEl("p", { text: "这会清空写作记录和索引，并重新扫描当前字数。你的笔记不会改变。此操作无法撤销。" });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => button.setButtonText("清空统计").setWarning().onClick(() => {
        this.reset();
        this.close();
      }));
  }
}

export class DashboardSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WritingDashboard) { super(app, plugin); }

  display(): void {
    const { containerEl: el, plugin } = this;
    const s = plugin.data.settings;
    el.empty();
    const toggle = (key: "tracking" | "frontmatter" | "codeBlocks" | "monthly",
      name: string, description: string, rebaseline = false) => {
      new Setting(el).setName(name).setDesc(description).addToggle(control => control
        .setValue(s[key]).onChange(value => plugin.update({ [key]: value }, rebaseline)));
    };

    new Setting(el).setName("写作追踪").setHeading();
    toggle("tracking", "记录写作活动", "关闭后继续更新当前总字数，暂停记录每日活动。", true);
    toggle("frontmatter", "统计 YAML Frontmatter", "计入 YAML 中可计数的键和值。修改后会重新建立字数基线。", true);
    toggle("codeBlocks", "统计代码块", "计入围栏和缩进代码块中的内容。行内代码不计入。", true);
    const paths = (key: "folders" | "paths", name: string, example: string) => {
      let value = s[key].join("\n");
      new Setting(el).setName(name).setDesc("每行一个 Vault 相对路径。修改后会重新建立字数基线。")
        .addTextArea(text => text.setPlaceholder(example).setValue(value).onChange(next => { value = next; }))
        .addButton(button => button.setButtonText("应用").onClick(() => {
          const list = [...new Set(value.split(/\r?\n/).map(path => path.trim()).filter(Boolean)
            .map(path => normalizePath(path)).filter(path => path && path !== "/"))];
          plugin.update({ [key]: list }, true);
        }));
    };
    paths("folders", "排除文件夹", "Templates\nArchive/Imported");
    paths("paths", "排除文件", "Inbox.md");

    new Setting(el).setName("仪表盘").setHeading();
    let thresholds = s.thresholds.join(", ");
    new Setting(el).setName("热力图阈值").setDesc("输入等级 2、3、4 的起始字数，三个整数须严格递增且均大于 1。")
      .addText(text => text.setValue(thresholds).onChange(value => { thresholds = value; }))
      .addButton(button => button.setButtonText("应用").onClick(() => {
        const parts = thresholds.split(/[,，]/).map(v => Number(v.trim()));
        if (parts.length !== 3 || parts.some((n, i) => !Number.isSafeInteger(n) || n <= (parts[i - 1] ?? 1))) {
          new Notice("请输入三个递增整数，例如 200, 500, 1000。");
          return;
        }
        plugin.update({ thresholds: parts as Settings["thresholds"] });
      }));
    let format = s.dateFormat;
    new Setting(el).setName("日期显示格式").setDesc("Moment 格式，例如 YYYY年M月D日 或 YYYY-MM-DD。")
      .addText(text => text.setValue(format).onChange(value => { format = value; }))
      .addButton(button => button.setButtonText("应用").onClick(() => {
        const value = format.trim();
        if (!value || value.length > 80) { new Notice("日期格式长度必须在 1–80 个字符之间。"); return; }
        plugin.update({ dateFormat: value });
      }));
    toggle("monthly", "显示月度柱状图", "查看 12 个月的新增字数。");
    new Setting(el).setName("重建写作索引")
      .setDesc("重新扫描笔记字数和日期，保留已记录的写作活动。")
      .addButton(button => button.setButtonText("重建索引").onClick(() => plugin.buildStatistics()));

    new Setting(el).setName("重置统计").setDesc("清空写作记录和索引，并重新建立基线。设置和笔记会保留。")
      .addButton(button => button.setButtonText("重置统计…").setWarning()
        .onClick(() => new ResetModal(this.app, () => plugin.reset()).open()));
  }
}
