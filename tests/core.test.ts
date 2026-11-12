import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { clearTimeout as clearNodeTimer, setTimeout as setNodeTimer } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { Activity } from "../src/activity";
import { calendar, dateKey, localDate } from "../src/dates";
import { indexDate, indexedDays, timelineDates, timelineDay, timelineYear } from "../src/history";
import { defaults, fresh, importPath, included, load } from "../src/model";
import { summarize, tally } from "../src/statistics";
import { Storage } from "../src/storage";
import { Tracker } from "../src/tracker";
import { countable, difference, MAX_SOURCE } from "../src/words";

Object.defineProperty(global, "window", {
  configurable: true,
  value: {
    setTimeout: (callback: () => void, delay: number) => Number(setNodeTimer(callback, delay)),
    clearTimeout: clearNodeTimer,
  },
});

test("counts Han characters, English words, and contiguous numbers", () => {
  assert.deepEqual(countable("中文hello42世界 don't l’été cafe\u0301𠀀", defaults),
    ["中", "文", "hello", "42", "世", "界", "don't", "l’été", "café", "𠀀"]);
});

test("keeps rendered Markdown text and applies frontmatter and code options", () => {
  const text = [
    "---", "title: 隐藏", "---", "# **Title**", "", "> [real words](https://ignored.io) ![alt](picture.png)",
    "", "- **列表** `skip 32` [[Folder/Target|別名]] ![[Hidden.png]]",
    "", "| Field | Count |", "| --- | --- |", "| value | 25 |",
    "", "```js", "hidden 42", "```", "", "    indented 55",
  ].join("\n");
  const base = ["Title", "real", "words", "列", "表", "別", "名", "Field", "Count", "value", "25"];
  assert.deepEqual(countable(text, defaults), base);
  assert.deepEqual(countable(text, { frontmatter: true, codeBlocks: true }),
    ["title", "隐", "藏", ...base, "hidden", "42", "indented", "55"]);
  assert.deepEqual(countable("first\n\n---\nplain text\n---", defaults), ["first", "plain", "text"]);
});

test("separates insertions and deletions, including replacements with zero net growth", () => {
  assert.deepEqual(difference(["a", "remove", "b", "c"], ["a", "b", "new", "newer", "c"]),
    { added: 2, removed: 1, net: 1 });
  assert.deepEqual(difference(["a", "x", "b"], ["a", "y", "b"]), { added: 1, removed: 1, net: 0 });
  assert.deepEqual(difference(["x", "x"], ["x", "x"]), { added: 0, removed: 0, net: 0 });
});

test("large replacements decline exact splits and retain known net growth", () => {
  const a = new Activity(fresh());
  a.observe("Note.md", "alpha ".repeat(800));
  a.observe("Note.md", "beta ".repeat(801), { day: "2026-01-01", created: false, mixed: false });
  assert.deepEqual(tally(a.data.days["2026-01-01"]), { added: 0, net: 1, created: 0, skipped: 1, edited: 1 });
  assert.equal(countable("a".repeat(MAX_SOURCE + 1), defaults), null);
});

function fixture(initial: Record<string, string> = {}, first = "2026-12-31") {
  const files = new Map(Object.entries(initial));
  let reads = 0, lists = 0, today = first;
  const a = new Activity(fresh());
  const tracker = new Tracker(a, {
    listImports: () => { lists++; return [...files.keys()]; },
    read: async path => { reads++; return files.get(path) ?? null; },
    exists: path => files.has(path),
  }, () => {}, () => today);
  return { a, files, tracker, reads: () => reads, lists: () => lists, day: (key: string) => { today = key; } };
}

test("persisted records are checked and invalid settings fall back to defaults", () => {
  const original = fresh();
  const loaded = load({ ...original, settings: { frontmatter: true, thresholds: [10, 4, 3], folders: [42] } });
  assert.equal(loaded.settings.frontmatter, true);
  assert.deepEqual(loaded.settings.thresholds, defaults.thresholds);
  assert.deepEqual(loaded.settings.folders, defaults.folders);
  assert.equal(Object.getPrototypeOf(loaded.files), null);
  assert.throws(() => load({ ...original, files: { "bad.md": { id: 1, count: "123" } } }));
  assert.throws(() => load({ ...original, days: { "2026-11-12": { notes: { "1": { added: 4 } } } } }));
});

