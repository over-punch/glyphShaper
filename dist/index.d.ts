import { Font } from 'opentype.js';
import { JSX } from 'react/jsx-runtime';

export declare function applyFontBlob(fontFamily: string, blob: Blob, existingUrl?: string, options?: GlyphShaperOptions): string;

/**
 * A cubic Bézier command — draws a curve using two off-curve control handles.
 * (x1,y1) is the handle near the start; (x2,y2) is the handle near the endpoint.
 */
export declare interface CmdC {
    type: 'C';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x: number;
    y: number;
}

/**
 * A lineto command — draws a straight line from the current point.
 */
export declare interface CmdL {
    type: 'L';
    x: number;
    y: number;
}

/**
 * A moveto command — lifts the pen to an absolute position.
 * Begins a new sub-path.
 */
export declare interface CmdM {
    type: 'M';
    x: number;
    y: number;
}

/**
 * A quadratic Bézier command — draws a curve using one shared off-curve handle.
 */
export declare interface CmdQ {
    type: 'Q';
    x1: number;
    y1: number;
    x: number;
    y: number;
}

/**
 * A closepath command — draws a straight line back to the start of the current sub-path.
 */
export declare interface CmdZ {
    type: 'Z';
}

/**
 * Convert an array of PathCommands to an SVG path `d` attribute string.
 * Uses the glyph coordinate system (y-up) — apply a flip transform in SVG.
 *
 * @param commands - Path commands to serialise
 */
export declare function commandsToPathD(commands: PathCommand[]): string;

/**
 * Serialise the (possibly edited) font back to a Blob.
 * The Blob contains a valid OTF/TTF binary and can be used to create a Blob URL.
 *
 * @param font - Parsed (and optionally edited) font handle
 */
export declare function fontToBlob(font: GlyphFont): Blob;

/**
 * Extract a deep copy of the path commands for the given character.
 * Returns an empty array if the character has no outlines (e.g., space).
 *
 * @param font - Parsed font handle
 * @param char - Single character to look up
 */
export declare function getGlyphCommands(font: GlyphFont, char: string): PathCommand[];

/**
 * Opaque wrapper around an opentype.js Font object.
 * Do not construct directly — use parseFont().
 */
export declare type GlyphFont = {
    _font: Font;
};

/** State returned by useGlyphFont */
declare interface GlyphFontState {
    /** Parsed font handle, or null while loading / on error */
    font: GlyphFont | null;
    /** True while the font is being fetched or parsed */
    loading: boolean;
    /** Human-readable error message, or null if no error */
    error: string | null;
}

/**
 * All-in-one glyph path editor.
 *
 * Renders the provided children with fontFamily applied, a palette of unique
 * characters from `text`, and an inline SVG bezier editor that opens when a
 * character is selected. Clicking "Apply" regenerates the font binary and
 * injects a new @font-face override — every instance of that character on the
 * page re-renders immediately.
 *
 * Each drag operation is one undo step. Undo is available via the button or
 * Ctrl/Cmd+Z while the editor is open.
 *
 * Pass `selectedChar` + `onClose` to operate in controlled mode (e.g. when
 * selection comes from clicking characters in rendered text rather than the
 * built-in tile palette).
 *
 * @example
 * const { font } = useGlyphFont('/fonts/MyFont.ttf')
 * <GlyphShaperEditor font={font} fontFamily="MyFont" text="Heading">
 *   <h1 style={{ fontFamily: 'MyFont' }}>Heading</h1>
 * </GlyphShaperEditor>
 */
export declare function GlyphShaperEditor({ font, fontFamily, text, children, selectedChar, onClose, onApply, hidePalette, }: GlyphShaperEditorProps): JSX.Element;

/** Props for GlyphShaperEditor */
export declare interface GlyphShaperEditorProps {
    /**
     * Parsed font from useGlyphFont() or parseFont().
     * Pass null while the font is loading to render a disabled state.
     */
    font: GlyphFont | null;
    /**
     * CSS font-family name that the @font-face override will target.
     * Must match the font-family already applied to your page text.
     */
    fontFamily: string;
    /**
     * Text used to derive the character palette.
     * Unique printable characters from this string appear as clickable tiles.
     * Default: 'Typography'
     */
    text?: string;
    /**
     * Content rendered with the (possibly overridden) font applied.
     * If omitted, `text` is rendered as a paragraph.
     */
    children?: React.ReactNode;
    /**
     * Externally controlled selected character.
     * When provided, the component operates in controlled mode — the palette
     * still works but the bezier editor opens/closes based on this value.
     * Pass null to close the editor programmatically.
     */
    selectedChar?: string | null;
    /**
     * Called when the editor closes — either from Cancel or after Apply.
     * Use this to reset the controlled selectedChar in the parent.
     */
    onClose?: () => void;
    /**
     * Called after the user clicks "Apply to page" with the character and its
     * new path commands. Use this to update any external glyph snapshots.
     */
    onApply?: (char: string, commands: PathCommand[]) => void;
    /**
     * Hide the character tile palette row.
     * Useful when selection is driven by clicking in rendered text instead.
     */
    hidePalette?: boolean;
}

