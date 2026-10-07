// glyphShaper/src/react/GlyphShaperEditor.tsx — interactive glyph bezier editor component

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { PathCommand } from '../core/types'
import type { GlyphFont } from '../core/forge'
import { getGlyphCommands, setGlyphCommands, fontToBlob, applyFontBlob, revokeFont, commandsToPathD } from '../core/forge'

// ─── SVG coordinate constants ──────────────────────────────────────────────────

/**
 * The internal SVG viewBox size in coordinate units.
 * The SVG renders at whatever CSS width its container provides — this value only
 * defines the internal coordinate system used for path drawing and control points.
 */
const VIEWBOX = 360
/** Padding inside the viewBox around the glyph */
const PADDING = 32
/** Radius of anchor (on-curve) control point circles, in viewBox units */
const ANCHOR_R = 7
/** Radius of handle (off-curve) control point circles, in viewBox units */
const HANDLE_R = 5
/** Maximum undo history depth */
const MAX_HISTORY = 50

// ─── Drag point ───────────────────────────────────────────────────────────────

/** A single draggable control point in the SVG editor */
interface DragPoint {
	/** Index into the commands array */
	cmdIdx: number
	/** Which coordinate fields this point controls */
	field: 'xy' | 'x1y1' | 'x2y2'
	/** Whether this is an on-curve anchor or off-curve bezier handle */
	kind: 'anchor' | 'handle'
	/** Current x position in glyph coordinate space */
	x: number
	/** Current y position in glyph coordinate space */
	y: number
}

