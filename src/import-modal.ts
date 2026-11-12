import { Modal, Setting, type App } from "obsidian";
import type WritingDashboard from "./main";

export class ImportModal extends Modal {
  constructor(app: App, private readonly plugin: WritingDashboard, private readonly offerRefresh: boolean) { super(app); }

  onOpen(): void {
    this.titleEl.setText("补录旧笔记");
    this.contentEl.addClass("wd-import-modal");
    this.contentEl.createEl("p", { text: "重建索引只刷新本机已纳入的笔记。要补录其他笔记，请填写要扫描的文件或文件夹；也可以在文件列表中长按笔记或文件夹，选择「补录写作统计」。" });
    this.contentEl.createEl("p", { text: "每行一个相对于 Vault 的路径，例如「日记」或「草稿/旧稿.md」。补录不会导入另一台设备的逐日编辑记录。" });
    let value = this.plugin.data.settings.importPaths.join("\n");
    new Setting(this.contentEl).addTextArea(input => {
      input.setPlaceholder("日记\n草稿/旧稿.md").setValue(value).onChange(text => { value = text; });
      input.inputEl.setAttribute("aria-label", "要补录的文件或文件夹路径");
      input.inputEl.rows = 4;
    });
    const actions = new Setting(this.contentEl);
    if (this.offerRefresh) actions.addButton(button => button.setButtonText("仅刷新已有笔记").onClick(() => {
      this.close();
      this.plugin.buildStatistics();
    }));
    actions.addButton(button => button.setButtonText("保存并补录").setCta().onClick(() => {
      if (this.plugin.saveImportPaths(value, true)) this.close();
    }));
  }

  onClose(): void { this.contentEl.empty(); }
}
