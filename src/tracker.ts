import { cancelTimer, scheduleTimer, type Timer } from "./timers";
import { Activity } from "./activity";
import { dateKey } from "./dates";
import { createdDay, indexDate, recordedNet } from "./history";
import { importPath, included, INDEX_VERSION, type Day, type History } from "./model";
import { MAX_SOURCE, sameText } from "./words";

export interface VaultSource {
  listImports(paths: readonly string[]): string[];
  read(path: string): Promise<string | null>;
  exists(path: string): boolean;
  stat?(path: string): { ctime: number } | undefined;
}
interface Task {
  created: boolean; day: string; mixed: boolean; silent: boolean; due: number; since: number;
  imported?: Promise<string | null>;
}
interface Draft { source: string; day: string; mixed: boolean }
const debounce = 170, maxDelay = 650;
const yieldUI = () => new Promise<void>(resolve => scheduleTimer(resolve, 0));
const under = (path: string, root: string) => path === root || path.startsWith(root + "/");

export class Tracker {
  private tasks = new Map<string, Task>();
  private drafts = new Map<string, Draft>();
  private watches = new Map<string, Promise<void>>();
  private draftTimer?: Timer;
  liveDays: Record<string, Day> = {};
  liveNet = 0;
  private timer?: Timer;
  private busy = false;
  private running?: Promise<void>;
  private generation = 0;
  private closed = false;
  scanning = false;

  constructor(public activity: Activity, private readonly vault: VaultSource,
    private readonly changed: (persist: boolean) => void, private readonly localDay = dateKey) {}

  async baseline(buildIndex = false, selections: readonly string[] = []): Promise<void> {
    const generation = ++this.generation;
    this.scanning = true;
    this.changed(false);
    const { data } = this.activity;
    const roots = selections.map(importPath).filter((path): path is string => path !== undefined);
    const imports = roots.length
      ? this.vault.listImports(roots).filter(path => roots.some(root => under(path, root))) : [];
    const paths = [...new Set([...Object.keys(data.files), ...imports])]
      .filter(path => included(path, data.settings) && this.vault.exists(path));
    const today = this.localDay();
    const history: History | undefined = buildIndex ? { indexVersion: INDEX_VERSION, days: {} } : undefined;
    const net = history ? recordedNet(data) : undefined;
    const priorIndex = new Map<string, string>();
    if (history && data.history?.indexVersion === INDEX_VERSION) {
      for (const [day, notes] of Object.entries(data.history.days)) {
        for (const id of Object.keys(notes)) priorIndex.set(id, day);
      }
    }
    const present = new Set(paths);
    for (const path of Object.keys(this.activity.data.files)) {
      if (!present.has(path)) this.activity.remove(path);
    }
    let start = performance.now();
    for (const path of paths) {
      if (this.closed || generation !== this.generation) return;
      const source = await this.vault.read(path);
      if (this.closed || generation !== this.generation) return;
      if (this.vault.exists(path) && !this.tasks.has(path)) {
        this.activity.observe(path, source);
        const file = data.files[path];
        if (history && source !== null && file.count !== null) {
          const tracked = net?.get(String(file.id));
          // Reconstruct the untracked portion of the current body. The measured
          // additions already belong to the dates on which they were observed.
          const words = Math.max(0, file.count - (tracked ?? 0));
          if (words > 0 || tracked === undefined) {
            const date = indexDate(source, this.vault.stat?.(path), today, data.settings.preferCreated);
            if (date) (history.days[date.day] ??= {})[file.id] = { path, words, source: date.source };
          }
        }
      } else if (history && this.vault.exists(path)) {
        // A queued save still needs the old snapshot for its diff.
        const id = String(data.files[path]?.id);
        const day = priorIndex.get(id);
        const indexed = day && data.history?.days[day]?.[id];
        if (day && indexed) (history.days[day] ??= {})[id] = indexed;
      }
      if (performance.now() - start > 10) {
        await yieldUI();
        start = performance.now();
      }
    }
    if (this.closed || generation !== this.generation) return;
    if (history) data.history = history;
    this.scanning = false;
    this.refreshDrafts();
    this.changed(true);
    this.schedule();
  }