/** Handle line connecting an off-curve handle to its on-curve anchor */
interface HandleLine {
	x1: number; y1: number
	x2: number; y2: number
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/**
 * Convert glyph coordinates to SVG viewBox coordinates.
 * Glyph space: y-up, origin at baseline-left.
 * SVG space: y-down, origin at top-left.
 */
function toSVG(gx: number, gy: number, scale: number, lsb: number, ascender: number): [number, number] {
	return [
		PADDING + (gx - lsb) * scale,
		PADDING + (ascender - gy) * scale,
	]
}

/**
 * Convert SVG viewBox coordinates back to glyph coordinates.
 * The SVG scales via CSS (width: 100%) but getScreenCTM().inverse() accounts
 * for that — pointer events always arrive in client coordinates regardless of
 * CSS scale, and the matrix transform converts them to viewBox coordinates.
 */
function toGlyph(svgX: number, svgY: number, scale: number, lsb: number, ascender: number): [number, number] {
	return [
		(svgX - PADDING) / scale + lsb,
		ascender - (svgY - PADDING) / scale,
	]
}

// ─── Path analysis ────────────────────────────────────────────────────────────

/**
 * Build a flat list of draggable control points from the command array.
 * Each command contributes one anchor (on-curve endpoint) plus zero, one, or
 * two off-curve handles depending on command type.
 */
function buildDragPoints(commands: PathCommand[]): DragPoint[] {
	const pts: DragPoint[] = []
	for (let i = 0; i < commands.length; i++) {
		const cmd = commands[i]
		if (cmd.type === 'M' || cmd.type === 'L') {
			pts.push({ cmdIdx: i, field: 'xy', kind: 'anchor', x: cmd.x, y: cmd.y })
		} else if (cmd.type === 'C') {
			pts.push({ cmdIdx: i, field: 'x1y1', kind: 'handle', x: cmd.x1, y: cmd.y1 })
			pts.push({ cmdIdx: i, field: 'x2y2', kind: 'handle', x: cmd.x2, y: cmd.y2 })
			pts.push({ cmdIdx: i, field: 'xy',   kind: 'anchor', x: cmd.x,  y: cmd.y  })
		} else if (cmd.type === 'Q') {
			pts.push({ cmdIdx: i, field: 'x1y1', kind: 'handle', x: cmd.x1, y: cmd.y1 })
			pts.push({ cmdIdx: i, field: 'xy',   kind: 'anchor', x: cmd.x,  y: cmd.y  })
		}
		// Z has no points
	}
	return pts
}

/**
 * Build lines that visually connect each off-curve handle to its adjacent anchors.
 */
function buildHandleLines(commands: PathCommand[]): HandleLine[] {
	const lines: HandleLine[] = []
	let prevX = 0
	let prevY = 0
	for (const cmd of commands) {
		if (cmd.type === 'M' || cmd.type === 'L') {
			prevX = cmd.x; prevY = cmd.y
		} else if (cmd.type === 'C') {
			lines.push({ x1: prevX, y1: prevY, x2: cmd.x1, y2: cmd.y1 })
			lines.push({ x1: cmd.x2, y1: cmd.y2, x2: cmd.x, y2: cmd.y })
			prevX = cmd.x; prevY = cmd.y
		} else if (cmd.type === 'Q') {
			lines.push({ x1: prevX, y1: prevY, x2: cmd.x1, y2: cmd.y1 })
			lines.push({ x1: cmd.x1, y1: cmd.y1, x2: cmd.x, y2: cmd.y })
			prevX = cmd.x; prevY = cmd.y
		}
	}
	return lines
}

/**
 * Return a new commands array with one control point moved to (newX, newY).
 * Rounds to integers to keep font unit values clean.
 *
 * The move keeps the outline's point structure, so the font's own points only move (none is added):
 *
 * - **Welded anchors move together.** A TrueType outline arrives with a curve's end repeated by a zero-length
 *   line, and the contour's start repeated at its close. They are one point in the font.
 * - **Implied anchors follow their handles.** Where two quadratic curves meet smoothly, TrueType doesn't store
 *   the meeting point: it is implied, midway between the two handles. Dragging a handle moves that point to
 *   the new midpoint. Dragging the implied point itself moves both of its handles with it.
 *
 * Without this, one drag would turn an implied point into a stored one. In a variable font that changes the
 * glyph's point numbering, and its variation data no longer fits.
 */
export function movePoint(
	commands: PathCommand[],
	cmdIdx: number,
	field: 'xy' | 'x1y1' | 'x2y2',
	newX: number,
	newY: number,
): PathCommand[] {
	const rx = Math.round(newX)
	const ry = Math.round(newY)
	const target = commands[cmdIdx]
	if (!target || target.type === 'Z') return commands
	// The contour that holds the moved point: from its M up to its Z.
	let start = cmdIdx, end = cmdIdx
	while (start > 0 && commands[start].type !== 'M') start--
	while (end < commands.length - 1 && commands[end].type !== 'Z') end++
	const first = commands[start].type === 'M' ? start + 1 : start
	const last = commands[end].type === 'Z' ? end - 1 : end
	const n = last - first + 1
	const out = commands.map((c) => ({ ...c })) as PathCommand[]
	/** The segment after segment i in this contour (wrapping round). */
	const next = (i: number) => first + ((i - first + 1) % n)
	/** True if segment i ends on an implied point: midway between its own handle and the next segment's. */
	const implied = (i: number): boolean => {
		const a = commands[i], b = n > 1 ? commands[next(i)] : null
		if (!a || !b || a.type !== 'Q' || b.type !== 'Q') return false
		return Math.abs(a.x - (a.x1 + b.x1) / 2) < 1e-6 && Math.abs(a.y - (a.y1 + b.y1) / 2) < 1e-6
	}
	const flags: boolean[] = []
	for (let i = first; i <= last; i++) flags[i] = cmdIdx >= first && n > 0 ? implied(i) : false
	const m = commands[start]
	const lastSeg = commands[last]
	// The contour's start is welded to its closing point when they coincide.
	const startWelded = m.type === 'M' && lastSeg && lastSeg.type !== 'Z' && last >= first && m.x === lastSeg.x && m.y === lastSeg.y

	if (field === 'xy' && cmdIdx >= first && flags[cmdIdx]) {
		// An implied anchor: carry its two handles along, by a whole number of units.
		const a = out[cmdIdx] as Extract<PathCommand, { type: 'Q' }>
		const b = out[next(cmdIdx)] as Extract<PathCommand, { type: 'Q' }>
		const dx = Math.round(newX - a.x), dy = Math.round(newY - a.y)
		a.x1 += dx; a.y1 += dy
		if (b !== a) { b.x1 += dx; b.y1 += dy }
	} else if (field === 'xy') {
		// A stored anchor: move it and every anchor of this contour welded to it.
		const wx = target.x, wy = target.y
		for (let i = start; i <= end; i++) {
			const c = out[i]
			if (c.type !== 'Z' && (i === cmdIdx || (c.x === wx && c.y === wy))) { c.x = rx; c.y = ry }
		}
	} else {
		const c = out[cmdIdx]
		if (field === 'x1y1' && (c.type === 'C' || c.type === 'Q')) { c.x1 = rx; c.y1 = ry }
		if (field === 'x2y2' && c.type === 'C') { c.x2 = rx; c.y2 = ry }
	}

	// Put every implied anchor back midway between its (possibly moved) handles.
	for (let i = first; i <= last; i++) {
		if (!flags[i]) continue
		const a = out[i] as Extract<PathCommand, { type: 'Q' }>
		const b = out[next(i)] as Extract<PathCommand, { type: 'Q' }>
		a.x = (a.x1 + b.x1) / 2
		a.y = (a.y1 + b.y1) / 2
	}
	if (startWelded && flags[last]) {
		const mm = out[start], l = out[last]
		if (mm.type === 'M' && l.type !== 'Z') { mm.x = l.x; mm.y = l.y }
	}
	return out
}

type GraphemeSegmenter = { segment: (t: string) => Iterable<{ segment: string }> }
const graphemeSegmenter: GraphemeSegmenter | null = typeof Intl !== 'undefined' && 'Segmenter' in Intl
	? new (Intl as unknown as { Segmenter: new (l: undefined, o: { granularity: 'grapheme' }) => GraphemeSegmenter }).Segmenter(undefined, { granularity: 'grapheme' })
	: null

/** Collect unique printable characters (graphemes, so emoji stay whole) from a string, in first-seen order. */
function uniquePrintableChars(text: string): string[] {
	const seen = new Set<string>()
	const all = graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), (g) => g.segment) : Array.from(text)
	return all.filter(c => {
		if (!c.trim() || seen.has(c)) return false
		seen.add(c)
		return true
	})
}

