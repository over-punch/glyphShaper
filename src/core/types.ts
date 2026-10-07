// glyphShaper/src/core/types.ts — path command types, write-path options and the override options interface

/**
 * A moveto command — lifts the pen to an absolute position.
 * Begins a new sub-path.
 */
export interface CmdM { type: 'M'; x: number; y: number }

/**
 * A lineto command — draws a straight line from the current point.
 */
export interface CmdL { type: 'L'; x: number; y: number }

/**
 * A cubic Bézier command — draws a curve using two off-curve control handles.
 * (x1,y1) is the handle near the start; (x2,y2) is the handle near the endpoint.
 */
export interface CmdC { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }

/**
 * A quadratic Bézier command — draws a curve using one shared off-curve handle.
 */
export interface CmdQ { type: 'Q'; x1: number; y1: number; x: number; y: number }

/**
 * A closepath command — draws a straight line back to the start of the current sub-path.
 */
export interface CmdZ { type: 'Z' }

/** Union of all glyph path segment types produced by opentype.js */
export type PathCommand = CmdM | CmdL | CmdC | CmdQ | CmdZ

/** Options for the @font-face override rule injected by applyFontBlob */
export interface GlyphShaperOptions {
	/** CSS font-weight for the @font-face rule. Default: 'normal' */
	fontWeight?: string
	/** CSS font-style for the @font-face rule. Default: 'normal' */
	fontStyle?: string
}

/**
 * How fontToBlob writes the font:
 * - 'patch': re-encode only the edited glyphs and copy every other table byte-for-byte (TrueType outlines only)
 * - 'rebuild': re-create the whole file with opentype.js (CFF outlines; drops kerning, ligatures, hinting and variable data)
 * - 'auto': patch when the font allows it, rebuild otherwise
 */
export type FontWriteMode = 'auto' | 'patch' | 'rebuild'

/** Options for fontToBlob */
export interface FontWriteOptions {
	/** Which write path to use. Default: 'auto' */
	write?: FontWriteMode
}

/** What fontToBlob did, from getWriteInfo(blob) */
export interface FontWriteInfo {
	/** The write path that ran */
	method: 'patch' | 'rebuild'
	/** Glyph ids whose outlines were edited */
	editedGlyphs: number[]
	/**
	 * Patch path: glyph ids of composite glyphs built from an edited glyph (accented letters, usually). They
	 * show the edited outline, and follow its advance width when they shared it. Empty for a rebuild, which
	 * flattens composites.
	 */
	dependentGlyphs: number[]
	/**
	 * Patch path, variable fonts only: glyph ids whose edit added or removed points, so their own variation
	 * data was removed. They keep one shape at every axis setting; every other glyph still varies.
	 */
	frozenGlyphs: number[]
}
