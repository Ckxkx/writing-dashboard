export interface Settings {
  thresholds: [number, number, number];
  frontmatter: boolean;
  codeBlocks: boolean;
  folders: string[];
  paths: string[];
  dateFormat: string;
  tracking: boolean;
  monthly: boolean;
}

export const defaults: Settings = {
  thresholds: [200, 500, 1000], frontmatter: false, codeBlocks: false,
  folders: [], paths: [], dateFormat: "YYYY年M月D日", tracking: true,
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

export function fresh(settings: Settings = defaults): Data {
  return { version: 1, nextId: 1, settings: { ...settings }, files: Object.create(null), days: {} };
}

export function load(raw: unknown): Data {
  if (raw == null) return fresh();
  const data = raw as Data;
  if (data.version !== 1 || !data.settings || !data.days || !data.files ||
      !Number.isSafeInteger(data.nextId) || data.nextId < 1) {
    throw new Error("无法读取统计数据，原文件已保留。");
  }
  return { ...data, settings: { ...defaults, ...data.settings }, files: Object.assign(Object.create(null), data.files) };
}

export function included(path: string, settings: Settings): boolean {
  return /\.md$/i.test(path) && !settings.paths.includes(path) &&
    !settings.folders.some(folder => path.startsWith(folder + "/"));
}
