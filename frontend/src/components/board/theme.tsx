/**
 * Hyperknow-exact visual system for the whiteboard.
 *
 * Reverse-engineered from agent.hyperknow.io:
 * - Fonts: Virgil (Excalidraw handwriting, Latin) + Xiaolai (CJK handwriting)
 * - Note cards: SVG feTurbulence "wobble" filters (tblwob-r{3,6,9}-{a,b,c})
 *   — feDisplacementMap scale ~2.2, baseFrequency ~0.035
 * - Title marker highlight: linear-gradient(transparent 55%, rgba(254,243,199,.78) 55%)
 * - Title color: Excalidraw purple #6741D9
 * - Type scale: --board-title-fs: 24px, --board-body-fs: 20px, --code-fs: 16px
 * - Board bg: #fcfcfc with dotted grid (Excalidraw gridMode)
 */

export const BOARD_FONTS = `
@font-face { font-family: "Virgil"; src: url("/fonts/Virgil.woff2") format("woff2"); font-display: swap; }
@font-face { font-family: "Xiaolai"; src: url("https://cdn.jsdelivr.net/gh/lxgw.cn/xiaolai@latest/体检.ttf") format("truetype"); font-display: swap; }
`;

export const FONT_STACK = 'Virgil, Xiaolai, "Segoe UI Emoji", "Apple Color Emoji", "PingFang SC", "Microsoft YaHei", ui-sans-serif, sans-serif';

export const EXCAL_PURPLE = "#6741d9";
export const MARKER_HIGHLIGHT = "linear-gradient(rgba(0,0,0,0) 55%, rgba(254, 243, 199, 0.78) 55%)";
export const BOARD_BG = "#fcfcfc";

/** The wobble filter defs — one per border-radius variant, 3 seeds each. */
export function WobbleFilterDefs() {
  const variants = [3, 6, 9];
  const seeds = [3, 8, 21];
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {variants.flatMap((r) =>
          seeds.map((seed, i) => {
            const freq = (0.03 + i * 0.007).toFixed(3);
            const scale = (2.3 - i * 0.15).toFixed(1);
            return (
              <filter
                key={`tblwob-r${r}-${String.fromCharCode(97 + i)}`}
                id={`tblwob-r${r}-${String.fromCharCode(97 + i)}`}
                x="-15%"
                y="-15%"
                width="130%"
                height="130%"
              >
                <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={2} seed={seed} result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale={scale} xChannelSelector="R" yChannelSelector="G" />
              </filter>
            );
          }),
        )}
      </defs>
    </svg>
  );
}

/** Pick a stable wobble filter for a card (seeded by uid so it doesn't flicker). */
export function wobbleFilterFor(uid: number, radius: 3 | 6 | 9 = 6): string {
  const idx = Math.abs(uid) % 3;
  return `url(#tblwob-r${radius}-${String.fromCharCode(97 + idx)})`;
}