test("first scan and restart refresh totals without inventing history", async () => {
  const { a, files, tracker } = fixture({ "existing.md": "已有 old" });
  await tracker.baseline(false, [...files.keys()]);
  assert.equal(a.total, 3);
  assert.deepEqual(a.data.days, {});
  const id = a.data.files["existing.md"].id;
  tracker.activity = new Activity(load(JSON.parse(JSON.stringify(a.data))));
  files.set("existing.md", "edited while offline");
  await tracker.baseline();
  assert.equal(tracker.activity.total, 3);
  assert.equal(tracker.activity.data.files["existing.md"].id, id);
  assert.deepEqual(tracker.activity.data.days, {});
  tracker.stop();
});

test("startup refreshes only known notes and historical import respects explicit scopes and exclusions", async () => {
  const a = new Activity(fresh({ ...defaults, folders: ["Journal/Private"] }));
  a.observe("known.md", "known");
  const files = new Map([
    ["known.md", "known update"], ["Journal/day.md", "journal"],
    ["Journal/Private/secret.md", "excluded"], ["Journalish/other.md", "outside"],
  ]);
  const lookups: string[][] = [], reads: string[] = [];
  const tracker = new Tracker(a, {
    listImports: roots => { lookups.push([...roots]); return [...files.keys()]; },
    exists: path => files.has(path),
    read: async path => { reads.push(path); return files.get(path) ?? null; },
    stat: () => ({ ctime: +localDate("2026-11-11") }),
  }, () => {}, () => "2026-11-12");
  try {
    await tracker.baseline(true);
    assert.deepEqual(reads, ["known.md"]);
    assert.deepEqual(lookups, []);
    await tracker.baseline(true, ["/", ".", "../", "Journal/"]);
    assert.deepEqual(lookups, [["Journal"]]);
    assert.deepEqual(reads, ["known.md", "known.md", "Journal/day.md"]);
    assert.deepEqual(Object.keys(a.data.files).sort(), ["Journal/day.md", "known.md"]);
    assert.equal(importPath("C:\\Notes"), undefined);
    assert.equal(importPath("Notes/../"), undefined);
    assert.equal(importPath("Notes\\Draft.md"), "Notes/Draft.md");
    assert.equal(timelineDay(a.data, "2026-11-11").words, 3);
  } finally {
    tracker.stop();
  }
});

test("an opened unindexed note uses its prior body to measure the first edit", async () => {
  const { a, tracker, files, reads, lists } = fixture({ "old.md": "old note" });
  try {
    await tracker.baseline(true);
    assert.equal(a.fileCount, 0);
    tracker.watch("old.md");
    tracker.edit("old.md", "old note changed");
    files.set("old.md", "old note changed");
    tracker.enqueue("old.md");
    await tracker.settle();
    assert.equal(lists(), 0);
    assert.equal(reads(), 2);
    assert.equal(tally(a.data.days["2026-12-31"]).added, 1);
    assert.equal(a.total, 3);
  } finally {
    tracker.stop();
  }
});

test("index dates prefer creation time and only fall back to a valid YAML created property", () => {
  const today = "2026-11-12";
  const source = '---\r\ncreated: "2024-02-29T01:00:00+08:00"\r\n---\r\n正文';
  const stat = { ctime: +localDate("2026-11-11"), mtime: +localDate("2026-11-08") };
  assert.deepEqual(indexDate(source, stat, today), { day: "2026-11-11", source: "filetime" });
  assert.deepEqual(indexDate(source, undefined, today), { day: "2024-02-29", source: "frontmatter" });
  assert.deepEqual(indexDate(source, { ctime: 0 }, today), { day: "2024-02-29", source: "frontmatter" });
  assert.deepEqual(indexDate(source, { ctime: +localDate("2026-11-13") }, today),
    { day: "2024-02-29", source: "frontmatter" });
  assert.equal(indexDate("---\ncreated: 2026-02-30\n---\n正文", undefined, today), undefined);
  assert.equal(indexDate("---\ndate: 2026-11-08\n---\n正文", { ...stat, ctime: NaN }, today), undefined);
  assert.equal(indexDate("created: 2026-11-08", undefined, today), undefined);
});

