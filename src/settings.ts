import { App, Modal, normalizePath, Notice, PluginSettingTab, Setting, TFile, TFolder, type ButtonComponent, type SettingDefinitionItem } from "obsidian";
import type WritingDashboard from "./main";
import { importPath, type Settings } from "./model";

function destructive(button: ButtonComponent): ButtonComponent {
  if (typeof button.setDestructive === "function") return button.setDestructive();
  button.buttonEl.addClass("mod-warning");
  return button;
}

class ResetModal extends Modal {
  constructor(app: App, private readonly reset: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("清空写作统计？");
    this.contentEl.createEl("p", { text: "这会清空写作记录和索引，并重新扫描当前字数。你的笔记不会改变。此操作无法撤销。" });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => destructive(button.setButtonText("清空统计")).onClick(() => {
        this.reset();
        this.close();
      }));
  }
}

type Row = { name: string; desc: string; render: (setting: Setting) => void };
type Group = { type: "group"; heading: string; items: Row[] };

export class DashboardSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WritingDashboard) { super(app, plugin); }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups();
  }

  override display(): void {
    this.containerEl.empty();
    for (const group of this.groups()) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        row.render(new Setting(this.containerEl).setName(row.name).setDesc(row.desc));
      }
    }
  }

  private groups(): Group[] {
    const plugin = this.plugin;
    const toggle = (key: "tracking" | "frontmatter" | "codeBlocks" | "monthly",
      name: string, desc: string, rebaseline = false): Row => ({
      name, desc,
      render: setting => {
        setting.addToggle(control => control.setValue(plugin.data.settings[key])
          .onChange(value => plugin.update({ [key]: value }, rebaseline)));
      },
    });
    const paths = (key: "folders" | "paths", name: string, example: string): Row => ({
      name, desc: "每行一个 Vault 相对路径。修改后会重新建立字数基线。",
      render: setting => {
        let value = plugin.data.settings[key].join("\n");
        setting.addTextArea(text => text.setPlaceholder(example).setValue(value).onChange(next => { value = next; }))
          .addButton(button => button.setButtonText("应用").onClick(() => {
            const list = [...new Set(value.split(/\r?\n/).map(path => path.trim()).filter(Boolean)
              .map(path => normalizePath(path)).filter(path => path && path !== "/"))];
            plugin.update({ [key]: list }, true);
          }));
      },
    });

    return [
      {
        type: "group", heading: "写作追踪", items: [
          toggle("tracking", "记录写作活动", "关闭后继续更新当前总字数，暂停记录每日活动。"),
          toggle("frontmatter", "统计 YAML Frontmatter", "计入 YAML 中可计数的键和值。修改后会重新建立字数基线。", true),
          toggle("codeBlocks", "统计代码块", "计入围栏和缩进代码块中的内容。行内代码不计入。", true),
          paths("folders", "排除文件夹", "Templates\nArchive/Imported"),
          paths("paths", "排除文件", "Inbox.md"),
          {
            name: "补录旧笔记", desc: "每行一个要导入的笔记或文件夹路径。只扫描这些路径，不接受 Vault 根目录。",
            render: setting => {
              let value = plugin.data.settings.importPaths.join("\n");
              setting.addTextArea(text => text.setPlaceholder("日记\n草稿/旧稿.md").setValue(value)
                .onChange(next => { value = next; }))
                .addButton(button => button.setButtonText("保存并重建").onClick(() => {
                  const requested = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                  const imports: string[] = [];
                  for (const line of requested) {
                    const path = importPath(line);
                    const entry = path && plugin.app.vault.getAbstractFileByPath(path);
                    const valid = entry instanceof TFolder && !entry.isRoot() ||
                      entry instanceof TFile && entry.extension.toLowerCase() === "md";
                    if (!path || !valid) {
                      new Notice("请填写有效的 Markdown 笔记或文件夹路径，不能选择 Vault 根目录：" + line);
                      return;
                    }
                    imports.push(path);
                  }
                  plugin.update({ importPaths: [...new Set(imports)] });
                  plugin.buildStatistics();
                }));
            },
          },
        ],
      },
      {
        type: "group", heading: "仪表盘", items: [
          {
            name: "热力图阈值", desc: "输入等级 2、3、4 的起始字数，三个整数须严格递增且均大于 1。",
            render: setting => {
              let value = plugin.data.settings.thresholds.join(", ");
              setting.addText(text => text.setValue(value).onChange(next => { value = next; }))
                .addButton(button => button.setButtonText("应用").onClick(() => {
                  const [low, middle, high, ...extra] = value.split(/[,，]/).map(v => Number(v.trim()));
                  if (extra.length || ![low, middle, high].every(Number.isSafeInteger) ||
                      low <= 1 || middle <= low || high <= middle) {
                    new Notice("请输入三个递增整数，例如 200, 500, 1000。");
                    return;
                  }
                  const thresholds: Settings["thresholds"] = [low, middle, high];
                  plugin.update({ thresholds });
                }));
            },
          },
          {
            name: "日期显示格式", desc: "Moment 格式，例如 YYYY年M月D日 或 YYYY-MM-DD。",
            render: setting => {
              let format = plugin.data.settings.dateFormat;
              setting.addText(text => text.setValue(format).onChange(value => { format = value; }))
                .addButton(button => button.setButtonText("应用").onClick(() => {
                  const value = format.trim();
                  if (!value || value.length > 80) { new Notice("日期格式长度必须在 1–80 个字符之间。"); return; }
                  plugin.update({ dateFormat: value });
                }));
            },
          },
          toggle("monthly", "显示月度柱状图", "查看 12 个月的新增字数。"),
          {
            name: "重建写作索引", desc: "重新扫描纳入统计的 Markdown 笔记，保留已有写作活动。",
            render: setting => {
              setting.addButton(button => button.setButtonText("重建索引").onClick(() => plugin.buildStatistics()));
            },
          },
          {
            name: "重置统计", desc: "清空写作记录和索引，并重新建立基线。设置和笔记会保留。",
            render: setting => {
              setting.addButton(button => destructive(button.setButtonText("重置统计…"))
                .onClick(() => new ResetModal(this.app, () => plugin.reset()).open()));
            },
          },
        ],
      },
    ];
  }
}

