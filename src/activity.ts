import { included, type Data, type NoteActivity } from "./model";
import { countable, difference, sameText, type Delta } from "./words";

const cacheBudget = 32_000_000;

export class Activity {
  private tokens = new Map<number, { source: string; words: string[]; cost: number }>();
  private paths = new Map<number, string>();
  private cached = 0;
  total = 0;
  unread = 0;

  constructor(readonly data: Data) {
    for (const [path, file] of Object.entries(data.files)) {
      this.paths.set(file.id, path);
      this.total += file.count ?? 0;
      this.unread += Number(file.count === null);
    }
  }

  pathFor(id: number): string | undefined { return this.paths.get(id); }
  get fileCount(): number { return this.paths.size; }
  hasSnapshot(path: string): boolean {
    const id = this.data.files[path]?.id;
    return id !== undefined && this.tokens.has(id);
  }

  prime(path: string, source: string): void {
    const file = this.data.files[path];
    if (!file || this.tokens.has(file.id)) return;
    const words = countable(source, this.data.settings);
    if (words && words.length === file.count) this.remember(file.id, source, words);
  }

  compareDraft(path: string, source: string, created: boolean, mixed: boolean) {
    const file = this.data.files[path];
    const previous = file && this.tokens.get(file.id);
    if (previous && sameText(previous.source, source)) return;
    const words = countable(source, this.data.settings);
    if (!words) return;
    const before = previous?.words ?? (created && !file ? [] : undefined);
    const delta = !mixed && before ? difference(before, words) : null;
    const priorCount = file ? file.count : created ? 0 : null;
    const knownNet = !mixed && priorCount !== null ? words.length - priorCount : 0;
    return {
      id: file ? String(file.id) : "draft:" + path,
      added: delta?.added ?? Math.max(0, knownNet), removed: delta?.removed ?? Math.max(0, -knownNet),
      skipped: Number(!delta),
      net: words.length - (file?.count ?? 0),
    };
  }

  private evict(id: number): void {
    const entry = this.tokens.get(id);
    if (entry) this.cached -= entry.cost;
    this.tokens.delete(id);
  }

  private remember(id: number, source: string | null, words: string[] | null): void {
    this.evict(id);
    if (words && source !== null) {
      const cost = source.length * 4 + words.length * 24 + 256;
      this.tokens.set(id, { source, words, cost });
      this.cached += cost;
      for (const old of this.tokens.keys()) {
        if (this.cached <= cacheBudget) break;
        this.evict(old);
      }
    }
  }

  private record(day: string, id: number, path: string, created: boolean, delta: Delta, skipped: boolean): void {
    const date = this.data.days[day] ??= { notes: {} };
    const note: NoteActivity = date.notes[id] ??= { path, added: 0, removed: 0, net: 0, created: false, skipped: 0 };
    note.path = path;
    note.created ||= created;
    note.added += delta.added;
    note.removed += delta.removed;
    note.net += delta.net;
    note.skipped += Number(skipped);
  }

  observe(path: string, source: string | null, event?: { day: string; created: boolean; mixed: boolean }): void {
    const files = this.data.files;
    const old = files[path];
    const id = old?.id ?? this.data.nextId++;
    const previous = this.tokens.get(id);
    if (event && !event.created && previous && source !== null && sameText(previous.source, source)) {
      this.remember(id, source, previous.words);
      return;
    }
    const words = source === null ? null : countable(source, this.data.settings);
    if (event) {
      const before = old ? previous?.words : event.created ? [] : undefined;
      const delta = !event.mixed && before && words ? difference(before, words) : null;
      if (delta) {
        this.record(event.day, id, path, event.created, delta, false);
      } else {
        const prev = old ? old.count : event.created ? 0 : null;
        const net = !event.mixed && words && prev !== null ? words.length - prev : 0;
        // A positive net change guarantees at least this many insertions,
        // even if the exact split between insertions and deletions is unavailable.
        this.record(event.day, id, path, event.created,
          { added: Math.max(0, net), removed: Math.max(0, -net), net }, true);
      }
    }
    this.remember(id, source, words);
    this.paths.set(id, path);
    files[path] = { id, count: words?.length ?? null };
    this.total += (words?.length ?? 0) - (old?.count ?? 0);
    this.unread += Number(!words) - Number(old?.count === null);
  }

  remove(path: string, day?: string, uncertain = false): void {
    const old = this.data.files[path];
    if (!old) return;
    if (day) {
      const known = !uncertain && old.count !== null;
      const removed = known ? old.count! : 0;
      this.record(day, old.id, path, false, { added: 0, removed, net: -removed }, !known);
    }
    delete this.data.files[path];
    this.paths.delete(old.id);
    this.evict(old.id);
    this.total -= old.count ?? 0;
    this.unread -= Number(old.count === null);
  }

  move(from: string, to: string): void {
    const file = this.data.files[from];
    if (!file || from === to) return;
    if (!included(to, this.data.settings)) { this.remove(from); return; }
    this.remove(to);
    delete this.data.files[from];
    this.data.files[to] = file;
    this.paths.set(file.id, to);
  }
}