test("index migration fixes earlier dates and merges recorded edits without duplicating words or notes", async () => {
  const a = new Activity(fresh());
  const today = "2026-11-12", earlier = "2026-11-08";
  const path = "2026-11-08 - old.md", namedToday = "2026-11-12 - other.md", created = "Created.md";
  const files = new Map([[path, "old title"], [namedToday, "index body"]]);
  
  const tracker = new Tracker(a, {
    listImports: () => [...files.keys()], exists: path => files.has(path),
    read: async path => files.get(path) ?? null, stat: path => ({ ctime: +localDate(path.startsWith(earlier) ? earlier : today) }),
  }, () => {}, () => today);
  await tracker.baseline(false, [...files.keys()]);
  a.data.history = { indexVersion: 2, days: { "2026-11-11": { "1": { path, words: 2 } } } };
  assert.equal(indexedDays(a.data), undefined);
  await tracker.baseline(true);
  assert.deepEqual(timelineDates(a.data, today).sort(), [earlier, today]);
  assert.equal(timelineDay(a.data, earlier).words, 2);
  assert.equal(timelineDay(a.data, today).words, 2);
  assert.equal(a.fileCount, 2);
  files.set(path, "old title add");
  files.set(namedToday, "index changed body");
  files.set(created, "new article");
  tracker.enqueue(path);
  tracker.enqueue(namedToday);
  tracker.enqueue(created, true);
  await tracker.settle();
  await tracker.baseline(true);
  const restored = load(JSON.parse(JSON.stringify(a.data)));
  assert.equal(timelineDay(restored, earlier).words, 2);
  assert.equal(timelineDay(restored, today).words, 6);
  assert.equal(timelineDay(restored, today).count, 3);
  assert.equal(timelineYear(restored, 2026, timelineDates(restored, today)).monthly[10], 8);
  assert.equal(tally(restored.days[today]).added, 4);
  tracker.stop();
});

test("debounces repeats, tracks edits across midnight and keeps unchanged saves out", async () => {
  const { a, tracker, files, reads, day } = fixture();
  await tracker.baseline(false, [...files.keys()]);
  files.set("Note.md", "first hello");
  tracker.enqueue("Note.md", true);
  for (let i = 0; i < 20; i++) tracker.enqueue("Note.md");
  await tracker.settle();
  assert.equal(reads(), 1);
  tracker.enqueue("Note.md");
  await tracker.settle();
  assert.equal(tally(a.data.days["2026-12-31"]).added, 2);
  day("2027-01-01");
  tracker.enqueue("Note.md");
  await tracker.settle();
  assert.equal(Object.hasOwn(a.data.days, "2027-01-01"), false);
  files.set("Note.md", "first world more");
  tracker.enqueue("Note.md");
  await tracker.settle();
  const note = Object.values(a.data.days["2027-01-01"].notes)[0];
  assert.deepEqual([note.added, note.removed, note.net], [2, 1, 1]);
  const stats = summarize(a.data, 2027, 0, "2027-01-01");
  assert.equal(stats.streak, 2);
  assert.equal(stats.monthly[0], 2);
  tracker.stop();
});

test("editing yesterday's note updates today before save and is counted once after autosave and reindex", async () => {
  const yesterday = "2026-11-11", today = "2026-11-12";
  const path = "notes.md", files = new Map([[path, "昨日正文"]]);
  const activity = new Activity(fresh());
  const tracker = new Tracker(activity, {
    listImports: () => [...files.keys()], exists: path => files.has(path),
    read: async path => files.get(path) ?? null, stat: () => ({ ctime: +localDate(yesterday) }),
  }, () => {}, () => today);
  try {
    await tracker.baseline(true, [path]);
    tracker.edit(path, "昨日正文\n今日新稿");
    await delay(125);
    assert.equal(timelineDay(activity.data, yesterday).words, 4);
    assert.equal(timelineDay(activity.data, today, tracker.liveDays[today]).words, 4);
    assert.equal(timelineDay(activity.data, today, tracker.liveDays[today]).count, 1);
    assert.equal(activity.total + tracker.liveNet, 8);
    assert.equal(tally(activity.data.days[today]).added, 0);

    // An intermediate CRLF autosave replaces part of the live delta.
    files.set(path, "昨日正文\r\n今日");
    tracker.enqueue(path);
    await tracker.settle();
    assert.equal(tally(activity.data.days[today]).added, 2);
    assert.equal(timelineDay(activity.data, today, tracker.liveDays[today]).words, 4);
    assert.equal(timelineDay(activity.data, today, tracker.liveDays[today]).count, 1);

    // Deleting unsaved text lowers the preview; the total changes with it.
    tracker.edit(path, "昨日正文\n今日新");
    await delay(125);
    assert.equal(timelineDay(activity.data, today, tracker.liveDays[today]).words, 3);
    assert.equal(activity.total + tracker.liveNet, 7);
    files.set(path, "昨日正文\r\n今日新");
    tracker.enqueue(path);
    await tracker.settle();
    assert.deepEqual(tracker.liveDays, {});
    tracker.enqueue(path);
    await tracker.settle();
    await tracker.baseline(true);
    assert.equal(timelineDay(activity.data, yesterday).words, 4);
    assert.equal(timelineDay(activity.data, today).words, 3);
    assert.equal(activity.total, 7);
  } finally {
    tracker.stop();
  }
});