// ─── SVG glyph editor ─────────────────────────────────────────────────────────

/** Props for the standalone GlyphSvgEditor */
export interface GlyphSvgEditorProps {
	/** Current path commands to render and edit */
	commands: PathCommand[]
	/** Parsed font handle — used to read metrics (ascender, advance width, etc.) */
	font: GlyphFont
	/** Character being edited — used only for metrics lookup, not path data */
	char: string
	/** Called with updated commands after each pointer move during a drag */
	onChange: (commands: PathCommand[]) => void
	/** Called with the pre-drag snapshot on pointerdown — use this for undo */
	onDragStart: (snapshot: PathCommand[]) => void
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
export function GlyphSvgEditor({
	commands,
	font,
	char,
	onChange,
	onDragStart,
}: GlyphSvgEditorProps) {
	const svgRef = useRef<SVGSVGElement>(null)
	const dragging = useRef<{ cmdIdx: number; field: 'xy' | 'x1y1' | 'x2y2' } | null>(null)

	// Compute scale so the glyph fills the available viewBox area
	const f        = font._font
	const glyphIdx = f.charToGlyphIndex(char)
	const glyph    = f.glyphs.get(glyphIdx)
	const lsb      = glyph?.leftSideBearing ?? 0
	const advance  = glyph?.advanceWidth   ?? f.unitsPerEm
	const ascender  = f.ascender
	const descender = f.descender
	const glyphW = advance
	const glyphH = ascender - descender
	const available = VIEWBOX - 2 * PADDING
	const scale = Math.min(available / glyphW, available / glyphH)

	const baselineY = PADDING + ascender * scale

	/** Convert a pointer event's client coordinates to glyph coordinates.
	 *  Uses getScreenCTM().inverse() so CSS scaling (width: 100%) is accounted for. */
	const ptrToGlyph = useCallback((e: React.PointerEvent): [number, number] => {
		const svg = svgRef.current
		if (!svg) return [0, 0]
		const ctm = svg.getScreenCTM()
		if (!ctm) return [0, 0]
		const pt = svg.createSVGPoint()
		pt.x = e.clientX
		pt.y = e.clientY
		const svgPt = pt.matrixTransform(ctm.inverse())
		return toGlyph(svgPt.x, svgPt.y, scale, lsb, ascender)
	}, [scale, lsb, ascender])

	function handlePointerDown(
		e: React.PointerEvent<SVGCircleElement>,
		cmdIdx: number,
		field: 'xy' | 'x1y1' | 'x2y2',
	) {
		// Ignore secondary touch points (multi-touch) to prevent duplicate drag-starts
		if (!e.isPrimary) return
		e.stopPropagation()
		;(e.target as SVGCircleElement).setPointerCapture(e.pointerId)
		// Snapshot current commands BEFORE the drag — this is one undo step
		onDragStart(commands)
		dragging.current = { cmdIdx, field }
	}

	function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
		if (!dragging.current) return
		const [gx, gy] = ptrToGlyph(e)
		onChange(movePoint(commands, dragging.current.cmdIdx, dragging.current.field, gx, gy))
	}

