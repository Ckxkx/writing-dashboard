export type Timer = number;

export function scheduleTimer(callback: () => void, delay: number): Timer {
  return window.setTimeout(callback, delay);
}

export function cancelTimer(timer: Timer | undefined): void {
  if (timer !== undefined) window.clearTimeout(timer);
}

