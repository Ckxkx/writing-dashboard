import { MarkdownView, Notice, Platform, Plugin, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { Activity } from "./activity";
import { dateKey } from "./dates";
import { fresh, importPath, included, INDEX_VERSION, load, type Data, type Settings } from "./model";
import { addCreatedIfMissing, NewNoteDates } from "./creation";
import { ImportModal } from "./import-modal";
import { DashboardView, VIEW } from "./view";
import { DashboardSettings } from "./settings";
import { Tracker } from "./tracker";
import { Storage } from "./storage";
import { timelineDay } from "./history";
import { readFrontmatter, sameText } from "./words";

const formatter = new Intl.NumberFormat("zh-CN");

function importable(entry: TAbstractFile | null): boolean {
  return entry instanceof TFolder && !entry.isRoot() ||
    entry instanceof TFile && entry.extension.toLowerCase() === "md";
}

function selectedMarkdownPaths(entries: readonly TAbstractFile[], settings: Settings): string[] {
  const result: string[] = [], stack = [...entries];
  while (stack.length) {
    const child = stack.pop()!;
    if (child instanceof TFolder && !child.isRoot() &&
        !settings.folders.some(folder => child.path === folder || child.path.startsWith(folder + "/"))) {
      for (const item of child.children) stack.push(item);
    }
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
  private readonly newNotes = new NewNoteDates<TFile>();
  private readonly stamping = new WeakSet<TFile>();
  private readonly stampAgain = new WeakSet<TFile>();

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
      listImports: paths => selectedMarkdownPaths(paths.flatMap(path => {
        const entry = vault.getAbstractFileByPath(path);
        return entry ? [entry] : [];
      }), this.data.settings),
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
      this.requestRebuild();
    } });
    this.addCommand({ id: "import-notes", name: "补录旧笔记", callback: () => this.openImport() });
    if (!Platform.isMobile) {
      this.status = this.addStatusBarItem().createEl("button", { cls: "wd-status-button", type: "button" });
      this.status.title = "今日篇数和字数。点击展开或收起右侧写作仪表盘。";
      this.registerDomEvent(this.status, "click", () => this.show(true));
    }
    this.updateStatus();
    this.addSettingTab(new DashboardSettings(this.app, this));
    workspace.onLayoutReady(() => {
      if (this.stopped) return;
      workspace.detachLeavesOfType("writing-dashboard");
      void this.prepareSideLeaf().catch(error => console.error("Writing Dashboard", error));
      const watch = (file: TFile | null) => {
        if (file?.extension.toLowerCase() !== "md") return;
        this.tracker.watch(file.path);
        this.newNotes.opened(file);
        void this.stampNewNote(file);
      };
      this.registerEvent(workspace.on("file-open", watch));
      this.registerEvent(workspace.on("file-menu", (menu, entry) => {
        const path = importPath(entry.path);
        if (!path || !importable(entry)) return;
        menu.addItem(item => item.setTitle("补录写作统计").setIcon("chart-no-axes-combined").onClick(() => {
          this.update({ importPaths: [...new Set([...this.data.settings.importPaths, path])] });
          this.buildStatistics();
        }));
      }));
      this.registerEvent(workspace.on("editor-change", (editor, info) => {
        if (info.file?.extension.toLowerCase() === "md") this.tracker.edit(info.file.path, editor.getValue());
      }));
      this.registerEvent(vault.on("create", file => {
        if (!(file instanceof TFile) || !included(file.path, this.data.settings)) return;
        const blank = file.stat.size === 0;
        this.tracker.arrive(file.path, blank);
        if (blank && this.data.settings.autoCreated) {
          this.newNotes.created(file, dateKey());
          if (workspace.getActiveFile() === file) {
            this.newNotes.opened(file);
            void this.stampNewNote(file);
          }
        }
      }));
      this.registerEvent(vault.on("modify", file => {
        if (file instanceof TFile) {
          this.tracker.enqueue(file.path);
          void this.stampNewNote(file);
        }
      }));
      this.registerEvent(vault.on("rename", (file, old) => {
        this.tracker.move(old, file.path, file instanceof TFolder);
        if (file instanceof TFile) void this.stampNewNote(file);
      }));
      this.registerEvent(vault.on("delete", file => {
        if (file instanceof TFile) this.newNotes.done(file);
        this.tracker.remove(file.path, file instanceof TFolder);
      }));
      void this.tracker.baseline(this.data.history?.indexVersion !== INDEX_VERSION);
      watch(workspace.getActiveFile());
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

  private async stampNewNote(file: TFile): Promise<void> {
    const day = this.newNotes.pending(file);
    if (!day || this.stopped) return;
    if (this.stamping.has(file)) {
      this.stampAgain.add(file);
      return;
    }
    const { vault, workspace, fileManager } = this.app;
    this.stamping.add(file);
    try {
      const source = await vault.cachedRead(file);
      if (this.stopped || !this.data.settings.autoCreated || !included(file.path, this.data.settings) ||
        vault.getAbstractFileByPath(file.path) !== file || !this.newNotes.pending(file)) {
        this.newNotes.done(file);
        return;
      }
      const active = workspace.getActiveViewOfType(MarkdownView);
      // Never apply a disk edit over a newer editor buffer. Autosave will
      // retry with the original creation day captured in the create event.
      if (active?.file === file && !sameText(active.editor.getValue(), source)) return;
      this.newNotes.done(file);
      const yaml = readFrontmatter(source);
      if (yaml && /^(?:created|"created"|'created'):/im.test(yaml[1])) return;
      await fileManager.processFrontMatter(file, (frontmatter: unknown) => addCreatedIfMissing(frontmatter, day));
    } catch (error) {
      console.warn("Writing Dashboard: could not set created date", file.path, error);
    } finally {
      this.stamping.delete(file);
      if (this.stampAgain.delete(file) && this.newNotes.pending(file)) void this.stampNewNote(file);
    }
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
        ["frontmatter", "codeBlocks", "folders", "paths", "preferCreated"].some(key => Object.hasOwn(patch, key)));
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
    data.nextId = this.data.nextId;
    Object.assign(data.files, this.data.files);
    data.history = { indexVersion: INDEX_VERSION, days: {} };
    this.tracker.reset(new Activity(data));
    void this.tracker.baseline();
    this.store.change();
    void this.store.flush();
  }

  openImport(offerRefresh = false): void {
    new ImportModal(this.app, this, offerRefresh).open();
  }

  requestRebuild(): void {
    if (Platform.isMobile && !this.data.settings.importPaths.length) this.openImport(true);
    else this.buildStatistics();
  }

  saveImportPaths(value: string, requireSelection = false): boolean {
    const requested = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!requested.length && requireSelection) {
      new Notice("请填写至少一个要补录的笔记或文件夹路径。");
      return false;
    }
    const paths = new Set<string>();
    for (const line of requested) {
      const path = importPath(line);
      if (!path || !importable(this.app.vault.getAbstractFileByPath(path))) {
        new Notice("找不到这个 Markdown 笔记或文件夹，或选择了 Vault 根目录：" + line);
        return false;
      }
      paths.add(path);
    }
    this.update({ importPaths: [...paths] });
    this.buildStatistics();
    return true;
  }

  buildStatistics(): void {
    if (this.building) return;
    this.building = this.configuring = this.configuring.then(async () => {
      await this.tracker.settle();
      if (this.stopped) return;
      const paths = this.data.settings.importPaths;
      const missing = paths.filter(path => !importable(this.app.vault.getAbstractFileByPath(path))).length;
      await this.tracker.baseline(true, paths);
      if (this.stopped) return;
      const total = formatter.format(this.activity.fileCount);
      const extra = missing ? `；有 ${formatter.format(missing)} 个补录路径在本机不可用`
        : !paths.length ? "；可在文件列表中选择要补录的旧笔记" : "";
      new Notice(`Writing Dashboard：索引已更新，本机纳入 ${total} 篇笔记${extra}。`);
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
