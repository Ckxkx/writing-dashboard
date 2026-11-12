export type Timer = number | ReturnType<typeof globalThis.setTimeout>;

// Obsidian provides the owning window for UI timers. The Node fallback lets
// the tracker and storage run without a DOM in automated tests.
export function scheduleTimer(callback: () => void, delay: number): Timer {
  if (typeof window !== "undefined") return window.setTimeout(callback, delay);
  return globalThis.setTimeout(callback, delay);
}

export function cancelTimer(timer: Timer | undefined): void {
  if (timer === undefined) return;
  if (typeof window !== "undefined" && typeof timer === "number") window.clearTimeout(timer);
  else globalThis.clearTimeout(timer);
}

