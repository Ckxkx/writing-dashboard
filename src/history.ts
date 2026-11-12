import { dateKey, localDate } from "./dates";
import { INDEX_VERSION, type Data, type DateSource, type Day } from "./model";
import { readFrontmatter } from "./words";

function validDay(day: string | undefined, today: string): day is string {
  return !!day && day <= today && dateKey(localDate(day)) === day;
}

const createdProperty = /^(?:created|"created"|'created'):[ \t]*(.*)$/im;

export function indexDate(text: string, stat: { ctime: number } | undefined,
  today: string): { day: string; source: DateSource } | undefined {
  const time = stat?.ctime;
  if (time !== undefined && Number.isFinite(time) && time > 0) {
    const created = new Date(time);
    const year = created.getFullYear();
    if (year >= 1970 && year <= 9999) {
      const day = dateKey(created);
      if (day <= today) return { day, source: "filetime" };
    }
  }

  const yaml = readFrontmatter(text);
  if (!yaml) return;
  const value = createdProperty.exec(yaml[1])?.[1].trim().replace(/^["']/, "");
  const day = value && /^(\d{4}-\d{2}-\d{2})(?=$|[Tt "'#])/.exec(value)?.[1];
  if (validDay(day, today)) return { day, source: "frontmatter" };
}

export function recordedNet(data: Data): Map<string, number> {
  const result = new Map<string, number>();
  for (const day of Object.values(data.days)) {
    for (const [id, note] of Object.entries(day.notes)) result.set(id, (result.get(id) ?? 0) + note.net);
  }
  return result;
}

interface TimelineNote {
  id: string;
  path: string;
  words: number;
  indexed: number;
  source?: DateSource;
  skipped: number;
}

export function indexedDays(data: Data) {
  return data.history?.indexVersion === INDEX_VERSION ? data.history.days : undefined;
}

export function timelineDates(data: Data, today: string, live?: Record<string, Day>): string[] {
  return [...new Set([...Object.keys(data.days), ...Object.keys(indexedDays(data) ?? {}), ...Object.keys(live ?? {})])]
    .filter(day => day <= today);
}

export function timelineDay(data: Data, day: string, live?: Day) {
  const notes = new Map<string, TimelineNote>();
  for (const [id, note] of Object.entries(indexedDays(data)?.[day] ?? {})) {
    notes.set(id, { id, path: note.path, words: note.words, indexed: note.words, source: note.source, skipped: 0 });
  }
  for (const bucket of [data.days[day], live]) {
    for (const [id, note] of Object.entries(bucket?.notes ?? {})) {
      const prior = notes.get(id);
      // Older versions sometimes recorded only the net growth of a partial edit.
      const words = note.skipped ? Math.max(note.added, note.net) : note.added;
      notes.set(id, { id, path: note.path, words: (prior?.words ?? 0) + words,
        indexed: prior?.indexed ?? 0, source: prior?.source, skipped: (prior?.skipped ?? 0) + note.skipped });
    }
  }
  let words = 0, indexed = 0, skipped = 0;
  for (const note of notes.values()) { words += note.words; indexed += note.indexed; skipped += note.skipped; }
  return { words, indexed, skipped, count: notes.size, notes: [...notes.values()] };
}

export function timelineYear(data: Data, year: number, dates: string[], live?: Record<string, Day>) {
  const days = new Map<string, ReturnType<typeof timelineDay>>();
  const monthly = Array<number>(12).fill(0);
  let words = 0, active = 0, skipped = 0;
  for (const day of dates) {
    if (!day.startsWith(year + "-")) continue;
    const totals = timelineDay(data, day, live?.[day]);
    days.set(day, totals);
    monthly[Number(day.slice(5, 7)) - 1] += totals.words;
    words += totals.words;
    active += Number(totals.words > 0);
    skipped += totals.skipped;
  }
  return { days, monthly, words, active, skipped };
}
