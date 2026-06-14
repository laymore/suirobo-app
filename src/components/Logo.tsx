import React from 'react';

/**
 * Suirobo brand mark — "droplet bot": Sui water-drop shaped robot head
 * with visor, aqua eyes and antenna. Per DESIGN.md. Never use 🤖 emoji.
 */

export const SUI_BLUE = '#4DA2FF';
export const SIGNAL_AQUA = '#00D4FF';

interface LogoMarkProps {
  size?: number;
  /** droplet fill color (default Sui Blue) */
  color?: string;
  /** visor/background cutout color — match the surface behind the logo */
  bg?: string;
  /** eyes + antenna tip color */
  eye?: string;
}

export const LogoMark: React.FC<LogoMarkProps> = ({
  size = 36, color = SUI_BLUE, bg = '#0a1628', eye = SIGNAL_AQUA,
}) => (
  <svg width={size} height={size} viewBox="-36 -70 72 80" aria-label="Suirobo logo" role="img">
    <line x1="0" y1="-46" x2="0" y2="-58" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <circle cx="0" cy="-61" r="4.5" fill={eye} />
    <path d="M0,-46 C16,-26 30,-12 30,6 A30,32 0 1,1 -30,6 C-30,-12 -16,-26 0,-46 Z" fill={color} />
    <rect x="-19" y="-4" width="38" height="18" rx="9" fill={bg} />
    <circle cx="-8" cy="5" r="3.5" fill={eye} />
    <circle cx="8" cy="5" r="3.5" fill={eye} />
  </svg>
);

interface LogoLockupProps {
  markSize?: number;
  /** surface color behind the lockup (for the visor cutout) */
  bg?: string;
}

export const LogoLockup: React.FC<LogoLockupProps> = ({ markSize = 36, bg = '#0a1628' }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <LogoMark size={markSize} bg={bg} />
    <div>
      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#fff', letterSpacing: 2, lineHeight: 1.1, fontFamily: "'Space Grotesk', Inter, sans-serif" }}>
        SUIROBO
      </div>
      <div style={{ fontSize: '0.6rem', color: '#7FB8E8', letterSpacing: 3, textTransform: 'uppercase' }}>
        Team Autobots
      </div>
    </div>
  </div>
);
