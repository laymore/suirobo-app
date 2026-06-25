/**
 * prefs — lightweight, localStorage-backed user preferences.
 *
 * Kept deliberately tiny and dependency-free so any module (including the
 * module-level notify() in LiveTradeDashboard) can read a preference without
 * pulling in a React hook. Defaults are chosen so a missing key = sensible on.
 */

const K_NOTIFY = 'suirobo_notify_enabled';

/** Native trade notifications (position opened / closed). Default: ON. */
export function getNotifyEnabled(): boolean {
  try { return localStorage.getItem(K_NOTIFY) !== '0'; } catch { return true; }
}
export function setNotifyEnabled(on: boolean): void {
  try { localStorage.setItem(K_NOTIFY, on ? '1' : '0'); } catch { /* ignore */ }
}
