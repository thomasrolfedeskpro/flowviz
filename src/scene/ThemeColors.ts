export type Theme = 'dark' | 'light'

export interface ThemeConfig {
  clearColor:         number
  gridPrimary:        number
  gridSecondary:      number
  pipeIdle:           number
  pipeActive:         number
  pipeActiveEmissive: number
  /** The dashes threaded through a pipe when a component's connections are
   *  being shown. Read against the glass rather than against the background,
   *  so it inverts with the theme rather than staying one hue. */
  pipeTrace:          number
  packetColor:        number
  ambientColor:       number
  ambientIntensity:   number
  fillColor:          number
  fillIntensity:      number
}

export const THEME_COLORS: Record<Theme, ThemeConfig> = {
  dark: {
    clearColor:         0x1a1a2e,
    gridPrimary:        0x334455,
    gridSecondary:      0x223344,
    pipeIdle:           0x7799bb,  // light blue-grey glass at rest
    pipeActive:         0x66bbff,  // bright blue when a step lights the connection
    pipeActiveEmissive: 0x1a3a5c,
    pipeTrace:          0xffffff,  // white on dark glass
    packetColor:        0x000000,
    ambientColor:       0xffeedd,
    ambientIntensity:   0.9,
    fillColor:          0xaaccff,
    fillIntensity:      0.6,
  },
  light: {
    clearColor:         0xedf0f5,
    gridPrimary:        0xc8d4e0,
    gridSecondary:      0xd8e4ee,
    pipeIdle:           0x99bbcc,  // pale blue-grey glass at rest
    pipeActive:         0x3388cc,  // medium blue when lit
    pipeActiveEmissive: 0x112233,  // subtle inner glow (was none)
    pipeTrace:          0x111d3a,  // dark navy on pale glass
    packetColor:        0x000000,
    ambientColor:       0xffffff,
    ambientIntensity:   1.8,
    fillColor:          0xaaccff,
    fillIntensity:      0.5,
  },
}
