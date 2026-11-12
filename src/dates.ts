export function dateKey(date = new Date()): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

export function localDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function calendar(year: number): { date: string; row: number; col: number; month: number; first: boolean }[] {
  const start = new Date(year, 0, 1, 12);
  const cells = [];
  let i = start.getDay();
  for (const day = new Date(start); day.getFullYear() === year; day.setDate(day.getDate() + 1), i++) {
    cells.push({ date: dateKey(day), row: i % 7, col: Math.floor(i / 7),
      month: day.getMonth(), first: day.getDate() === 1 });
  }
  return cells;
}
