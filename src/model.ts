export interface Settings {
  thresholds: [number, number, number];
  frontmatter: boolean;
  codeBlocks: boolean;
  folders: string[];
  paths: string[];
  importPaths: string[];
  dateFormat: string;
  tracking: boolean;
  monthly: boolean;
}

export const defaults: Settings = {
  thresholds: [200, 500, 1000], frontmatter: false, codeBlocks: false,
  folders: [], paths: [], importPaths: [], dateFormat: "YYYY年M月D日", tracking: true,
  monthly: true,
};

export interface FileBaseline { id: number; count: number | null }
export interface NoteActivity {
  path: string;
  added: number;
  removed: number;
  net: number;
  created: boolean;
  skipped: number;
}
export interface Day { notes: Record<string, NoteActivity> }
export type DateSource = "frontmatter" | "filetime";
export interface HistoricalNote { path: string; words: number; source?: DateSource }
export const INDEX_VERSION = 3;
export interface History { indexVersion?: number; days: Record<string, Record<string, HistoricalNote>> }
export interface Data {
  version: 1;
  nextId: number;
  settings: Settings;
  files: Record<string, FileBaseline>;
  days: Record<string, Day>;
  history?: History;
}

function emptyFiles(): Data["files"] {
  return Object.create(null) as Data["files"];
}

export function fresh(settings: Settings = defaults): Data {
  return { version: 1, nextId: 1, settings: { ...settings }, files: emptyFiles(), days: {} };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
const count = (value: unknown): value is number => whole(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0;
const unknownArray = (value: unknown): value is unknown[] => Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  unknownArray(value) && value.every(item => typeof item === "string");
const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key);

function readSettings(value: Record<string, unknown>): Settings {
  const s = { ...defaults };
  for (const key of ["frontmatter", "codeBlocks", "tracking", "monthly"] as const) {
    const option = value[key];
    if (typeof option === "boolean") s[key] = option;
  }
  for (const key of ["folders", "paths", "importPaths"] as const) {
    const option = value[key];
    if (strings(option)) s[key] = option;
  }
  if (typeof value.dateFormat === "string" && value.dateFormat.trim() && value.dateFormat.length <= 80) {
    s.dateFormat = value.dateFormat;
  }
  const thresholds = value.thresholds;
  if (unknownArray(thresholds) && thresholds.length === 3) {
    const [low, middle, high] = thresholds;
    if (id(low) && id(middle) && id(high) && low > 1 && low < middle && middle < high) {
      s.thresholds = [low, middle, high];
    }
  }
  return s;
}

const baseline = (v: unknown): v is FileBaseline =>
  record(v) && id(v.id) && (v.count === null || count(v.count));
const activity = (v: unknown): v is NoteActivity =>
  record(v) && typeof v.path === "string" && count(v.added) && count(v.removed) &&
  whole(v.net) && typeof v.created === "boolean" && count(v.skipped);
const indexed = (v: unknown): v is HistoricalNote =>
  record(v) && typeof v.path === "string" && count(v.words) &&
  (v.source === undefined || typeof v.source === "string");
const day = (v: unknown): v is Day =>
  record(v) && record(v.notes) && Object.values(v.notes).every(activity);
const history = (v: unknown): v is History =>
  record(v) && (v.indexVersion === undefined || id(v.indexVersion)) && record(v.days) &&
  Object.entries(v.days).every(([key, notes]) => date(key) && record(notes) && Object.values(notes).every(indexed));

export function load(raw: unknown): Data {
  if (raw == null) return fresh();
  if (!record(raw) || raw.version !== 1 || !id(raw.nextId) || !record(raw.settings) ||
    !record(raw.files) || !record(raw.days) || (raw.history !== undefined && !history(raw.history))) {
    throw new Error("无法读取统计数据，原文件已保留。");
  }
  const data = fresh(readSettings(raw.settings));
  data.nextId = raw.nextId;
  for (const [path, value] of Object.entries(raw.files)) {
    if (!baseline(value)) throw new Error("无法读取文件字数，原文件已保留。");
    data.files[path] = value;
  }
  for (const [key, value] of Object.entries(raw.days)) {
    if (!date(key) || !day(value)) throw new Error("无法读取每日统计，原文件已保留。");
    data.days[key] = value;
  }
  data.history = raw.history;
  return data;
}

export function included(path: string, settings: Settings): boolean {
  return /\.md$/i.test(path) && !settings.paths.includes(path) &&
    !settings.folders.some(folder => path.startsWith(folder + "/"));
}

/** Resolve an explicit note/folder selection. Empty, absolute and root paths are not import scopes. */
export function importPath(value: string): string | undefined {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) return;
  const segments = path.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return;
  return path;
}
