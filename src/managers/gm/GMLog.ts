/**
 * GMLog: what a GM session does with clicks, requests and their results, in the browser console as one-line
 * "[GM area] message" entries, so it's clear where an interaction stopped. On unless turned off:
 *   KotOR.GMLog.setEnabled(false)   (remembered in this browser)
 * Problems (a request the host turned down, an action that failed) are logged as warnings whether or not it's on.
 */
export class GMLog {

  static STORAGE_KEY = 'kotorjs.gm.debug';

  static enabled: boolean = (() => {
    try { return globalThis.localStorage?.getItem(GMLog.STORAGE_KEY) !== '0'; } catch (e) { return true; }
  })();

  static setEnabled(on: boolean) {
    this.enabled = !!on;
    try { globalThis.localStorage?.setItem(this.STORAGE_KEY, on ? '1' : '0'); } catch (e) {}
    console.info(`[GM] Interaction logging ${on ? 'on' : 'off'}`);
  }

  /** A step that went as expected */
  static info(area: string, message: string, data?: unknown) {
    if (!this.enabled) return;
    if (data === undefined) console.info(`[GM ${area}] ${message}`);
    else console.info(`[GM ${area}] ${message}`, data);
  }

  /** Something that didn't happen, and why */
  static warn(area: string, message: string, data?: unknown) {
    if (data === undefined) console.warn(`[GM ${area}] ${message}`);
    else console.warn(`[GM ${area}] ${message}`, data);
  }

  /** How an object reads in a log line: its name, kind and net id */
  static describe(obj: any): string {
    if (!obj) return 'nothing';
    const name = (typeof obj.getName === 'function' && obj.getName()) || (typeof obj.getTag === 'function' && obj.getTag()) || 'object';
    const kind = obj.constructor?.name?.replace(/^Module/, '') || 'Object';
    return `"${name}" (${kind}${obj.gmNetId ? ` ${obj.gmNetId}` : ', no net id'})`;
  }
}
