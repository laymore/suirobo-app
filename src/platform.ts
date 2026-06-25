// Single source of truth for the desktop (Electron) build flag.
// Set by the Electron preload (window.SUIROBO_DESKTOP = true). On the web build
// this stays false. Import this instead of recomputing the check per-component.
//
// Dev affordance: on localhost only, `?desktop=1` forces the desktop layout so the
// trimmed desktop UI (account strip, Settings, Client-Bot-only) can be previewed in
// a browser. Gated to localhost so the production Walrus site can never trigger it.
function computeIsDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).SUIROBO_DESKTOP === true) return true;
  try {
    const isLocalhost = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (isLocalhost && /[?&]desktop=1/.test(window.location.search)) return true;
  } catch { /* no location → web */ }
  return false;
}

export const IS_DESKTOP = computeIsDesktop();