  watch(path: string): void {
    const { activity } = this;
    if (this.closed || !included(path, activity.data.settings) || this.watches.has(path) ||
      this.tasks.get(path)?.created || this.tasks.get(path)?.imported || activity.hasSnapshot(path)) return;
    const id = activity.data.files[path]?.id;
    const pending = this.vault.read(path).then(source => {
      if (source === null || this.closed || this.activity !== activity || this.watches.get(path) !== pending ||
        activity.data.files[path]?.id !== id || this.tasks.get(path)?.created ||
        !included(path, activity.data.settings) || !this.vault.exists(path)) return;
      if (id === undefined) {
        activity.observe(path, source);
        this.changed(true);
      } else {
        activity.prime(path, source);
      }
      this.refreshDrafts();
    }).finally(() => {
      if (this.watches.get(path) === pending) this.watches.delete(path);
    });
    this.watches.set(path, pending);
  }

  edit(path: string, source: string, day = this.localDay()): void {
    if (this.closed || !included(path, this.activity.data.settings)) return;
    const old = this.drafts.get(path);
    if (source.length > MAX_SOURCE) {
      if (this.drafts.delete(path)) this.refreshDrafts();
      return;
    }
    const draft = { source, day, mixed: !!old && (old.mixed || old.day !== day) };
    this.drafts.set(path, draft);
    if (!old) this.watch(path);
    // Throttle parsing, including during continuous typing.
    this.draftTimer ??= scheduleTimer(() => this.refreshDrafts(), 90);
  }

  private refreshDrafts(): void {
    cancelTimer(this.draftTimer);
    this.draftTimer = undefined;
    this.liveDays = {};
    this.liveNet = 0;
    for (const [path, draft] of this.drafts) {
      if (!included(path, this.activity.data.settings)) continue;
      const created = this.tasks.get(path)?.created ?? false;
      const comparison = this.activity.compareDraft(path, draft.source, created, draft.mixed);
      if (!comparison) {
        this.drafts.delete(path);
        continue;
      }
      this.liveNet += comparison.net;
      if (!this.activity.data.settings.tracking) continue;
      const { id, added, removed, net, skipped } = comparison;
      (this.liveDays[draft.day] ??= { notes: {} }).notes[id] = { path, added, removed, net, skipped, created };
    }
    if (!this.closed) this.changed(false);
  }

  arrive(path: string, blank: boolean): void {
    if (this.closed || !included(path, this.activity.data.settings)) return;
    // A file that arrives with content may be a note copied by sync. Take
    // its initial body before autosaves can turn it into today's writing.
    this.enqueue(path, blank, this.localDay(), false, blank ? undefined : this.vault.read(path));
  }

  enqueue(path: string, created = false, day = this.localDay(), silent = false,
    imported?: Promise<string | null>): void {
    if (this.closed || !included(path, this.activity.data.settings)) return;
    const old = this.tasks.get(path);
    const now = Date.now();
    const tracking = this.activity.data.settings.tracking;
    this.tasks.set(path, {
      created: (old?.created ?? false) || created,
      day, mixed: !!old && (old.mixed || old.day !== day),
      silent: silent || !tracking || !!old?.silent,
      since: old?.since ?? now, due: Math.min(now + debounce, (old?.since ?? now) + maxDelay),
      imported: old?.imported ?? imported,
    });
    this.schedule();
  }

  private indexArrival(path: string, source: string, today: string): void {
    this.activity.observe(path, source);
    const { data } = this.activity;
    const file = data.files[path];
    if (file.count === null) return;
    const date = indexDate(source, this.vault.stat?.(path), today, data.settings.preferCreated);
    if (!date) return;
    const history = data.history?.indexVersion === INDEX_VERSION ? data.history
      : (data.history = { indexVersion: INDEX_VERSION, days: {} });
    (history.days[date.day] ??= {})[file.id] = { path, words: file.count, source: date.source };
  }

  move(from: string, to: string, folder = false): void {
    const paths = folder
      ? new Set([...Object.keys(this.activity.data.files), ...this.tasks.keys(), ...this.drafts.keys(),
        ...this.watches.keys()].filter(path => under(path, from)))
      : [from];
    for (const path of paths) {
      const target = to + path.slice(from.length);
      const pending = this.tasks.get(path);
      const draft = this.drafts.get(path);
      this.tasks.delete(path);
      this.drafts.delete(path);
      this.watches.delete(path);
      this.activity.move(path, target);
      if (pending && included(target, this.activity.data.settings)) this.tasks.set(target, { ...pending });
      if (draft && included(target, this.activity.data.settings)) this.drafts.set(target, draft);
    }
    this.refreshDrafts();
    this.changed(true);
    this.schedule();
  }