	function handlePointerUp() {
		dragging.current = null
	}

	/** Arrow keys move the focused point by 1 font unit (10 with Shift); each key press is one undo step. */
	function handlePointKeyDown(e: React.KeyboardEvent<SVGCircleElement>, cmdIdx: number, field: 'xy' | 'x1y1' | 'x2y2', x: number, y: number) {
		const step = e.shiftKey ? 10 : 1
		const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
		const d = delta[e.key]
		if (!d) return
		e.preventDefault()
		onDragStart(commands)
		onChange(movePoint(commands, cmdIdx, field, x + d[0], y + d[1]))
	}

	const pathD      = commandsToPathD(commands)
	const dragPoints = buildDragPoints(commands)
	const handleLns  = buildHandleLines(commands)

	return (
		<svg
			ref={svgRef}
			width="100%"
			viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerLeave={handlePointerUp}
			style={{
				display: 'block',
				touchAction: 'none',
				cursor: 'default',
				// Maintain a 1:1 aspect ratio as width scales with the container
				aspectRatio: '1 / 1',
			}}
			role="group"
			aria-label={`Glyph path editor for character ${char}. Tab to a point, then use the arrow keys to move it (Shift for 10 units).`}
		>
			{/* Baseline guide */}
			<line
				x1={PADDING / 2} y1={baselineY}
				x2={VIEWBOX - PADDING / 2} y2={baselineY}
				stroke="rgba(255,255,255,0.08)" strokeWidth={1}
			/>

			{/* Advance-width guide */}
			{(() => {
				const [ax] = toSVG(advance, 0, scale, lsb, ascender)
				return (
					<line
						x1={ax} y1={PADDING / 2}
						x2={ax} y2={VIEWBOX - PADDING / 2}
						stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="4 4"
					/>
				)
			})()}

			{/* Glyph path in glyph coordinate space via a y-flipping transform */}
			<g transform={`translate(${PADDING + (0 - lsb) * scale}, ${PADDING + ascender * scale}) scale(${scale}, ${-scale})`}>
				{commands.length > 0 && (
					<path
						d={pathD}
						fill="rgba(53,221,226,0.12)"
						stroke="rgba(53,221,226,0.55)"
						strokeWidth={2 / scale}
						fillRule="nonzero"
					/>
				)}
			</g>

			{/* Handle guide lines */}
			{handleLns.map((ln, i) => {
				const [x1s, y1s] = toSVG(ln.x1, ln.y1, scale, lsb, ascender)
				const [x2s, y2s] = toSVG(ln.x2, ln.y2, scale, lsb, ascender)
				return (
					<line
						key={i}
						x1={x1s} y1={y1s} x2={x2s} y2={y2s}
						stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3 3"
					/>
				)
			})}

			{/* Draggable control points */}
			{dragPoints.map((pt, i) => {
				const [cx, cy] = toSVG(pt.x, pt.y, scale, lsb, ascender)
				const r = pt.kind === 'anchor' ? ANCHOR_R : HANDLE_R
				return (
					<circle
						key={i}
						role="button"
						aria-label={`${pt.kind === 'anchor' ? 'Anchor' : 'Handle'} point ${i + 1} of ${dragPoints.length}, x ${Math.round(pt.x)}, y ${Math.round(pt.y)}`}
						tabIndex={0}
						onKeyDown={(e) => handlePointKeyDown(e, pt.cmdIdx, pt.field, pt.x, pt.y)}
						cx={cx} cy={cy} r={r}
						fill={pt.kind === 'anchor' ? 'rgba(53,221,226,0.9)' : 'rgba(0,0,0,0)'}
						stroke="rgba(53,221,226,0.75)"
						strokeWidth={1.5}
						style={{ cursor: 'grab' }}
						onPointerDown={(e) => handlePointerDown(e, pt.cmdIdx, pt.field)}
					/>
				)
			})}

			{commands.length === 0 && (
				<text
					x={VIEWBOX / 2} y={VIEWBOX / 2}
					textAnchor="middle"
					fill="rgba(255,255,255,0.3)"
					fontSize={12}
					fontFamily="sans-serif"
				>
					No outlines for this character
				</text>
			)}
		</svg>
	)
}

