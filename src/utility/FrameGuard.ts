/**
 * Keeps one failure from taking the frame down. Every frame the engine runs its systems (input, menus, the area's
 * creatures and objects, audio, drawing); one that throws used to stop everything after it, and do it again the
 * next frame and the one after: the console filled with the same error sixty times a second and the game stopped
 * drawing. Each step runs guarded: its first failure is reported in full (where, what, the stack), repeats only
 * at 10, 100, 1000... times, and everything else carries on.
 */
export interface FrameFailure {
  where: string;
  message: string;
  count: number;
  first: number;
}

export class FrameGuard {
  static failures: Map<string, FrameFailure> = new Map();

  /** Run a step; a failure is reported and the frame carries on */
  static run(where: string, step: () => void): void {
    try { step(); } catch (e) { FrameGuard.report(where, e); }
  }

  /** A step failed: in full the first time, then as a count now and then */
  static report(where: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${where}|${message}`;
    let failure = FrameGuard.failures.get(key);
    if (!failure) {
      failure = { where, message, count: 0, first: Date.now() };
      FrameGuard.failures.set(key, failure);
    }
    failure.count++;
    if (failure.count === 1) {
      console.error(`[frame] ${where} failed: ${message}`, error);
    } else if (Math.log10(failure.count) % 1 === 0) {
      console.warn(`[frame] ${where} has failed ${failure.count} times: ${message}`);
    }
  }

  /** Forget what failed (a new module: its objects are new) */
  static reset(): void {
    FrameGuard.failures.clear();
  }

  /** Name an object for a report: its kind and tag */
  static nameOf(kind: string, obj: any): string {
    const tag = obj?.getTag?.() || obj?.tag || obj?.name || '?';
    return `${kind} ${tag}`;
  }
}
