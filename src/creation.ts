const openWindow = 15_000;

/** The Vault create event has no origin; require a freshly opened blank note. */
export class NewNoteDates<File extends object> {
  private readonly candidates = new WeakMap<File, { day: string; until: number; opened: boolean }>();

  created(file: File, day: string, now = Date.now()): void {
    this.candidates.set(file, { day, until: now + openWindow, opened: false });
  }

  opened(file: File, now = Date.now()): void {
    const candidate = this.candidates.get(file);
    if (candidate && now <= candidate.until) candidate.opened = true;
  }

  pending(file: File): string | undefined {
    const candidate = this.candidates.get(file);
    return candidate?.opened ? candidate.day : undefined;
  }

  done(file: File): void { this.candidates.delete(file); }
}

export function addCreatedIfMissing(frontmatter: unknown, day: string): void {
  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) return;
  if (Object.keys(frontmatter).some(key => key.toLowerCase() === "created")) return;
  (frontmatter as Record<string, unknown>).created = day;
}
