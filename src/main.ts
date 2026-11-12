import { Notice, Plugin, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { Activity } from "./activity";
import { dateKey } from "./dates";
import { fresh, INDEX_VERSION, load, type Data, type Settings } from "./model";
import { DashboardView, VIEW } from "./view";
import { DashboardSettings } from "./settings";
import { Tracker } from "./tracker";
import { Storage } from "./storage";
import { timelineDay } from "./history";

const formatter = new Intl.NumberFormat("zh-CN");

function markdownPaths(file: TAbstractFile): string[] {
  if (file instanceof TFile) return file.extension.toLowerCase() === "md" ? [file.path] : [];
  const result: string[] = [], stack = file instanceof TFolder ? [...file.children] : [];
  while (stack.length) {
    const child = stack.pop()!;
    if (child instanceof TFolder) for (const item of child.children) stack.push(item);
    else if (child instanceof TFile && child.extension.toLowerCase() === "md") result.push(child.path);
  }
  return result;
}

export default class WritingDashboard extends Plugin {
  tracker!: Tracker;
  private store!: Storage<Data>;
  private stopped = false;
  private configuring = Promise.resolve();
  private opening?: Promise<void>;
  private sideLeaf?: Promise<WorkspaceLeaf>;
  private building?: Promise<void>;
  private renderTimer?: number;
  private status?: HTMLButtonElement;

  get activity(): Activity { return this.tracker.activity; }
  get data(): Data { return this.activity.data; }

  async onload(): Promise<void> {
    let data: Data;
    try { data = load(await this.loadData()); }
    catch (error) {
      console.error("Writing Dashboard", error);
      new Notice("Writing Dashboard：无法读取统计数据，未覆盖原文件。");
      return;
    }
    const { vault, workspace } = this.app;
    this.tracker = new Tracker(new Activity(data), {
      // Vault totals and the initial index need the Markdown note list.
      // Tracker applies path exclusions before reading individual notes.
      list: () => vault.getMarkdownFiles().map(file => file.path),
      exists: path => vault.getAbstractFileByPath(path) instanceof TFile,
      stat: path => {
        const file = vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file.stat : undefined;
      },
      read: async path => {
        const file = vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        try {
          const source = await vault.cachedRead(file);
          return vault.getAbstractFileByPath(path) === file ? source : null;
        } catch (error) {
          console.warn("Writing Dashboard: unable to read", path, error);
          return null;
        }
      },
    }, persist => {
      if (persist) this.store.change();
      this.refresh();
    });
    let warned = false;
    this.store = new Storage(() => this.data, async value => {
      await this.saveData(value);
      warned = false;
    }, error => {
      console.error("Writing Dashboard", error);
      if (!warned) new Notice("Writing Dashboard：保存统计失败。插件运行时会自动重试。");
      warned = true;
    });

    this.registerView(VIEW, leaf => new DashboardView(leaf, this));
    this.addRibbonIcon("chart-no-axes-combined", "Writing Dashboard", () => this.show());
    this.addCommand({ id: "open", name: "Open dashboard", callback: () => this.show() });
    this.addCommand({ id: "build-statistics", name: "重建写作索引", callback: () => {
      this.show();
      this.buildStatistics();
    } });
    this.status = this.addStatusBarItem().createEl("button", { cls: "wd-status-button", type: "button" });
    this.status.title = "今日篇数和字数。点击展开或收起右侧写作仪表盘。";
    this.registerDomEvent(this.status, "click", () => this.show(true));
    this.updateStatus();
    this.addSettingTab(new DashboardSettings(this.app, this));
    workspace.onLayoutReady(() => {
      if (this.stopped) return;
      workspace.detachLeavesOfType("writing-dashboard");
      void this.prepareSideLeaf().catch(error => console.error("Writing Dashboard", error));
      this.registerEvent(workspace.on("editor-change", (editor, info) => {
        if (info.file?.extension.toLowerCase() === "md") this.tracker.edit(info.file.path, editor.getValue());
      }));
      this.registerEvent(vault.on("create", file => {
        if (file instanceof TFile) this.tracker.enqueue(file.path, true);
      }));
      this.registerEvent(vault.on("modify", file => {
        if (file instanceof TFile) this.tracker.enqueue(file.path);
      }));
      this.registerEvent(vault.on("rename", (file, old) => {
        this.tracker.move(old, file.path, markdownPaths(file), file instanceof TFolder);
      }));
      this.registerEvent(vault.on("delete", file => this.tracker.remove(file.path, file instanceof TFolder)));
      void this.tracker.baseline(this.data.history?.indexVersion !== INDEX_VERSION);
    });
    this.registerEvent(workspace.on("quit", tasks => {
      tasks.addPromise(this.tracker.settle().then(() => this.store.flush()));
    }));
    let today = dateKey();
    this.registerInterval(window.setInterval(() => {
      const now = dateKey();
      if (today !== now) { today = now; this.refresh(); }
    }, 30_000));
  }

  private show(toggle = false): void {
    if (this.opening) return;
    this.opening = this.open(toggle).catch(error => {
      console.error("Writing Dashboard", error);
      new Notice("无法打开 Writing Dashboard。");
    }).finally(() => { this.opening = undefined; });
  }

  private async open(toggle: boolean): Promise<void> {
    const { workspace } = this.app;
    const leaf = await this.prepareSideLeaf();
    if (this.stopped) return;
    const right = workspace.rightSplit;
    if (toggle && !right.collapsed && leaf.view instanceof DashboardView && leaf.view.containerEl.isShown()) {
      right.collapse();
      return;
    }
    await workspace.revealLeaf(leaf);
    if (!this.stopped && leaf.view instanceof DashboardView) leaf.view.showToday();
  }

  private prepareSideLeaf(): Promise<WorkspaceLeaf> {
    return this.sideLeaf ??= this.app.workspace.ensureSideLeaf(VIEW, "right", {
      active: false, reveal: false,
    }).finally(() => { this.sideLeaf = undefined; });
  }

  private updateStatus(): void {
    const today = dateKey();
    const { count, words } = timelineDay(this.data, today, this.tracker.liveDays[today]);
    this.status?.setText(`今日 ${formatter.format(count)} 篇 · ${formatter.format(words)} 字`);
  }

  refresh(): void {
    if (this.renderTimer !== undefined || this.stopped) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = undefined;
      this.updateStatus();
      for (const { view } of this.app.workspace.getLeavesOfType(VIEW)) {
        if (view instanceof DashboardView) view.render();
      }
    }, 120);
  }

  update(patch: Partial<Settings>, rebaseline = false): void {
    const apply = () => {
      if (this.stopped) return;
      Object.assign(this.data.settings, patch);
      if (rebaseline) void this.tracker.baseline(this.data.history?.indexVersion !== INDEX_VERSION ||
        ["frontmatter", "codeBlocks", "folders", "paths"].some(key => Object.hasOwn(patch, key)));
      this.store.change();
      this.refresh();
    };
    if (rebaseline) this.configuring = this.configuring.then(async () => {
      await this.tracker.settle();
      apply();
    });
    else apply();
  }

  reset(): void {
    const data = fresh(this.data.settings);
    data.history = { indexVersion: INDEX_VERSION, days: {} };
    this.tracker.reset(new Activity(data));
    void this.tracker.baseline();
    this.store.change();
    void this.store.flush();
  }

  buildStatistics(): void {
    if (this.building) return;
    this.building = this.configuring = this.configuring.then(async () => {
      await this.tracker.settle();
      if (this.stopped) return;
      await this.tracker.baseline(true);
      if (this.stopped) return;
      new Notice("Writing Dashboard：已重建写作索引。");
    }).catch(error => {
      console.error("Writing Dashboard", error);
      if (!this.stopped) new Notice("Writing Dashboard：重建索引失败。");
    }).finally(() => {
      this.building = undefined;
    });
  }

  onunload(): void {
    this.stopped = true;
    if (this.renderTimer !== undefined) window.clearTimeout(this.renderTimer);
    this.tracker?.stop();
    void this.store?.close();
    if (this.tracker) this.app.workspace.detachLeavesOfType(VIEW);
  }
}