/** Options for the @font-face override rule injected by applyFontBlob */
export declare interface GlyphShaperOptions {
    /** CSS font-weight for the @font-face rule. Default: 'normal' */
    fontWeight?: string;
    /** CSS font-style for the @font-face rule. Default: 'normal' */
    fontStyle?: string;
}

/**
 * Interactive SVG panel showing the glyph outline with draggable bezier control
 * points.
 *
 * - Renders at `width: 100%` — fills whatever container it is placed in.
 * - `viewBox` stays fixed at VIEWBOX × VIEWBOX; `getScreenCTM().inverse()`
 *   ensures pointer → glyph coordinate conversion is correct at any CSS scale.
 * - Pointer capture keeps drag active when cursor leaves the circle.
 * - `onDragStart` fires once per drag (on pointerdown) so the parent can
 *   snapshot the current commands for undo before any movement happens.
 */
export declare function GlyphSvgEditor({ commands, font, char, onChange, onDragStart, }: GlyphSvgEditorProps): JSX.Element;

/** Props for the standalone GlyphSvgEditor */
export declare interface GlyphSvgEditorProps {
    /** Current path commands to render and edit */
    commands: PathCommand[];
    /** Parsed font handle — used to read metrics (ascender, advance width, etc.) */
    font: GlyphFont;
    /** Character being edited — used only for metrics lookup, not path data */
    char: string;
    /** Called with updated commands after each pointer move during a drag */
    onChange: (commands: PathCommand[]) => void;
    /** Called with the pre-drag snapshot on pointerdown — use this for undo */
    onDragStart: (snapshot: PathCommand[]) => void;
}

/**
 * Parse an ArrayBuffer into a GlyphFont handle.
 * Accepts TTF, OTF, and WOFF1 natively. For WOFF2 input, provide a
 * woff2Decompressor — the library does not bundle one to stay browser-safe.
 * Throws if the buffer is not a valid font.
 *
 * @param buffer           - Raw font bytes from fetch().arrayBuffer() or FileReader
 * @param woff2Decompressor - Optional decompressor for WOFF2 input (see Woff2Decompressor type)
 */
export declare function parseFont(buffer: ArrayBuffer, woff2Decompressor?: Woff2Decompressor): Promise<GlyphFont>;

/** Union of all glyph path segment types produced by opentype.js */
export declare type PathCommand = CmdM | CmdL | CmdC | CmdQ | CmdZ;

/**
 * Revoke a previously created Blob URL and remove the override style that uses it (other families'
 * overrides are left alone). Call this when the editor is unmounted or the font is replaced.
 *
 * @param url - Blob URL previously returned by applyFontBlob()
 */
export declare function revokeFont(url: string): void;

/**
 * Write modified path commands back into the font's glyph.
 * This mutates the font object in place so the next call to fontToBlob()
 * regenerates with these commands applied. The left side bearing and advance width follow the new
 * outline (its real extent, keeping the original right side bearing). Throws a RangeError / TypeError
 * for commands that can't be written into a font (non-numbers, coordinates beyond ±32767, more than
 * 10,000 commands) — the font is left unchanged.
 *
 * @param font     - Parsed font handle (mutated in place)
 * @param char     - Character whose glyph to update
 * @param commands - New path commands (from the editor)
 */
export declare function setGlyphCommands(font: GlyphFont, char: string, commands: PathCommand[]): void;

/**
 * Load and parse a font from a URL or a File object.
 *
 * - Pass a URL string to fetch over HTTP (TTF, OTF, or WOFF1 — not WOFF2,
 *   because this hook does not accept a woff2Decompressor parameter;
 *   use parseFont() directly if you need WOFF2 support).
 * - Pass a File object for user-uploaded fonts (any TTF, OTF, or WOFF1).
 * - Pass null to reset to idle state.
 *
 * The returned font object is stable across re-renders as long as source
 * identity does not change (URL string equality, or File object identity).
 *
 * @param source - Font URL, File, or null
 */
export declare function useGlyphFont(source: string | File | null): GlyphFontState;

/**
 * A function that decompresses a WOFF2 ArrayBuffer to a raw OTF/TTF ArrayBuffer.
 * Pass one to parseFont() when handling WOFF2 input — the library does not bundle
 * a decompressor itself to stay browser-safe.
 *
 * Example using wawoff2 in a Node.js / server context (the result is a view into wawoff2's WebAssembly
 * memory, so copy just its bytes — `result.buffer` alone is the whole heap, not the font):
 * ```ts
 * import { decompress } from 'wawoff2'
 * const decompressor: Woff2Decompressor = async (buf) => {
 *   const result = await decompress(new Uint8Array(buf))
 *   return result.slice().buffer
 * }
 * ```
 *
 * Example using a fetch-based proxy (browser-safe):
 * ```ts
 * const decompressor: Woff2Decompressor = async (buf) => {
 *   const res = await fetch('/api/decompress-woff2', { method: 'POST', body: buf })
 *   return res.arrayBuffer()
 * }
 * ```
 */
export declare type Woff2Decompressor = (woff2Buffer: ArrayBuffer) => Promise<ArrayBuffer>;

export { }
