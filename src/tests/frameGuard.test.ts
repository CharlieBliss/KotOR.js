import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FrameGuard } from "@/utility/FrameGuard";

afterEach(() => { FrameGuard.reset(); jest.restoreAllMocks(); });

describe("one failure doesn't take the frame down", () => {
  test("the step after a failing one still runs", () => {
    const ran: string[] = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    FrameGuard.run('audio', () => { throw new TypeError('non-finite'); });
    FrameGuard.run('drawing', () => ran.push('drawing'));
    expect(ran).toEqual(['drawing']);
  });

  test("a failure every frame is reported once in full, then at 10, 100, 1000 times", () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 1000; i++) FrameGuard.run('creature n_guard', () => { throw new Error('bad'); });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('creature n_guard failed: bad');
    expect(warn.mock.calls.map((c) => String(c[0]).match(/(\d+) times/)?.[1])).toEqual(['10', '100', '1000']);
    expect(FrameGuard.failures.get('creature n_guard|bad')?.count).toBe(1000);
  });

  test("different failures are reported apart", () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    FrameGuard.run('a', () => { throw new Error('x'); });
    FrameGuard.run('a', () => { throw new Error('y'); });
    FrameGuard.run('b', () => { throw new Error('x'); });
    expect(error).toHaveBeenCalledTimes(3);
  });
});
