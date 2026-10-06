// glyphShaper/src/core.ts — React-free entry (@overpunch/glyphshaper/core): parsing, editing and applying fonts (needs opentype.js).
export type { PathCommand, GlyphShaperOptions, CmdM, CmdL, CmdC, CmdQ, CmdZ } from './core/types'
export type { GlyphFont, Woff2Decompressor } from './core/forge'
export { parseFont, getGlyphCommands, setGlyphCommands, fontToBlob, applyFontBlob, revokeFont, commandsToPathD } from './core/forge'
