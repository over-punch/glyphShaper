// glyphShaper/src/core.ts — React-free entry (@overpunch/glyphshaper/core): parsing, editing and applying fonts (needs opentype.js).
export type { PathCommand, GlyphShaperOptions, FontWriteMode, FontWriteOptions, FontWriteInfo, CmdM, CmdL, CmdC, CmdQ, CmdZ } from './core/types'
export type { TableComparison } from './core/patch'
export { compareFontTables } from './core/patch'
export type { GlyphFont, Woff2Decompressor } from './core/forge'
export { parseFont, getGlyphCommands, setGlyphCommands, fontToBlob, getWriteInfo, getFontSource, applyFontBlob, revokeFont, commandsToPathD } from './core/forge'
