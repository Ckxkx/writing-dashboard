import { ItemView, Menu, Notice, Platform, TFile, moment, setIcon, type WorkspaceLeaf } from "obsidian";
import type WritingDashboard from "./main";
import { calendar, dateKey, localDate } from "./dates";
import { timelineDates, timelineDay, timelineYear } from "./history";

export const VIEW = "writing-dashboard-sidebar";
const fmt = new Intl.NumberFormat("zh-CN");
const num = (n: number) => fmt.format(n);
const axisNum = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const formatDate = moment as unknown as (date: Date) => { format(pattern: string): string };
const svgNS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(parent: HTMLElement | SVGElement, tag: K,
  attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = parent.ownerDocument.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  parent.append(el);
  return el;
}

export class DashboardView extends ItemView {
  private year = new Date().getFullYear();
  private selected = dateKey();
  private focusDate = this.selected;
  private renderedYear?: number;
  private browsedDate = false;
  private heatObserver?: ResizeObserver;
  private headerMenu?: Menu;
  private tip?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WritingDashboard) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return "Writing Dashboard"; }
  getIcon(): string { return "chart-no-axes-combined"; }
  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> {
    this.heatObserver?.disconnect();
    this.headerMenu?.hide();
    this.tip = undefined;
    this.contentEl.empty();
  }

  private format(day: string): string {
    return formatDate(localDate(day)).format(this.plugin.data.settings.dateFormat);
  }

  private selectDate(day: string): void {
    this.selected = this.focusDate = day;
    this.year = localDate(day).getFullYear();
  }

  showToday(): void {
    this.browsedDate = false;
    this.renderedYear = undefined;
    this.selectDate(dateKey());
    this.render();
  }

  private tooltip(target: Element, lines: string[]): void {
    const tip = this.tip;
    if (!tip) return;
    tip.empty();
    tip.createEl("strong", { text: lines[0] });
    for (const line of lines.slice(1)) tip.createDiv({ text: line });
    tip.hidden = false;
    const { left, top, width, bottom } = target.getBoundingClientRect();
    const win = target.ownerDocument.defaultView!;
    const x = Math.max(8, Math.min(left + width / 2 - tip.offsetWidth / 2, win.innerWidth - tip.offsetWidth - 8));
    const y = top - tip.offsetHeight - 9;
    tip.style.left = x + "px";
    tip.style.top = (y < 8 ? bottom + 8 : y) + "px";
  }

  private hideTip(): void { if (this.tip) this.tip.hidden = true; }

  private openHeaderMenu(button: HTMLButtonElement): void {
    if (this.headerMenu) { this.headerMenu.hide(); return; }
    const menu = this.headerMenu = new Menu();
    const scanning = this.plugin.tracker.scanning;
    menu.addItem(item => item.setTitle(scanning ? "正在扫描笔记…" : "重建索引").setIcon("refresh-cw")
      .setDisabled(scanning).onClick(() => {
        if (!this.plugin.tracker.scanning) this.plugin.requestRebuild();
      }));
    menu.addItem(item => item.setTitle("补录旧笔记…").setIcon("folder-plus")
      .setDisabled(scanning).onClick(() => this.plugin.openImport()));
    menu.onHide(() => {
      if (this.headerMenu !== menu) return;
      this.headerMenu = undefined;
      this.contentEl.querySelector(".wd-more")?.setAttribute("aria-expanded", "false");
    });
    button.setAttribute("aria-expanded", "true");
    const { left, bottom, width } = button.getBoundingClientRect();
    menu.showAtPosition({ x: left, y: bottom + 4, width, left: true }, button.ownerDocument);
  }

  private cards(parent: HTMLElement, words: number, files: number): void {
    const grid = parent.createDiv({ cls: "wd-cards wd-totals" });
    for (const [label, value] of [["总字数", words], ["总篇数", files]] as const) {
      const card = grid.createDiv({ cls: "wd-card" });
      card.createDiv({ text: label, cls: "wd-card-label" });
      card.createDiv({ text: num(value), cls: "wd-card-number" });
    }
  }

  render(): void {
    const el = this.contentEl;
    const previousHeat = el.querySelector(".wd-heat-scroll");
    let prevScroll = this.renderedYear === this.year && previousHeat?.clientWidth ? previousHeat.scrollLeft : undefined;
    this.heatObserver?.disconnect();
    const active = el.ownerDocument.activeElement;
    const focusKey = el.contains(active) ? active?.getAttribute("data-wd-focus") : null;
    el.empty();
    el.addClass("wd-host");
    const root = el.createDiv({ cls: "wd-root" });
    const { data, activity } = this.plugin;
    const today = dateKey();
    const current = Number(today.slice(0, 4));
    const { liveDays, liveNet } = this.plugin.tracker;
    const dates = timelineDates(data, today, liveDays);
    const years = [...new Set([current, ...dates.map(key => Number(key.slice(0, 4)))])].sort((a, b) => b - a);
    if ((!this.browsedDate && this.selected !== today) || this.selected > today || !years.includes(this.year)) {
      this.selectDate(today);
      prevScroll = undefined;
    }
    const stats = timelineYear(data, this.year, dates, liveDays);
    this.renderedYear = this.year;
    this.tip = root.createDiv({ cls: "wd-tooltip" });
    this.tip.setAttribute("aria-hidden", "true");
    this.tip.hidden = true;
    const header = root.createEl("header", { cls: "wd-header" });
    const eyebrow = header.createDiv({ cls: "wd-eyebrow" });
    setIcon(eyebrow.createSpan({ cls: "wd-brand-icon", attr: { "aria-hidden": "true" } }), "pen-line");
    eyebrow.createSpan({ text: "写作日志" });
    header.createEl("h1", { text: "Writing Dashboard" });
    const context = header.createDiv({ cls: "wd-header-context" });
    const summary = context.createEl("p", { cls: "wd-header-summary" });
    summary.createEl("strong", { text: `${this.year} 年` });
    summary.createSpan({ text: ` · ${num(stats.active)} 个写作日` });
    summary.createSpan({ text: ` · ${num(stats.words)} 字` });
    const tools = context.createDiv({ cls: "wd-header-tools", attr: { role: "group", "aria-label": "仪表盘操作" } });
    const yearField = tools.createDiv({ cls: "wd-year-field" });
    const yearSelect = yearField.createEl("select", { cls: "wd-year-select",
      attr: { "aria-label": "年份", "data-wd-focus": "year" } });
    setIcon(yearField.createSpan({ cls: "wd-year-chevron", attr: { "aria-hidden": "true" } }), "chevron-down");
    for (const year of years) yearSelect.createEl("option", { value: String(year), text: year + " 年" });
    yearSelect.value = String(this.year);
    yearSelect.onchange = () => {
      this.browsedDate = true;
      const year = Number(yearSelect.value);
      this.selectDate(year === current ? today : dates.filter(day => day.startsWith(year + "-"))
        .sort().at(-1) ?? year + "-12-31");
      this.render();
    };
    const more = tools.createEl("button", { cls: "wd-more", type: "button", attr: {
      title: "更多操作", "aria-label": "更多操作", "aria-haspopup": "menu",
      "aria-expanded": String(!!this.headerMenu), "data-wd-focus": "more",
    } });
    setIcon(more, "ellipsis");
    more.onclick = () => this.openHeaderMenu(more);
    if (this.plugin.tracker.scanning || !data.settings.tracking || activity.unread) {
      const status = root.createDiv({ cls: "wd-status", attr: { role: "status" } });
      if (this.plugin.tracker.scanning) status.createDiv({ text: "正在扫描笔记…" });
      if (!data.settings.tracking) status.createDiv({ text: "写作追踪已暂停。当前总字数仍会更新。" });
      if (activity.unread) status.createDiv({ text: `${num(activity.unread)} 篇笔记无法读取或超过计数上限，未计入字数。` });
    }
    this.cards(root, activity.total + liveNet, activity.fileCount);
    if (Platform.isMobile && !data.settings.importPaths.length && activity.fileCount < 2 &&
        !this.plugin.tracker.scanning) {
      const hint = root.createDiv({ cls: "wd-status wd-import-hint" });
      hint.createSpan({ text: "只显示本机已纳入的笔记。" });
      hint.createEl("button", { type: "button", text: "补录旧笔记", attr: { "data-wd-focus": "import-notes" } })
        .onclick = () => this.plugin.openImport();
    }
    this.heatmap(root, today, stats, prevScroll);
    if (data.settings.monthly) this.chart(root, stats.monthly, today);
    if (focusKey) {
      for (const item of root.querySelectorAll<HTMLElement | SVGElement>("[data-wd-focus]")) {
        if (item.getAttribute("data-wd-focus") === focusKey) { item.focus({ preventScroll: true }); break; }
      }
    }
  }

  private heatmap(root: HTMLElement, today: string, stats: ReturnType<typeof timelineYear>, scroll?: number): void {
    const section = root.createEl("section", { cls: "wd-panel wd-heat" });
    const head = section.createDiv({ cls: "wd-section-head" });
    const title = head.createDiv();
    title.createEl("h2", { text: "写作热力图" });
    title.createEl("p", { text: this.year + " 年 · 全年写作记录" });
    const todayButton = head.createEl("button", { text: "今天", type: "button",
      attr: { "aria-label": "跳到今天", "data-wd-focus": "today" } });
    todayButton.onclick = () => this.showToday();
    const viewport = section.createDiv({ cls: "wd-heat-scroll" });
    viewport.addEventListener("scroll", () => this.hideTip(), { passive: true });
    const grid = viewport.createDiv({ cls: "wd-grid", attr: { role: "group", "aria-label": "全年日期，使用方向键导航" } });
    const cells = calendar(this.year);
    grid.style.setProperty("--wd-weeks", String(cells.at(-1)!.col + 1));
    for (const [index, text] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]] as const) {
      const label = grid.createSpan({ text, cls: "wd-week" });
      label.style.gridArea = `${index + 2} / 1`;
    }
    const elements = new Map<string, HTMLButtonElement>();
    if (!cells.some(cell => cell.date === this.focusDate && cell.date <= today)) this.focusDate = this.selected;
    const thresholds = this.plugin.data.settings.thresholds;
    let lastMonthColumn = -3;
    for (const { date, row, col, month, first } of cells) {
      if (first) {
        const labelCol = Math.max(col, lastMonthColumn + 3);
        lastMonthColumn = labelCol;
        const label = grid.createSpan({ cls: "wd-month", text: `${month + 1}月` });
        label.style.gridArea = `1 / ${labelCol + 2} / 2 / span 3`;
      }
      const isFuture = date > today;
      const day = stats.days.get(date);
      const words = day?.words ?? 0;
      const level = words === 0 ? 0 : 1 + thresholds.filter(threshold => words >= threshold).length;
      const cell = isFuture ? grid.createSpan({ cls: "wd-cell wd-future" }) : grid.createEl("button", { cls: "wd-cell", type: "button" });
      cell.style.gridArea = `${row + 2} / ${col + 2}`;
      cell.setAttribute("data-level", String(level));
      if (isFuture) { cell.setAttribute("aria-hidden", "true"); continue; }
      const button = cell as HTMLButtonElement;
      elements.set(date, button);
      button.tabIndex = date === this.focusDate ? 0 : -1;
      button.setAttribute("aria-pressed", String(date === this.selected));
      button.setAttribute("data-wd-focus", date);
      const lines = [this.format(date), num(words) + " 字", num(day?.count ?? 0) + " 篇笔记"];
      if (day?.skipped) lines.push("有未完整计量的变更");
      button.setAttribute("aria-label", lines.join("，"));
      const show = () => this.tooltip(button, lines);
      button.onpointerenter = show;
      button.onpointerleave = () => this.hideTip();
      button.onfocus = () => {
        elements.get(this.focusDate)?.setAttribute("tabindex", "-1");
        this.focusDate = date;
        button.tabIndex = 0;
        if (button.matches(":focus-visible")) show();
      };
      button.onblur = () => this.hideTip();
      button.onclick = () => {
        this.browsedDate = true;
        elements.get(this.selected)?.setAttribute("aria-pressed", "false");
        this.selected = date;
        button.setAttribute("aria-pressed", "true");
        details();
      };
      button.onkeydown = event => {
        if (event.key === "Escape") { this.hideTip(); return; }
        const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        const next = localDate(date);
        next.setDate(next.getDate() + delta);
        elements.get(dateKey(next))?.focus();
      };
    }
    const selectedCell = elements.get(this.selected);
    const place = () => {
      if (!viewport.clientWidth) return false;
      viewport.scrollLeft = scroll ?? (selectedCell
        ? viewport.scrollLeft + selectedCell.getBoundingClientRect().left -
          viewport.getBoundingClientRect().left - viewport.clientWidth * .84
        : 0);
      return true;
    };
    if (!place()) {
      const observer = this.heatObserver = new ResizeObserver(() => {
        if (place()) observer.disconnect();
      });
      observer.observe(viewport);
    }
    const foot = section.createDiv({ cls: "wd-heat-foot" });
    foot.createSpan({ text: stats.skipped ? `${num(stats.skipped)} 次变更未完整计量` : "选择日期查看笔记" });
    const legend = foot.createDiv({ cls: "wd-legend", attr: { "aria-label": "写作强度从低到高" } });
    legend.createSpan({ text: "Less" });
    for (let level = 0; level < 5; level++) legend.createSpan({ cls: "wd-cell", attr: { "data-level": String(level), "aria-hidden": "true" } });
    legend.createSpan({ text: "More" });
    const detail = section.createDiv({ cls: "wd-detail", attr: { "aria-live": "polite" } });
    const details = () => this.dayDetails(detail);
    details();
  }

  private dayDetails(detail: HTMLElement): void {
    detail.empty();
    const day = timelineDay(this.plugin.data, this.selected, this.plugin.tracker.liveDays[this.selected]);
    const top = detail.createDiv({ cls: "wd-detail-top" });
    top.createEl("h3", { text: this.format(this.selected) });
    top.createSpan({ text: num(day.words) + " 字 · " + num(day.count) + " 篇" });
    if (day.skipped) detail.createEl("p", { text: "有变更无法精确拆分，显示可确认的最少新增字数。" });
    const notes = day.notes.sort((a, b) => b.words - a.words || a.path.localeCompare(b.path));
    if (!notes.length) {
      detail.createEl("p", { text: "这一天没有记录。" });
      return;
    }
    const list = detail.createEl("ul");
    for (const note of notes) {
      const { id, words } = note;
      const path = this.plugin.activity.pathFor(Number(id));
      const row = list.createEl("li");
      const label = (path ?? note.path).split("/").at(-1)!.replace(/\.md$/i, "");
      if (path) {
        const source = note.source && { frontmatter: "笔记属性 created", filetime: "文件创建时间" }[note.source];
        const button = row.createEl("button", { text: label, type: "button",
          attr: { title: source ? path + " · 日期来自" + source : path } });
        button.onclick = () => {
          const latest = this.plugin.activity.pathFor(Number(id));
          const file = latest && this.app.vault.getAbstractFileByPath(latest);
          if (!(file instanceof TFile)) { new Notice("该笔记已不可用。"); return; }
          void this.app.workspace.getLeaf("tab").openFile(file).catch(() => new Notice("无法打开该笔记。"));
        };
      } else row.createSpan({ text: label + "（不可用）", cls: "wd-muted" });
      row.createSpan({ text: num(words) + " 字" + (note.skipped ? " · 部分未计量" : ""), cls: "wd-note-count" });
    }
  }

  private chart(root: HTMLElement, values: number[], today: string): void {
    const panel = root.createEl("section", { cls: "wd-panel wd-chart" });
    const header = panel.createDiv({ cls: "wd-section-head" });
    const title = header.createDiv();
    title.createEl("h2", { text: "Monthly Writing Statistics" });
    const metric = "字数";
    title.createEl("p", { text: `${this.year} 年 · 各月${metric}` });
    const viewport = panel.createDiv({ cls: "wd-chart-scroll" });
    viewport.addEventListener("scroll", () => this.hideTip(), { passive: true });
    const chart = svg(viewport, "svg", { height: 212, role: "group", "aria-label": `每月${metric}柱状图` });
    const max = Math.max(1, ...values);
    const stepPower = 10 ** Math.floor(Math.log10(Math.max(max / 4, 1)));
    const step = ([1, 2, 2.5, 5, 10].find(multiplier => multiplier * stepPower >= max / 4) ?? 10) * stepPower;
    const top = 15, bottom = 181, ticks = Math.ceil(max / step);
    const scale = (value: number) => bottom - (bottom - top) * value / (ticks * step);
    for (let i = 0; i <= ticks; i++) {
      const y = scale(i * step);
      svg(chart, "line", { x1: "11%", x2: "99%", y1: y, y2: y, class: "wd-chart-line" });
      svg(chart, "text", { x: "10%", y: y + 4, "text-anchor": "end" }).textContent = axisNum.format(i * step);
    }
    const todayDate = localDate(today);
    values.forEach((value, index) => {
      const future = this.year === todayDate.getFullYear() && index > todayDate.getMonth();
      const current = this.year === todayDate.getFullYear() && index === todayDate.getMonth();
      const x = 11 + (index + 0.5) * (88 / 12);
      const lines = [this.year + " 年 " + (index + 1) + " 月", num(value) + " 字"];
      const group = svg(chart, "g", {
        tabindex: future ? -1 : 0, role: "img",
        "aria-label": lines.join("，"), "data-wd-focus": "chart-" + index,
      });
      const rect = svg(group, "rect", { x: (x - 1.9) + "%", y: value ? scale(value) : bottom - 2, width: "3.8%",
        height: Math.max(2, bottom - scale(value)), rx: 3,
        class: "wd-bar" + (current ? " wd-current" : "") + (!value ? " wd-zero" : "") });
      svg(group, "rect", { x: (x - 3.5) + "%", y: top, width: "7%", height: bottom - top + 25, fill: "transparent" });
      svg(group, "text", { x: x + "%", y: 202, "text-anchor": "middle" }).textContent = `${index + 1}月`;
      if (future) return;
      const show = () => this.tooltip(rect, lines);
      group.addEventListener("pointerenter", show);
      group.addEventListener("pointerleave", () => this.hideTip());
      group.addEventListener("focus", show);
      group.addEventListener("blur", () => this.hideTip());
      group.addEventListener("keydown", event => {
        if (event.key === "Escape") this.hideTip();
      });
    });
  }
}
