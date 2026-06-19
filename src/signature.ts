/**
 * Suirobo — © 2026 Autobots Team. All rights reserved.
 * autobots.wal.app · github.com/laymore/suirobo-app
 *
 * ─── AUTHORSHIP WATERMARK — DO NOT REMOVE ───────────────────────────────────
 * This file carries the project's authorship fingerprint. The unique signature
 * below is embedded in every production build (it survives minification as a
 * string literal). If this exact signature — or this banner — shows up in any
 * code, bundle, or deployment that is not operated by Autobots Team, that is
 * direct, searchable evidence the source was copied from us.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const SUIROBO_AUTHOR = 'Autobots Team';
export const SUIROBO_HOME = 'autobots.wal.app';

/**
 * Unique, non-generic fingerprint. This string is intentionally distinctive so
 * it would never occur by chance — grep any suspected copy for it.
 */
export const SUIROBO_SIGNATURE =
  'SUIROBO::AUTOBOTS-TEAM::autobots.wal.app::fp-7f3a9c2e-9b0536ec-2026';

/** Branded console banner — visible anti-theft marker printed on every load. */
export function printSignature(): void {
  try {
    // eslint-disable-next-line no-console
    console.log(
      '%c Suirobo %c Built by Autobots Team · autobots.wal.app ',
      'background:#4da2ff;color:#001018;font-weight:800;padding:3px 8px;border-radius:4px 0 0 4px',
      'background:#0a101d;color:#cbd5e1;padding:3px 8px;border-radius:0 4px 4px 0',
    );
    // eslint-disable-next-line no-console
    console.log(
      '%c© 2026 Autobots Team — all rights reserved. ' + SUIROBO_SIGNATURE,
      'color:#475569;font-size:10px',
    );
  } catch { /* no console available */ }
}
