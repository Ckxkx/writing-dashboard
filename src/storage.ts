import { cancelTimer, scheduleTimer, type Timer } from "./timers";
// Single writer. A change made during an in-flight save stays dirty and
// is written in the next revision; each call receives an immutable snapshot.
export class Storage<T> {
  private timer: Timer | undefined;
  private dirtyAt = 0;
  private revision = 0;
  private saved = 0;
  private pending?: Promise<void>;
  private closed = false;
  private failed = false;

  constructor(private readonly read: () => T, private readonly save: (data: T) => Promise<void>,
    private readonly onError: (error: unknown) => void) {}

  change(): void {
    if (this.closed) return;
    this.revision++;
    this.dirtyAt ||= Date.now();
    this.schedule();
  }

  private schedule(delay = Math.min(650, Math.max(0, 2500 - (Date.now() - this.dirtyAt)))): void {
    cancelTimer(this.timer);
    if (!this.closed && this.saved !== this.revision) {
      this.timer = scheduleTimer(() => { void this.flush(); }, delay);
    }
  }

  async flush(): Promise<void> {
    cancelTimer(this.timer);
    if (this.pending) await this.pending;
    if (this.saved === this.revision) return;
    if (this.pending) return this.flush();
    const revision = this.revision;
    this.dirtyAt = 0;
    this.failed = false;
    const write = async () => {
      try {
        const data = structuredClone(this.read());
        await this.save(data);
        this.saved = revision;
      } catch (error) {
        this.failed = true;
        this.onError(error);
      }
    };
    this.pending = write();
    await this.pending;
    this.pending = undefined;
    this.schedule(this.failed ? 5000 : undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
