// Single source of truth for the desktop (Electron) build flag.
// Set by the Electron preload (window.SUIROBO_DESKTOP = true). On the web build
// this stays false. Import this instead of recomputing the check per-component.
export const IS_DESKTOP =
  typeof window !== 'undefined' && (window as any).SUIROBO_DESKTOP === true;