  remove(root: string, folder = false, day = this.localDay()): void {
    const paths = folder
      ? new Set([...Object.keys(this.activity.data.files), ...this.tasks.keys(), ...this.drafts.keys(),
        ...this.watches.keys()].filter(path => under(path, root)))
      : [root];
    const track = !this.scanning && this.activity.data.settings.tracking;
    let dirty = false;
    for (const path of paths) {
      const task = this.tasks.get(path);
      this.tasks.delete(path);
      this.drafts.delete(path);
      this.watches.delete(path);
      if (task?.created && !task.silent && track && !this.activity.data.files[path]) {
        this.activity.observe(path, null, { day: task.day, created: true, mixed: task.mixed });
        this.activity.remove(path);
        dirty = true;
      } else if (this.activity.data.files[path]) {
        this.activity.remove(path, track ? day : undefined, !!task);
        dirty = true;
      }
    }
    this.refreshDrafts();
    if (dirty) this.changed(true);
    this.schedule();
  }

  private schedule(): void {
    cancelTimer(this.timer);
    if (this.closed || this.scanning || this.busy || !this.tasks.size) return;
    let due = Infinity;
    for (const task of this.tasks.values()) due = Math.min(task.due, due);
    this.timer = scheduleTimer(() => { void this.drain(); }, Math.max(0, due - Date.now()));
  }

  async settle(): Promise<void> {
    await this.running;
    await this.drain(true);
  }

  drain(force = false): Promise<void> {
    if (this.running) return this.running;
    this.running = this.process(force).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async process(force: boolean): Promise<void> {
    if (this.closed || this.scanning || this.busy) return;
    this.busy = true;
    cancelTimer(this.timer);
    const generation = this.generation;
    let dirty = false, start = performance.now();
    const now = Date.now();
    try {
      for (const [path, task] of [...this.tasks]) {
        if (!force && task.due > now) continue;
        if (this.tasks.get(path) !== task) continue;
        if (this.watches.has(path)) await this.watches.get(path);
        if (this.closed || generation !== this.generation) break;
        if (this.tasks.get(path) !== task) continue;
        const initial = task.imported ? await task.imported : undefined;
        if (this.closed || generation !== this.generation) break;
        if (this.tasks.get(path) !== task) continue;
        const source = await this.vault.read(path);
        if (this.closed || generation !== this.generation) break;
        if (this.tasks.get(path) !== task) continue;
        this.tasks.delete(path);
        if (!this.vault.exists(path)) continue;
        const draft = this.drafts.get(path);
        const matched = draft && source !== null && sameText(draft.source, source) ? draft : undefined;
        // An editor snapshot provides its own date even if Obsidian saves it
        // after midnight. Unmatched disk reads still use the save event date.
        const day = matched?.day ?? task.day;
        const mixed = matched?.mixed ?? (task.mixed || task.day !== this.localDay());
        const property = source !== null && task.created && !matched ? createdDay(source, this.localDay()) : undefined;
        if (!this.activity.data.files[path] && source !== null && (task.imported || (property && property < day))) {
          this.indexArrival(path, initial ?? source, this.localDay());
          if (initial !== undefined && initial !== null && !sameText(initial, source)) {
            this.activity.observe(path, source, task.silent ? undefined : { day, created: false, mixed });
          }
        } else {
          this.activity.observe(path, source, task.silent ? undefined : { ...task, day, mixed });
        }
        if (matched) this.drafts.delete(path);
        dirty = true;
        if (performance.now() - start > 10) {
          await yieldUI();
          start = performance.now();
          if (this.closed || generation !== this.generation) break;
        }
      }
    } finally {
      this.busy = false;
      if (!this.closed && generation === this.generation && dirty) {
        this.refreshDrafts();
        this.changed(true);
      }
      this.schedule();
    }
  }

  stop(): void {
    this.closed = true;
    this.tasks.clear();
    this.drafts.clear();
    this.watches.clear();
    cancelTimer(this.timer);
    cancelTimer(this.draftTimer);
  }

  reset(activity: Activity): void {
    this.activity = activity;
    this.tasks.clear();
    this.drafts.clear();
    this.watches.clear();
    this.refreshDrafts();
  }
}