test("an autosave after midnight keeps the editor snapshot on the day it was typed", async () => {
  const { a, tracker, files, day } = fixture({ "notes.md": "先前" }, "2026-11-12");
  try {
    await tracker.baseline(false, [...files.keys()]);
    tracker.edit("notes.md", "先前新增");
    day("2026-11-13");
    files.set("notes.md", "先前新增");
    tracker.enqueue("notes.md");
    await tracker.settle();
    assert.equal(tally(a.data.days["2026-11-12"]).added, 2);
    assert.equal(tally(a.data.days["2026-11-13"]).added, 0);
    assert.deepEqual(tracker.liveDays, {});
  } finally {
    tracker.stop();
  }
});

test("a save queued while rebuilding keeps both its original index and today's recorded delta", async () => {
  const yesterday = "2026-11-11", today = "2026-11-12";
  let source = "原文", release: (() => void) | undefined, wait: Promise<void> | undefined;
  const a = new Activity(fresh());
  const tracker = new Tracker(a, {
    listImports: () => ["old.md"], exists: () => true,
    read: async () => { await wait; return source; },
    stat: () => ({ ctime: +localDate(yesterday) }),
  }, () => {}, () => today);
  try {
    await tracker.baseline(true, ["old.md"]);
    wait = new Promise<void>(resolve => { release = resolve; });
    const scan = tracker.baseline(true);
    source = "原文新增";
    tracker.edit("old.md", source);
    tracker.enqueue("old.md");
    release!();
    await scan;
    await tracker.settle();
    assert.equal(timelineDay(a.data, yesterday).words, 2);
    assert.equal(timelineDay(a.data, today).words, 2);
  } finally {
    tracker.stop();
  }
});

test("a batch with unresolved versions on both sides of midnight is flagged", async () => {
  const { a, tracker, files, day } = fixture({ "n.md": "original" });
  await tracker.baseline(false, [...files.keys()]);
  files.set("n.md", "original late");
  tracker.enqueue("n.md");
  day("2027-01-01");
  files.set("n.md", "original late early");
  tracker.enqueue("n.md");
  await tracker.settle();
  assert.equal(a.total, 3);
  assert.equal(a.data.days["2026-12-31"], undefined);
  assert.deepEqual(tally(a.data.days["2027-01-01"]), { added: 0, net: 0, created: 0, skipped: 1, edited: 1 });
  tracker.stop();
});

test("queued edits survive file renames and folder moves, and deleted identities are not reused", async () => {
  const { a, files, tracker } = fixture({ "old/n.md": "one", "older/n.md": "unrelated" });
  await tracker.baseline(false, [...files.keys()]);
  const id = a.data.files["old/n.md"].id;
  files.set("old/n.md", "one two");
  tracker.enqueue("old/n.md");
  files.delete("old/n.md");
  files.set("old/name.md", "one two");
  tracker.move("old/n.md", "old/name.md");
  files.delete("old/name.md");
  files.set("moved/name.md", "one two");
  tracker.move("old", "moved", true);
  await tracker.settle();
  assert.equal(a.pathFor(id), "moved/name.md");
  assert.equal(tally(a.data.days["2026-12-31"]).added, 1);
  assert.equal(a.data.files["older/n.md"].count, 1);
  files.delete("moved/name.md");
  tracker.remove("moved", true);
  assert.equal(a.pathFor(id), undefined);
  assert.equal(tally(a.data.days["2026-12-31"]).net, -1);
  files.set("moved/name.md", "new");
  tracker.enqueue("moved/name.md", true);
  await tracker.settle();
  assert.notEqual(a.data.files["moved/name.md"].id, id);
  tracker.stop();
});

