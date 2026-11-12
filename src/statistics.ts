import { localDate, dateKey } from "./dates";
import type { Data, Day } from "./model";

export function tally(day?: Day) {
  const notes = Object.values(day?.notes ?? {});
  return notes.reduce((totals, note) => ({
    added: totals.added + note.added, net: totals.net + note.net,
    created: totals.created + Number(note.created), skipped: totals.skipped + note.skipped,
    edited: totals.edited + 1,
  }), { added: 0, net: 0, created: 0, skipped: 0, edited: 0 });
}

export function summarize(data: Data, year: number, month: number, today: string) {
  const monthly = Array<number>(12).fill(0);
  const summary = { added: 0, net: 0, active: 0, average: 0, created: 0, peak: 0, skipped: 0 };
  let added = 0, active = 0, skipped = 0;
  for (const [key, day] of Object.entries(data.days)) {
    if (!key.startsWith(year + "-") || key > today) continue;
    const index = Number(key.slice(5, 7)) - 1;
    if (index < 0 || index > 11) continue;
    const t = tally(day);
    monthly[index] += t.added;
    added += t.added;
    active += Number(t.added > 0);
    skipped += t.skipped;
    if (index !== month) continue;
    summary.added += t.added;
    summary.net += t.net;
    summary.active += Number(t.added > 0);
    summary.created += t.created;
    summary.peak = Math.max(summary.peak, t.added);
    summary.skipped += t.skipped;
  }
  const current = localDate(today);
  const divisor = current.getFullYear() === year && current.getMonth() === month
    ? current.getDate() : new Date(year, month + 1, 0).getDate();
  summary.average = Math.round(summary.added / divisor);
  const cursor = localDate(today);
  if (!tally(data.days[today]).added) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (tally(data.days[dateKey(cursor)]).added > 0) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { monthly, summary, added, active, streak, skipped };
}