// ─── Main exported component ──────────────────────────────────────────────────

/** Props for GlyphShaperEditor */
export interface GlyphShaperEditorProps {
	/**
	 * Parsed font from useGlyphFont() or parseFont().
	 * Pass null while the font is loading to render a disabled state.
	 */
	font: GlyphFont | null
	/**
	 * CSS font-family name that the @font-face override will target.
	 * Must match the font-family already applied to your page text.
	 */
	fontFamily: string
	/**
	 * Text used to derive the character palette.
	 * Unique printable characters from this string appear as clickable tiles.
	 * Default: 'Typography'
	 */
	text?: string
	/**
	 * Content rendered with the (possibly overridden) font applied.
	 * If omitted, `text` is rendered as a paragraph.
	 */
	children?: React.ReactNode
	/**
	 * Externally controlled selected character.
	 * When provided, the component operates in controlled mode — the palette
	 * still works but the bezier editor opens/closes based on this value.
	 * Pass null to close the editor programmatically.
	 */
	selectedChar?: string | null
	/**
	 * Called when the editor closes — either from Cancel or after Apply.
	 * Use this to reset the controlled selectedChar in the parent.
	 */
	onClose?: () => void
	/**
	 * Called after the user clicks "Apply to page" with the character and its
	 * new path commands. Use this to update any external glyph snapshots.
	 */
	onApply?: (char: string, commands: PathCommand[]) => void
	/**
	 * Hide the character tile palette row.
	 * Useful when selection is driven by clicking in rendered text instead.
	 */
	hidePalette?: boolean
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
export function GlyphShaperEditor({
	font,
	fontFamily,
	text = 'Typography',
	children,
	selectedChar,
	onClose,
	onApply,
	hidePalette = false,
}: GlyphShaperEditorProps) {
	const [editingChar, setEditingChar] = useState<string | null>(null)
	const [commands, setCommands]       = useState<PathCommand[]>([])
	/** Undo history — each entry is a pre-drag snapshot of the commands array */
	const [history, setHistory]         = useState<PathCommand[][]>([])
	/** Most-recently applied Blob URL — kept so we can revoke it on next apply */
	const appliedUrlRef = useRef<string | null>(null)
	/** Ref that stays in sync with editingChar without triggering effect deps */
	const editingCharRef = useRef<string | null>(null)

	const [applyError, setApplyError] = useState<string | null>(null)
	/** The open editor panel — focus moves into it when a character is opened */
	const panelRef = useRef<HTMLDivElement>(null)
	const chars   = uniquePrintableChars(text)
	const canUndo = history.length > 0

	// Revoke any active Blob URL when the component unmounts to free font binary memory
	useEffect(() => {
		return () => {
			if (appliedUrlRef.current) {
				revokeFont(appliedUrlRef.current)
				appliedUrlRef.current = null
			}
		}
	}, [])

	// Keep editingCharRef in sync
	useEffect(() => { editingCharRef.current = editingChar }, [editingChar])

	// A different font: close the open glyph (its path belongs to the old font).
	const fontRef = useRef(font)
	useEffect(() => {
		if (fontRef.current === font) return
		fontRef.current = font
		if (editingCharRef.current !== null && selectedChar === undefined) {
			setEditingChar(null)
			setCommands([])
			setHistory([])
		} else if (editingCharRef.current !== null && font) {
			setCommands(getGlyphCommands(font, editingCharRef.current))
			setHistory([])
		}
	}, [font, selectedChar])

	// Move focus into the editor when a character is opened (keyboard and screen-reader users).
	useEffect(() => {
		if (editingChar) panelRef.current?.querySelector<SVGElement>('circle')?.focus?.()
	}, [editingChar])

	// ─── Controlled mode: sync selectedChar prop → internal state ──────────────

	useEffect(() => {
		if (selectedChar === undefined) return // uncontrolled
		if (!font) return
		const current = editingCharRef.current
		if (selectedChar === null) {
			if (current !== null) {
				setEditingChar(null)
				setCommands([])
				setHistory([])
			}
		} else if (selectedChar !== current) {
			setCommands(getGlyphCommands(font, selectedChar))
			setEditingChar(selectedChar)
			setHistory([])
		}
	}, [selectedChar, font])

	// ─── Undo ──────────────────────────────────────────────────────────────────

	function handleUndo() {
		if (history.length === 0) return
		const prev = history[history.length - 1]
		setHistory(h => h.slice(0, -1))
		setCommands(prev)
	}

	/** Snapshot commands before each drag so every drag is one undo step. */
	function handleDragStart(snapshot: PathCommand[]) {
		setHistory(h => {
			const next = [...h, snapshot]
			// Cap history depth to avoid unbounded memory growth
			return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
		})
	}

	// ─── Keyboard shortcut ─────────────────────────────────────────────────────

	// Keep a stable ref to the latest handleUndo so the effect doesn't need to
	// re-bind on every history change
	const undoRef = useRef(handleUndo)
	useEffect(() => { undoRef.current = handleUndo })

	useEffect(() => {
		if (!editingChar) return
		function onKeyDown(e: KeyboardEvent) {
			// Only undo glyph edits when focus is in the editor (or nowhere in particular): never swallow
			// native undo in form fields or editable content elsewhere on the page.
			const target = e.target as HTMLElement | null
			const inEditor = !!target && !!panelRef.current?.contains(target)
			const neutral = !target || target === document.body || target === document.documentElement
			if (!inEditor && !neutral) return
			if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
				e.preventDefault()
				undoRef.current()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [editingChar])

	// ─── Editor lifecycle ───────────────────────────────────────────────────────

	function openChar(char: string) {
		if (!font) return
		setCommands(getGlyphCommands(font, char))
		setEditingChar(char)
		setHistory([])
	}

	function handleCancel() {
		setEditingChar(null)
		setCommands([])
		setHistory([])
		onClose?.()
	}

	function handleApply() {
		if (!font || !editingChar) return
		let url: string
		try {
			setGlyphCommands(font, editingChar, commands)
			const blob = fontToBlob(font)
			url = applyFontBlob(fontFamily, blob, appliedUrlRef.current ?? undefined)
		} catch (err) {
			// Keep the editor open and say why (an invalid path, or a font opentype.js can't write).
			setApplyError(err instanceof Error ? err.message : String(err))
			return
		}
		setApplyError(null)
		appliedUrlRef.current = url
		onApply?.(editingChar, [...commands])
		setEditingChar(null)
		setCommands([])
		setHistory([])
		onClose?.()
	}

	// ─── Render ────────────────────────────────────────────────────────────────

	return (
		<div>
			{/* Rendered text preview */}
			{(children != null || !hidePalette) && (
				<div style={{ fontFamily }}>
					{children ?? <p>{text}</p>}
				</div>
			)}

			{/* Character palette — hidden when driven by external selection */}
			{font && !hidePalette && (
				<div
					role="group"
					aria-label="Character palette — click to edit"
					style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}
				>
					{chars.map(char => (
						<button
							key={char}
							onClick={() => openChar(char)}
							aria-pressed={editingChar === char}
							style={{
								width: 32,
								height: 32,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontFamily,
								fontSize: 16,
								border: '1px solid rgba(255,255,255,0.2)',
								borderRadius: 4,
								background: editingChar === char ? 'rgba(53,221,226,0.15)' : 'transparent',
								cursor: 'pointer',
								color: 'inherit',
								transition: 'background 0.15s',
							}}
						>
							{char}
						</button>
					))}
				</div>
			)}

			{/* Inline bezier editor */}
			{editingChar && font && (
				<div
					ref={panelRef}
					style={{
						marginTop: 16,
						padding: 16,
						border: '1px solid rgba(255,255,255,0.12)',
						borderRadius: 8,
					}}
				>
					<p style={{ fontSize: 11, opacity: 0.5, marginBottom: 12, fontFamily: 'sans-serif' }}>
						Editing &ldquo;{editingChar}&rdquo; — drag filled circles (anchors) or outlined circles (handles) to reshape
					</p>

					<GlyphSvgEditor
						commands={commands}
						font={font}
						char={editingChar}
						onChange={setCommands}
						onDragStart={handleDragStart}
					/>

					<div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
						<button
							onClick={handleCancel}
							style={{
								fontSize: 12,
								padding: '4px 12px',
								borderRadius: 20,
								border: '1px solid rgba(255,255,255,0.3)',
								background: 'transparent',
								color: 'inherit',
								opacity: 0.6,
								cursor: 'pointer',
							}}
						>
							Cancel
						</button>

						<button
							onClick={handleUndo}
							disabled={!canUndo}
							title="Undo last drag (Ctrl+Z / Cmd+Z)"
							style={{
								fontSize: 12,
								padding: '4px 12px',
								borderRadius: 20,
								border: '1px solid rgba(255,255,255,0.3)',
								background: 'transparent',
								color: 'inherit',
								opacity: canUndo ? 0.7 : 0.25,
								cursor: canUndo ? 'pointer' : 'default',
								transition: 'opacity 0.15s',
							}}
						>
							Undo
						</button>

						<button
							onClick={handleApply}
							style={{
								fontSize: 12,
								padding: '4px 12px',
								borderRadius: 20,
								border: '1px solid rgba(53,221,226,0.7)',
								background: 'rgba(53,221,226,0.1)',
								color: 'inherit',
								cursor: 'pointer',
								marginLeft: 'auto',
							}}
						>
							Apply to page
						</button>
					</div>
					{applyError && (
						<p role="alert" style={{ marginTop: 8, fontSize: 12, fontFamily: 'sans-serif' }}>
							{applyError}
						</p>
					)}
				</div>
			)}

			{!font && (
				<p style={{ marginTop: 12, fontSize: 12, opacity: 0.4, fontFamily: 'sans-serif' }}>
					No font loaded.
				</p>
			)}
		</div>
	)
}