test("excluded paths are segment aware and pause updates only the baseline", async () => {
  const { a, files, tracker } = fixture({ "a.md": "one" });
  assert.equal(included("Folderish/n.md", { ...defaults, folders: ["Folder"] }), true);
  assert.equal(included("Folder/n.md", { ...defaults, folders: ["Folder"] }), false);
  await tracker.baseline(false, [...files.keys()]);
  a.data.settings.tracking = false;
  files.set("a.md", "one two");
  tracker.enqueue("a.md");
  await tracker.settle();
  assert.equal(a.total, 2);
  assert.deepEqual(a.data.days, {});
  tracker.stop();
});

test("handles empty and large vaults; a single edit reads one file and never lists the vault", async () => {
  const empty = fixture();
  await empty.tracker.baseline();
  assert.equal(empty.a.total, 0);
  assert.deepEqual(summarize(empty.a.data, 2026, 0, "2026-01-01").monthly, Array(12).fill(0));
  empty.tracker.stop();

  const big = fixture(Object.fromEntries(Array.from({ length: 8000 }, (_, n) => [`Notes/${n}.md`, "Existing 中文"])));
  await big.tracker.baseline(false, ["Notes"]);
  assert.equal(big.a.total, 24000);
  assert.deepEqual(big.a.data.days, {});
  big.files.set("Notes/42.md", "Existing 中文 new");
  big.tracker.enqueue("Notes/42.md");
  await big.tracker.settle();
  assert.equal(big.a.total, 24001);
  assert.deepEqual([big.lists(), big.reads()], [1, 8001]);
  big.tracker.stop();
});

test("calendar includes leap day and correctly places local dates without UTC conversion", () => {
  const leap = calendar(2028);
  assert.equal(leap.length, 366);
  assert.deepEqual(leap[0], { date: "2028-01-01", row: 6, col: 0, month: 0, first: true });
  assert.equal(leap.at(-1)!.col, 53);
  assert.equal(leap[59].date, "2028-02-29");
  assert.equal(dateKey(localDate("2026-12-31")), "2026-12-31");
  for (const [TZ, expected] of [["Asia/Shanghai", "2027-01-01"], ["America/Los_Angeles", "2026-12-31"]]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      'import {dateKey} from "./src/dates.ts"; console.log(dateKey(new Date("2027-01-01T00:15:00Z")))'],
      { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), expected);
  }
});

test("summary excludes future values and computes averages across calendar days", () => {
  const a = new Activity(fresh());
  a.observe("old.md", "one two three", { day: "2024-02-02", created: true, mixed: false });
  a.observe("current.md", "one two three four", { day: "2026-02-02", created: true, mixed: false });
  a.observe("future.md", "hidden", { day: "2026-02-03", created: true, mixed: false });
  const stats = summarize(a.data, 2026, 1, "2026-02-02");
  assert.equal(stats.monthly[1], 4);
  assert.equal(stats.summary.average, 2);
  assert.equal(stats.summary.created, 1);
  assert.equal(summarize(a.data, 2024, 1, "2026-02-02").summary.added, 3);
});

test("persistence keeps snapshots immutable, serializes writes and flushes newer revisions", async () => {
  const data = fresh();
  const saved: typeof data[] = [];
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const store = new Storage(() => data, async copy => {
    saved.push(copy);
    if (saved.length === 1) await blocked;
  }, error => { throw error; });
  store.change();
  const first = store.flush();
  data.settings.frontmatter = true;
  store.change();
  const closing = store.close();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].settings.frontmatter, false);
  finish();
  await Promise.all([first, closing]);
  assert.deepEqual(saved.map(item => item.settings.frontmatter), [false, true]);
  assert.equal(load(saved[1]).settings.frontmatter, true);
  assert.throws(() => load({ version: 2 }));
});
