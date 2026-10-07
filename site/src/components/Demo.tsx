"use client"

// Interactive demo — edit glyphs of PT Serif (or Roboto Flex, or an upload), switch between the two write paths and see what each one keeps
import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react"
import { useMediaQuery } from "@/lib/clientValue"
import {
	parseFont, applyFontBlob, fontToBlob,
	getGlyphCommands, setGlyphCommands,
	getWriteInfo, getFontSource, compareFontTables,
	GlyphSvgEditor,
} from "@overpunch/glyphshaper"
import type { GlyphFont, PathCommand, FontWriteMode } from "@overpunch/glyphshaper"

/** CSS font-family name used for the demo override rule */
const DEMO_FAMILY = "GlyphShaperDemo"

/** Accepted font file extensions */
const ACCEPT = ".ttf,.otf,.woff,.woff2"

/** CSS font-family name for the untouched original file, shown beside the written font */
const ORIGINAL_FAMILY = "GlyphShaperOriginal"

/** A sample font bundled with the site (both are under the SIL Open Font License; the licence files sit beside them) */
type Sample = { id: string; label: string; url: string; note: string }

/** Sample fonts offered in the demo: a hinted static font with kerning and ligatures, and a variable font */
const SAMPLES: Sample[] = [
	{ id: "ptserif", label: "PT Serif", url: "/fonts/PTSerif-Regular.ttf", note: "static, hinted" },
	{ id: "robotoflex", label: "Roboto Flex", url: "/fonts/RobotoFlex-VF.ttf", note: "variable, 1.8 MB" },
]

/** Specimen line with pairs that kern (A V, T o, T y, W A) */
const SPEC_KERN = "AVAVAV To Ty WA"

/** Specimen line with letters that form ligatures (ffi, fl, ffl) */
const SPEC_LIGA = "ffi fl ffl office"

/** Two editorial paragraphs shown in the demo */
const PARA_1 = "Every typeface carries the fingerprints of its maker — the exact weight a stroke achieves before it stops, the angle at which a curve resolves, the precise distance between letters that lets the eye rest. These decisions accumulate invisibly. A good font is one where the reader never notices the design, only the words."
const PARA_2 = "Sphinx of black quartz, judge my vow. The quick brown fox jumps over the lazy dog, and somewhere in that familiar sentence, the full alphabet completes itself. Five boxing wizards jump quickly; pack my box with five dozen liquor jugs."

/** Every unique character in the specimen lines and both paragraphs — snapshotted at parse time */
const ALL_DEMO_TEXT = SPEC_KERN + SPEC_LIGA + PARA_1 + PARA_2

/** Letters offered as one-click edit targets under the specimen */
const SPEC_CHARS = ["A", "V", "T", "o", "f", "i"]

/** Font size (CSS px) of the hidden probes that measure kerning and ligatures */
const PROBE_PX = 200

/** Maximum font file size accepted before sending to the WOFF2 decompression endpoint (10 MB) */
const MAX_WOFF2_BYTES = 10 * 1024 * 1024

/** Server-side WOFF2 decompressor — keeps wawoff2 out of the browser bundle */
async function decompressWoff2(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	if (buffer.byteLength > MAX_WOFF2_BYTES) {
		throw new Error(`WOFF2 file too large (max ${MAX_WOFF2_BYTES / 1024 / 1024} MB)`)
	}
	const res = await fetch("/api/decompress-woff2", { method: "POST", body: buffer })
	if (!res.ok) throw new Error(`WOFF2 decompression failed (${res.status})`)
	return res.arrayBuffer()
}

/** Loading stages shown in the progress bar */
type LoadStage = "Fetching font" | "Parsing glyphs" | "Applying to page" | null

/** What one write did to the font: shown in the "What this write kept" panel */
type WriteReport = {
	/** The write path that ran */
	method: "patch" | "rebuild"
	/** Milliseconds fontToBlob took */
	ms: number
	/** Glyphs in the font, and how many of them the write re-encoded */
	glyphsTotal: number
	glyphsRewritten: number
	/** Table comparison against the original file (null when the original isn't a plain TTF/OTF) */
	tables: { total: number; kept: string[]; changed: string[]; dropped: string[]; added: string[] } | null
	/** Variable axes in the original, and whether the written font still has them */
	axes: number
	axesKept: boolean
	/** Edited glyphs of a variable font that lost their own variation data (the edit added or removed points) */
	frozen: number
	/** Glyphs built from an edited glyph (accented letters): not rewritten, but they show the edit */
	dependents: number
}

/** Kerning and ligature behaviour measured in the browser for one font family */
type Shaping = {
	/** Kerning between A and V in font units (0 = none) */
	kernAV: number
	/** True if "fi" sets narrower with ligatures on than off */
	ligature: boolean
	/** How much narrower kerning makes the kerning specimen line at 100 CSS px (optical sizing off), in px */
	kernGain: number
}

/** A letter the demo never edits (it isn't in the specimen lines or paragraphs): its pixels show whether a write touched glyphs you left alone */
const UNTOUCHED_CHAR = "H"

/**
 * Measure a family's A–V kerning, its ffi ligature and the kerning line's width with hidden probes. Resolves
 * once the family has loaded. Kerning is width("AV") − width("A") − width("V"), converted to font units.
 */
async function measureShaping(family: string, unitsPerEm: number): Promise<Shaping | null> {
	if (typeof document === "undefined") return null
	try { await document.fonts.load(`${PROBE_PX}px "${family}"`, "AVfi") } catch { return null }
	const host = document.createElement("div")
	host.setAttribute("aria-hidden", "true")
	host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre;"
	document.body.appendChild(host)
	const w = (text: string, css = "") => {
		const el = document.createElement("span")
		el.textContent = text
		el.style.cssText = `font:${PROBE_PX}px "${family}";font-optical-sizing:none;${css}`
		host.appendChild(el)
		return el.getBoundingClientRect().width
	}
	const kernPx = w("AV") - w("A") - w("V")
	const ligature = w("fi", "font-variant-ligatures:none") - w("fi") > 0.5
	const kernGain = Math.round(((w(SPEC_KERN, "font-kerning:none") - w(SPEC_KERN)) / PROBE_PX) * 1000) / 10
	host.remove()
	return { kernAV: Math.round((kernPx / PROBE_PX) * unitsPerEm), ligature, kernGain }
}

/**
 * Draw one letter in two families on a canvas (150 px) and count the pixels whose coverage differs.
 * 0 means the two fonts rasterise that letter identically in this browser. Returns null without a canvas.
 */
async function glyphPixelDiff(familyA: string, familyB: string, ch: string): Promise<number | null> {
	if (typeof document === "undefined") return null
	try { await Promise.all([familyA, familyB].map((f) => document.fonts.load(`150px "${f}"`, ch))) } catch { return null }
	const canvas = document.createElement("canvas")
	canvas.width = 260; canvas.height = 220
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	if (!ctx) return null
	const draw = (family: string) => {
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.font = `150px "${family}"`
		ctx.fillText(ch, 30, 170)
		return ctx.getImageData(0, 0, canvas.width, canvas.height).data
	}
	const a = draw(familyA).slice(), b = draw(familyB)
	let diff = 0
	for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) diff++
	return diff
}

// ─── Adjustments ─────────────────────────────────────────────────────────────

type Adjustments = {
	width: number      // horizontal scale (%) around glyph centre
	leftSide: number   // extra scale for left-half points (%)
	rightSide: number  // extra scale for right-half points (%)
	shoulders: number  // scale Bézier handle offsets from their anchors (%)
}

const ADJ_ZERO: Adjustments = { width: 0, leftSide: 0, rightSide: 0, shoulders: 0 }

type GlyphSnapshot = { cmds: PathCommand[]; cx: number }

function computeCx(cmds: PathCommand[]): number {
	let minX = Infinity, maxX = -Infinity
	for (const cmd of cmds) {
		if ("x"  in cmd) { if (cmd.x  < minX) minX = cmd.x;  if (cmd.x  > maxX) maxX = cmd.x  }
		if ("x1" in cmd) { if (cmd.x1 < minX) minX = cmd.x1; if (cmd.x1 > maxX) maxX = cmd.x1 }
		if ("x2" in cmd) { if (cmd.x2 < minX) minX = cmd.x2; if (cmd.x2 > maxX) maxX = cmd.x2 }
	}
	return minX === Infinity ? 0 : (minX + maxX) / 2
}

function combineAdj(g: Adjustments, c: Adjustments): Adjustments {
	return { width: g.width + c.width, leftSide: g.leftSide + c.leftSide, rightSide: g.rightSide + c.rightSide, shoulders: g.shoulders + c.shoulders }
}

function isZeroAdj(a: Adjustments): boolean {
	return a.width === 0 && a.leftSide === 0 && a.rightSide === 0 && a.shoulders === 0
}

function adjX(x: number, cx: number, width: number, leftSide: number, rightSide: number): number {
	let nx = cx + (x - cx) * (1 + width / 100)
	const d = nx - cx
	if      (d < 0) nx = cx + d * (1 + leftSide  / 100)
	else if (d > 0) nx = cx + d * (1 + rightSide / 100)
	return nx
}

/**
 * Reshape an outline with the slider adjustments. In a TrueType outline, a curve's end point that sits exactly
 * midway between two control points isn't stored in the font: it is implied. Those ends are put back midway
 * between the moved control points, so the reshaped glyph has the same points as the original (only moved),
 * and a variable font's variation data still fits it.
 */
function applyTransform(cmds: PathCommand[], cx: number, adj: Adjustments): PathCommand[] {
	const { width, leftSide, rightSide, shoulders } = adj
	const tx = (x: number) => adjX(x, cx, width, leftSide, rightSide)
	let px = 0, py = 0
	const out = cmds.map((cmd): PathCommand => {
		if (cmd.type === "Z") return { type: "Z" }
		if (cmd.type === "M") { const nx = tx(cmd.x); px = nx; py = cmd.y; return { type: "M", x: nx, y: cmd.y } }
		if (cmd.type === "L") { const nx = tx(cmd.x); px = nx; py = cmd.y; return { type: "L", x: nx, y: cmd.y } }
		if (cmd.type === "Q") {
			const nx  = tx(cmd.x)
			const nx1 = px + (tx(cmd.x1) - px) * (1 + shoulders / 100)
			const ny1 = py + (cmd.y1 - py)     * (1 + shoulders / 100)
			px = nx; py = cmd.y
			return { type: "Q", x1: nx1, y1: ny1, x: nx, y: cmd.y }
		}
		if (cmd.type === "C") {
			const nx  = tx(cmd.x)
			const nx1 = px + (tx(cmd.x1) - px) * (1 + shoulders / 100)
			const ny1 = py + (cmd.y1 - py)     * (1 + shoulders / 100)
			const nx2 = nx + (tx(cmd.x2) - nx) * (1 + shoulders / 100)
			const ny2 = cmd.y + (cmd.y2 - cmd.y) * (1 + shoulders / 100)
			px = nx; py = cmd.y
			return { type: "C", x1: nx1, y1: ny1, x2: nx2, y2: ny2, x: nx, y: cmd.y }
		}
		return cmd as PathCommand
	})

	// Put implied curve ends back midway between their (moved) control points, contour by contour.
	let start = 0
	for (let i = 0; i <= cmds.length; i++) {
		if (i < cmds.length && cmds[i].type !== "Z") continue
		const first = cmds[start]?.type === "M" ? start + 1 : start
		const n = i - first
		for (let k = 0; k < n; k++) {
			const a = cmds[first + k], b = cmds[first + ((k + 1) % n)]
			if (a.type !== "Q" || b.type !== "Q") continue
			if (Math.abs(a.x - (a.x1 + b.x1) / 2) > 1e-6 || Math.abs(a.y - (a.y1 + b.y1) / 2) > 1e-6) continue
			const oa = out[first + k], ob = out[first + ((k + 1) % n)]
			if (oa.type !== "Q" || ob.type !== "Q") continue
			oa.x = (oa.x1 + ob.x1) / 2
			oa.y = (oa.y1 + ob.y1) / 2
			// The contour's start is that same implied point when the curve that ends there is the last one.
			const m = out[start]
			if (k === n - 1 && m.type === "M") { m.x = oa.x; m.y = oa.y }
		}
		start = i + 1
	}
	return out
}

// ─── Slider sub-component ────────────────────────────────────────────────────

function AdjSlider({ label, value, min, max, onChange, title }: {
	label: string; value: number; min: number; max: number; onChange: (v: number) => void; title?: string
}) {
	// Derive a stable id from the label so the <label> htmlFor can reference the <input>
	const id = `adj-${label.toLowerCase().replace(/\s+/g, "-")}`
	return (
		<div className="flex flex-col gap-1">
			<div className="flex justify-between items-baseline">
				<label htmlFor={id} className="text-xs text-muted">{label}</label>
				<span className="text-xs text-subtle font-mono tabular-nums" style={{ minWidth: "2.5rem", textAlign: "right" }}>
					{value > 0 ? `+${value}` : value}
				</span>
			</div>
			<input id={id} type="range" min={min} max={max} step={1} value={value}
				title={title} onChange={e => onChange(Number(e.target.value))} className="w-full" />
		</div>
	)
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

/** Tooltip width: min of 308px or viewport width minus 16px padding */
function getTooltipW(): number {
	return typeof window !== "undefined" ? Math.min(308, window.innerWidth - 16) : 308
}

const APPROX_TOOLTIP_H = 320 // conservative height covering both Adjust and Path tab content

/** Compute initial top-left position anchored to a character's rect */
function getInitialPos(anchor: DOMRect): { left: number; top: number } {
	const GAP     = 12
	const w       = getTooltipW()
	const midX    = anchor.left + anchor.width / 2
	const left    = Math.max(8, Math.min(midX - w / 2, window.innerWidth - w - 8))
	if (anchor.top - GAP - APPROX_TOOLTIP_H >= 8) {
		return { left, top: anchor.top - GAP - APPROX_TOOLTIP_H }
	}
	return { left, top: Math.min(anchor.bottom + GAP, window.innerHeight - APPROX_TOOLTIP_H - 8) }
}

/** Clamp a drag offset so the tooltip stays within the viewport */
function clampOffset(initPos: { left: number; top: number }, offset: { x: number; y: number }, tooltipW: number): { x: number; y: number } {
	const margin  = 8
	const minX    = margin - initPos.left
	const maxX    = window.innerWidth  - tooltipW - margin - initPos.left
	const minY    = margin - initPos.top
	const maxY    = window.innerHeight - APPROX_TOOLTIP_H - margin - initPos.top
	return {
		x: Math.max(minX, Math.min(offset.x, maxX)),
		y: Math.max(minY, Math.min(offset.y, maxY)),
	}
}

function Tooltip({
	char, anchor, font,
	charAdj, onCharAdjChange, onResetCharAdj,
	bezierCmds, onBezierChange, onBezierDragStart,
	bezierHistory, onBezierUndo, onBezierApply, onBezierCancel,
	onClose,
}: {
	char: string
	anchor: DOMRect
	font: GlyphFont
	charAdj: Adjustments
	onCharAdjChange: (key: keyof Adjustments, value: number) => void
	onResetCharAdj: () => void
	bezierCmds: PathCommand[]
	onBezierChange: (cmds: PathCommand[]) => void
	onBezierDragStart: (snapshot: PathCommand[]) => void
	bezierHistory: PathCommand[][]
	onBezierUndo: () => void
	onBezierApply: () => void
	onBezierCancel: () => void
	onClose: () => void
}) {
	const [tab, setTab] = useState<"adjust" | "path">("adjust")

	// ── Dark / light mode ──────────────────────────────────────────────────────
	const dark = useMediaQuery("(prefers-color-scheme: dark)", true)

	// The editor is its own neutral surface (dark or light per OS preference) so glyphs stay legible
	// for editing; only the ACCENT (tabs, anchors, primary action) carries the tool's teal hue.
	// Text/borders use readable neutral tints — NOT --panel (a surface tone, which washed them out).
	const theme = useMemo(() => ({
		bg:          dark ? "rgba(10,10,12,0.97)"     : "rgba(250,250,252,0.97)",
		border:      dark ? "rgba(255,255,255,0.10)"  : "rgba(0,0,0,0.10)",
		divider:     dark ? "rgba(255,255,255,0.07)"  : "rgba(0,0,0,0.07)",
		shadow:      dark ? "0 8px 32px rgba(0,0,0,0.55)" : "0 8px 32px rgba(0,0,0,0.14)",
		text:        dark ? "rgba(245,245,250,0.95)"  : "rgba(15,15,15,0.9)",
		dim:         dark ? "rgba(245,245,250,0.5)"   : "rgba(15,15,15,0.5)",
		accent:      dark ? "oklch(0.80 0.13 198)"    : "oklch(0.42 0.11 198)",
		accentBg:    dark ? "color-mix(in oklch, oklch(0.80 0.13 198) 16%, transparent)"  : "color-mix(in oklch, oklch(0.42 0.11 198) 9%, transparent)",
		tabBorder:   dark ? "rgba(255,255,255,0.16)"  : "rgba(0,0,0,0.14)",
		tabInactive: dark ? "rgba(245,245,250,0.5)"   : "rgba(15,15,15,0.5)",
		btnBorder:   dark ? "rgba(255,255,255,0.22)"  : "rgba(0,0,0,0.2)",
		btnPrimBorder: dark ? "color-mix(in oklch, oklch(0.80 0.13 198) 60%, transparent)" : "color-mix(in oklch, oklch(0.42 0.11 198) 50%, transparent)",
		btnPrimBg:   dark ? "color-mix(in oklch, oklch(0.80 0.13 198) 16%, transparent)"  : "color-mix(in oklch, oklch(0.42 0.11 198) 8%, transparent)",
	}), [dark])

	// ── Drag ──────────────────────────────────────────────────────────────────
	const [initPos]     = useState(() => getInitialPos(anchor))
	const tooltipW      = useMemo(() => getTooltipW(), [])
	const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
	const isDragging    = useRef(false)
	const dragOrigin    = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })

	function onHeaderDown(e: React.PointerEvent<HTMLDivElement>) {
		// Don't drag when clicking a button inside the header
		if ((e.target as HTMLElement).closest("button")) return
		isDragging.current = true
		dragOrigin.current = { mx: e.clientX, my: e.clientY, ox: dragOffset.x, oy: dragOffset.y }
		e.currentTarget.setPointerCapture(e.pointerId)
		document.body.style.cursor = "grabbing"
		document.body.style.userSelect = "none"
	}

	function onHeaderMove(e: React.PointerEvent<HTMLDivElement>) {
		if (!isDragging.current) return
		const raw = {
			x: dragOrigin.current.ox + e.clientX - dragOrigin.current.mx,
			y: dragOrigin.current.oy + e.clientY - dragOrigin.current.my,
		}
		setDragOffset(clampOffset(initPos, raw, tooltipW))
	}

	function onHeaderUp() {
		if (!isDragging.current) return
		isDragging.current = false
		document.body.style.cursor = ""
		document.body.style.userSelect = ""
	}

	// Keyboard repositioning — arrow keys move the tooltip 10px per press
	function onHeaderKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
		const STEP = 10
		let dx = 0, dy = 0
		if (e.key === "ArrowLeft")  { dx = -STEP; e.preventDefault() }
		if (e.key === "ArrowRight") { dx =  STEP; e.preventDefault() }
		if (e.key === "ArrowUp")    { dy = -STEP; e.preventDefault() }
		if (e.key === "ArrowDown")  { dy =  STEP; e.preventDefault() }
		if (dx !== 0 || dy !== 0) {
			setDragOffset(prev => clampOffset(initPos, { x: prev.x + dx, y: prev.y + dy }, tooltipW))
		}
	}

	const left = initPos.left + dragOffset.x
	const top  = initPos.top  + dragOffset.y

	// ── Keyboard shortcuts ────────────────────────────────────────────────────
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
				return
			}
			if (tab === "path" && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
				e.preventDefault()
				onBezierUndo()
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [tab, onBezierUndo, onClose])

	// Clean up body cursor if tooltip unmounts while dragging
	useEffect(() => () => {
		document.body.style.cursor = ""
		document.body.style.userSelect = ""
	}, [])

	const canUndo = bezierHistory.length > 0

	const btn = useCallback((primary: boolean, disabled = false): React.CSSProperties => ({
		fontSize: 11, padding: "4px 10px", borderRadius: 20,
		border: primary ? `1px solid ${theme.btnPrimBorder}` : `1px solid ${theme.btnBorder}`,
		background: primary ? theme.btnPrimBg : "transparent",
		color: theme.text,
		opacity: disabled ? 0.25 : 1,
		cursor: disabled ? "default" : "pointer",
		transition: "opacity 0.12s",
	}), [theme])

	return (
		<div
			role="dialog"
			aria-label={`Glyph editor for "${char}"`}
			aria-modal="true"
			style={{
				position: "fixed", left, top, width: tooltipW, zIndex: 200,
				background: theme.bg,
				border: `1px solid ${theme.border}`,
				borderRadius: 10,
				boxShadow: theme.shadow,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				color: theme.text,
			}}
		>
			{/* Draggable header — arrow keys reposition the panel, Escape closes it */}
			<div
				tabIndex={0}
				aria-label="Drag to reposition glyph editor. Use arrow keys to move with keyboard."
				onPointerDown={onHeaderDown}
				onPointerMove={onHeaderMove}
				onPointerUp={onHeaderUp}
				onKeyDown={onHeaderKeyDown}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "10px 14px",
					borderBottom: `1px solid ${theme.divider}`,
					cursor: "grab",
					userSelect: "none",
				}}
			>
				<span style={{ fontFamily: DEMO_FAMILY, fontSize: 18, lineHeight: 1, color: theme.accent, minWidth: 20 }}>
					{char}
				</span>
				<div role="tablist" aria-label="Glyph editor tabs" style={{ display: "flex", gap: 4, flex: 1 }}>
					{(["adjust", "path"] as const).map(t => (
						<button
							key={t}
							role="tab"
							aria-selected={tab === t}
							aria-controls={`tab-panel-${t}`}
							onClick={() => setTab(t)}
							title={t === "adjust" ? "Reshape this glyph using width and stroke-thickness sliders" : "Edit the raw Bézier path points and handles for this glyph"}
							style={{
								fontSize: 11, padding: "3px 10px", borderRadius: 20,
								border: `1px solid ${tab === t ? theme.accent : theme.tabBorder}`,
								background: tab === t ? theme.accentBg : "transparent",
								color: tab === t ? theme.accent : theme.tabInactive,
								cursor: "pointer",
								transition: "background 0.12s, color 0.12s",
								textTransform: "capitalize",
							}}
						>
							{t}
						</button>
					))}
				</div>
				<button
					onClick={onClose}
					aria-label="Close glyph editor"
					title="Close this glyph editor and deselect the character"
					style={{
						fontSize: 16, lineHeight: 1,
						color: theme.dim, cursor: "pointer",
						background: "transparent", border: "none",
						padding: "2px 4px",
					}}
				>
					×
				</button>
			</div>

			{/* Adjust tab */}
			{tab === "adjust" && (
				<div id="tab-panel-adjust" role="tabpanel" aria-label="Adjust tab" style={{ padding: "14px 14px 12px" }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						<AdjSlider label="Width"           value={charAdj.width}     min={-50} max={100} onChange={v => onCharAdjChange("width",     v)} title="Scale this glyph horizontally around its centre — positive values widen it, negative values condense it" />
						<AdjSlider label="Shoulders"       value={charAdj.shoulders} min={-80} max={100} onChange={v => onCharAdjChange("shoulders", v)} title="Stretch or compress the Bézier handle offsets — higher values add more curve tension and roundness to this glyph's strokes" />
						<AdjSlider label="Left thickness"  value={charAdj.leftSide}  min={-50} max={100} onChange={v => onCharAdjChange("leftSide",  v)} title="Thicken or thin the left half of this glyph's strokes independently of the right side" />
						<AdjSlider label="Right thickness" value={charAdj.rightSide} min={-50} max={100} onChange={v => onCharAdjChange("rightSide", v)} title="Thicken or thin the right half of this glyph's strokes independently of the left side" />
					</div>
					<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
						<button
							onClick={onResetCharAdj}
							aria-label={`Reset per-character adjustments for "${char}"`}
							title="Remove all per-character adjustments and restore this glyph to the global slider values"
							style={{ fontSize: 11, color: theme.dim, cursor: "pointer", background: "transparent", border: "none" }}
						>
							Reset
						</button>
					</div>
				</div>
			)}

			{/* Path tab */}
			{tab === "path" && (
				<div id="tab-panel-path" role="tabpanel" aria-label="Path tab">
					<div style={{ padding: "6px 10px 0" }}>
						<p style={{ fontSize: 10, color: theme.dim, fontFamily: "sans-serif" }}>
							Drag filled circles (anchors) or outlined (handles) to reshape
						</p>
					</div>
					<GlyphSvgEditor
						commands={bezierCmds}
						font={font}
						char={char}
						onChange={onBezierChange}
						onDragStart={onBezierDragStart}
					/>
					<div style={{ display: "flex", gap: 6, padding: "8px 10px 10px", borderTop: `1px solid ${theme.divider}` }}>
						<button onClick={onBezierCancel} title="Discard all unsaved path edits and revert to the last applied state" style={btn(false)}>Cancel</button>
						<button onClick={onBezierUndo} disabled={!canUndo} title="Undo the last path point or handle drag (Cmd/Ctrl+Z)" style={btn(false, !canUndo)}>Undo</button>
						<button onClick={onBezierApply} title="Bake these path edits into the glyph and update the live text on the page" style={{ ...btn(true), marginLeft: "auto" }}>Apply to page</button>
					</div>
				</div>
			)}
		</div>
	)
}

// ─── Clickable text ───────────────────────────────────────────────────────────

const ClickableText = memo(function ClickableText({ text, selectedChar, onSelect, style }: {
	text: string
	selectedChar: string | null
	onSelect: (ch: string | null, rect: DOMRect) => void
	style?: React.CSSProperties
}) {
	return (
		<span style={style}>
			{text.split("").map((ch, i) => {
				if (ch === " ") return <span key={i} aria-hidden="true">{" "}</span>
				const isSelected = selectedChar === ch
				return (
					<span
						key={i}
						role="button"
						tabIndex={0}
						aria-label={`Select character ${ch}`}
						aria-pressed={isSelected}
						onClick={e => {
							const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
							onSelect(isSelected ? null : ch, rect)
						}}
						onKeyDown={e => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
								onSelect(isSelected ? null : ch, rect)
							}
						}}
						style={{
							cursor: "pointer",
							borderBottom: isSelected ? "1px solid color-mix(in oklch, var(--foreground) 70%, transparent)" : "1px solid transparent",
							color: isSelected ? "var(--foreground)" : "inherit",
							transition: "color 0.1s, border-color 0.1s",
						}}
					>
						{ch}
					</span>
				)
			})}
		</span>
	)
})

/** Write the font with one path and time it (milliseconds, from performance.now) */
function timedWrite(f: GlyphFont, write: "patch" | "rebuild"): { blob: Blob; ms: number } {
	const t0 = performance.now()
	const blob = fontToBlob(f, { write })
	return { blob, ms: performance.now() - t0 }
}

// ─── Write report ─────────────────────────────────────────────────────────────

/** How a report row reads: good news, bad news, a caveat, or nothing to judge */
type Mark = "yes" | "no" | "warn" | "na"

/** The glyph shown beside each kind of mark */
const MARK_GLYPH: Record<Mark, string> = { yes: "✓", no: "✕", warn: "!", na: "–" }

/** One row of the "What this write kept" list: a label, the result, and how it reads */
function ReportRow({ label, value, mark }: { label: string; value: string; mark: Mark }) {
	return (
		<div className="flex items-baseline justify-between gap-4 py-2 border-b border-foreground/10">
			<dt className="text-xs uppercase tracking-[0.18em] text-muted min-w-0">{label}</dt>
			<dd className="text-sm text-right font-mono tabular-nums shrink-0" data-mark={mark}>
				<span aria-hidden="true" style={{ marginRight: 8, opacity: mark === "na" ? 0.4 : 1 }}>{MARK_GLYPH[mark]}</span>
				{value}
			</dd>
		</div>
	)
}

/** What each table a write can touch holds, in plain words */
const TABLE_WORDS: Record<string, string> = {
	glyf: "the outlines", loca: "the outlines’ index", hmtx: "letter widths", head: "the file header, which holds a checksum of the whole file", hhea: "the widest-letter record",
	maxp: "size limits", gvar: "variation data", DSIG: "a signature that no longer matches the edited file",
	hdmx: "a per-size width cache, stale once a width changes", LTSH: "a per-size width cache, stale once a width changes",
}

/** "glyf (the outlines), loca (…)" for a list of table tags */
function describeTables(tags: string[]): string {
	return tags.map((t) => TABLE_WORDS[t] ? `${t.trim()} (${TABLE_WORDS[t]})` : t.trim()).join(", ")
}

/** The state of a group of tables after the write: every one identical, some changed, or gone */
function groupState(t: NonNullable<WriteReport["tables"]>, tags: string[]): "none" | "identical" | "changed" | "removed" {
	const had = tags.filter((x) => t.kept.includes(x) || t.changed.includes(x) || t.dropped.includes(x))
	if (had.length === 0) return "none"
	if (had.every((x) => t.kept.includes(x))) return "identical"
	if (had.every((x) => t.dropped.includes(x))) return "removed"
	return "changed"
}

/** The panel that says what the last write did: glyphs rewritten, kerning, ligatures, axes, an untouched letter, and the tables behind them */
function WriteReportPanel({ report, original, written, untouchedDiff }: { report: WriteReport; original: Shaping | null; written: Shaping | null; untouchedDiff: number | null }) {
	const t = report.tables
	const n = (v: number) => v.toLocaleString("en-US")
	const group = (tags: string[]): { value: string; mark: Mark } => {
		if (!t) return { value: "not compared", mark: "na" }
		const st = groupState(t, tags)
		if (st === "none") return { value: "none in this font", mark: "na" }
		if (st === "identical") return { value: "identical", mark: "yes" }
		return { value: st === "removed" ? "removed" : "rewritten", mark: "no" }
	}
	const layout = group(["GSUB", "GPOS", "kern", "GDEF"])
	const hinting = group(["fpgm", "prep", "cvt "])
	const patch = report.method === "patch"
	return (
		<dl data-write-report={report.method} className="rounded-xl px-5 py-3" style={{ background: "var(--panel)" }}>
			<ReportRow
				label="Glyphs rewritten"
				value={`${n(report.glyphsRewritten)} of ${n(report.glyphsTotal)}`}
				mark={report.glyphsRewritten < report.glyphsTotal ? "yes" : "no"}
			/>
			<ReportRow
				label="Kerning, A–V, in font units"
				value={written && original ? `${written.kernAV} (original ${original.kernAV})` : "measuring…"}
				mark={written && original ? (original.kernAV === 0 ? "na" : written.kernAV === original.kernAV ? "yes" : "no") : "na"}
			/>
			<ReportRow
				label="Ligature, fi"
				value={written && original ? (original.ligature ? (written.ligature ? "kept" : "lost") : "none in this font") : "measuring…"}
				mark={written && original ? (original.ligature ? (written.ligature ? "yes" : "no") : "na") : "na"}
			/>
			<ReportRow
				label="Variable axes"
				value={report.axes ? (report.axesKept ? (report.frozen ? `${report.axes} live · ${report.frozen} glyph${report.frozen > 1 ? "s" : ""} frozen` : `${report.axes} live`) : `${report.axes} removed`) : "none in this font"}
				mark={report.axes ? (report.axesKept ? (report.frozen ? "warn" : "yes") : "no") : "na"}
			/>
			<ReportRow
				label={`Untouched letter, ${UNTOUCHED_CHAR}`}
				value={untouchedDiff === null ? "measuring…" : untouchedDiff < 0 ? "not compared" : untouchedDiff === 0 ? "pixel-identical" : `${n(untouchedDiff)} pixels differ`}
				mark={untouchedDiff === null || untouchedDiff < 0 ? "na" : untouchedDiff === 0 ? "yes" : "no"}
			/>
			<ReportRow label="Kerning and ligature tables, byte for byte" value={layout.value} mark={layout.mark} />
			<ReportRow label="Hinting programs, byte for byte" value={hinting.value} mark={hinting.mark} />
			<ReportRow label="Write time" value={`${report.ms < 10 ? report.ms.toFixed(1) : Math.round(report.ms)} ms`} mark="na" />
			{t && (
				<div data-write-notes="" className="text-xs text-muted pt-3 flex flex-col gap-2" style={{ lineHeight: 1.7 }}>
					{t.changed.length === 0 && t.dropped.length === 0
						? <p>Nothing edited yet: the file is the original, byte for byte.</p>
						: <p>{t.kept.length} of {t.total} tables are byte-identical to the original.</p>}
					{t.changed.length > 0 && <p>Rewritten: {describeTables(t.changed)}.</p>}
					{t.dropped.length > 0 && <p>Removed: {describeTables(t.dropped)}.</p>}
					{t.added.length > 0 && <p>Added: {describeTables(t.added)}.</p>}
					{patch && report.dependents > 0 && <p>{report.dependents} other glyph{report.dependents > 1 ? "s are" : " is"} built from {report.glyphsRewritten > 1 ? "the edited glyphs" : "the edited glyph"} (accented letters such as ö from o). {report.dependents > 1 ? "They aren’t" : "It isn’t"} rewritten, but {report.dependents > 1 ? "they show" : "it shows"} the new shape and follow{report.dependents > 1 ? "" : "s"} its new width; accents stay where they were.</p>}
					{patch && report.glyphsRewritten > 0 && hinting.mark === "yes" && <p>The edited glyph loses its own hinting instructions; the font’s hinting programs and every other glyph’s instructions are as they were.</p>}
					{patch && report.frozen > 0 && <p>Frozen: {report.frozen > 1 ? `${report.frozen} edited glyphs` : "one edited glyph"} no longer var{report.frozen > 1 ? "y" : "ies"}. The edit changed the outline’s point structure (a point added or removed, a point the font only implied moved on its own, or a glyph assembled from other glyphs), so the font’s variation data for {report.frozen > 1 ? "those glyphs" : "that glyph"} no longer fits and was removed. {report.frozen > 1 ? "They keep" : "It keeps"} one shape at every weight; every other glyph still varies.</p>}
				</div>
			)}
		</dl>
	)
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

export default function Demo() {
	const [font, setFont]           = useState<GlyphFont | null>(null)
	const [fileName, setFileName]   = useState<string>("")
	// Starts true: the default font load kicks off on mount, so there is no frame
	// where the editor is idle-and-not-loading.
	const [loading, setLoading]     = useState(true)
	const [loadStage, setLoadStage] = useState<LoadStage>(null)
	const [loadPct, setLoadPct]     = useState(0)
	const [error, setError]         = useState<string | null>(null)

	// Write path: patch the edited glyphs (the library's default) or rebuild the whole file with opentype.js
	const [writeMode, setWriteMode] = useState<Exclude<FontWriteMode, "auto">>("patch")
	const writeModeRef = useRef<Exclude<FontWriteMode, "auto">>("patch")
	const [report, setReport]       = useState<WriteReport | null>(null)
	const [origShaping, setOrigShaping]       = useState<Shaping | null>(null)
	const [writtenShaping, setWrittenShaping] = useState<Shaping | null>(null)
	// Pixels of an untouched letter that differ between the original and the written font (null while measuring, -1 when it can't be compared)
	const [untouchedDiff, setUntouchedDiff] = useState<number | null>(null)
	// Weight for variable fonts (font-variation-settings "wght"); null until a variable font is loaded
	const [wght, setWght]           = useState<number | null>(null)
	const [wghtRange, setWghtRange] = useState<{ min: number; max: number; def: number } | null>(null)

	// Selection
	const [selectedChar, setSelectedChar]     = useState<string | null>(null)
	const [anchorRect, setAnchorRect]         = useState<DOMRect | null>(null)

	// Global adjustments
	const [globalAdj, setGlobalAdj] = useState<Adjustments>(ADJ_ZERO)
	// Per-character adjustments
	const [charAdjs, setCharAdjs]   = useState<Map<string, Adjustments>>(new Map())
	// Letters whose outline was changed in the Path tab (for the "edited:" label)
	const [pathEdited, setPathEdited] = useState<string[]>([])

	// Bezier editor state (managed here to avoid font-blob conflicts with GlyphShaperEditor)
	const [bezierCmds, setBezierCmds]         = useState<PathCommand[]>([])
	const [bezierHistory, setBezierHistory]   = useState<PathCommand[][]>([])

	const blobUrlRef  = useRef<string | null>(null)
	const origCmdsRef = useRef<Map<string, GlyphSnapshot>>(new Map())
	/** The outlines as the font shipped them, so Reset all can also undo path edits */
	const pristineRef = useRef<Map<string, GlyphSnapshot>>(new Map())
	const adjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	/** The original file's bytes (for the table comparison) and its FontFace (for the "original" row) */
	const origBytesRef = useRef<ArrayBuffer | null>(null)
	const origFaceRef  = useRef<FontFace | null>(null)
	/** Counts writes, so a slow measurement of an older write can't overwrite a newer one */
	const writeSeqRef  = useRef(0)

	// Load bezier commands from snapshot whenever selection changes.
	// Kept in an effect deliberately: the source of truth is origCmdsRef.current, a mutable
	// snapshot map populated at commit time. Deriving this during render instead would read a
	// ref during render (react-hooks/refs) — a real bug — so the cascading-render warning is
	// the correct trade here. The extra pass only runs when the selected glyph changes.
	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		if (!selectedChar) { setBezierCmds([]); setBezierHistory([]); return }
		const snap = origCmdsRef.current.get(selectedChar)
		setBezierCmds(snap ? snap.cmds.map(c => ({ ...c }) as PathCommand) : (font ? getGlyphCommands(font, selectedChar) : []))
		setBezierHistory([])
	}, [selectedChar, font])
	/* eslint-enable react-hooks/set-state-in-effect */

	/** Snapshot the original outline of every character the demo shows */
	function snapshotFont(f: GlyphFont) {
		const snap = new Map<string, GlyphSnapshot>()
		const seen = new Set<string>()
		for (const ch of ALL_DEMO_TEXT) {
			if (seen.has(ch) || ch === " ") continue
			seen.add(ch)
			const cmds = getGlyphCommands(f, ch)
			if (!cmds.length) continue
			snap.set(ch, { cmds, cx: computeCx(cmds) })
		}
		origCmdsRef.current = snap
		pristineRef.current = new Map(snap)
	}

	/** Write the font with the chosen path, apply it to the page, and report what the write kept */
	function writeFont(f: GlyphFont, mode: Exclude<FontWriteMode, "auto"> = writeModeRef.current) {
		const canPatch = getFontSource(f) !== null
		const { blob, ms } = timedWrite(f, mode === "patch" && canPatch ? "patch" : "rebuild")
		const url = applyFontBlob(DEMO_FAMILY, blob, blobUrlRef.current ?? undefined)
		blobUrlRef.current = url

		const info = getWriteInfo(blob)
		const seq = ++writeSeqRef.current
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ot = (f as any)._font
		const glyphsTotal: number = ot.numGlyphs ?? ot.glyphs?.length ?? 0
		const axes: number = ot.tables?.fvar?.axes?.length ?? 0
		const method = info?.method ?? "rebuild"
		const base: WriteReport = {
			method, ms, glyphsTotal,
			glyphsRewritten: method === "patch" ? (info?.editedGlyphs.length ?? 0) : glyphsTotal,
			tables: null, axes, axesKept: method === "patch", frozen: info?.frozenGlyphs.length ?? 0, dependents: info?.dependentGlyphs.length ?? 0,
		}
		setReport(base)
		setWrittenShaping(null)
		setUntouchedDiff(null)
		const orig = origBytesRef.current
		blob.arrayBuffer().then(async (bytes) => {
			let tables: WriteReport["tables"] = null
			if (orig) {
				try {
					const cmp = compareFontTables(orig, bytes)
					tables = { total: cmp.kept.length + cmp.changed.length + cmp.dropped.length, ...cmp }
				} catch { tables = null }
			}
			const shaping = await measureShaping(DEMO_FAMILY, ot.unitsPerEm ?? 1000)
			const diff = origFaceRef.current ? await glyphPixelDiff(ORIGINAL_FAMILY, DEMO_FAMILY, UNTOUCHED_CHAR) : null
			if (seq !== writeSeqRef.current) return
			setUntouchedDiff(diff ?? -1)
			setReport({ ...base, tables, axesKept: tables ? [...tables.kept, ...tables.changed].includes("fvar") : base.axesKept })
			setWrittenShaping(shaping)
		})
	}

	/** Re-apply every slider adjustment to the snapshot outlines, then write the font */
	function applyAdjs(f: GlyphFont, gAdj: Adjustments, cAdjs: Map<string, Adjustments>) {
		for (const [ch, { cmds, cx }] of origCmdsRef.current) {
			const cAdj = cAdjs.get(ch) ?? ADJ_ZERO
			const eff  = combineAdj(gAdj, cAdj)
			setGlyphCommands(f, ch, isZeroAdj(eff) ? cmds.map(c => ({ ...c }) as PathCommand) : applyTransform(cmds, cx, eff))
		}
		writeFont(f)
	}

	function scheduleApply(f: GlyphFont, gAdj: Adjustments, cAdjs: Map<string, Adjustments>) {
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		adjTimerRef.current = setTimeout(() => applyAdjs(f, gAdj, cAdjs), 60)
	}

	/** Switch the write path and write the current edits again with it */
	function handleWriteMode(mode: Exclude<FontWriteMode, "auto">) {
		writeModeRef.current = mode
		setWriteMode(mode)
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		if (font) {
			try { writeFont(font, mode) } catch (err: unknown) { setError(err instanceof Error ? err.message : "This font could not be written.") }
		}
	}

	function handleGlobalAdjChange(key: keyof Adjustments, value: number) {
		const next = { ...globalAdj, [key]: value }
		setGlobalAdj(next)
		if (font) scheduleApply(font, next, charAdjs)
	}

	function resetGlobalAdj() {
		setGlobalAdj(ADJ_ZERO)
		setCharAdjs(new Map())
		setSelectedChar(null)
		setAnchorRect(null)
		setPathEdited([])
		origCmdsRef.current = new Map(pristineRef.current)
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		if (font) applyAdjs(font, ADJ_ZERO, new Map())
	}

	function handleCharAdjChange(key: keyof Adjustments, value: number) {
		if (!selectedChar || !font) return
		const current = charAdjs.get(selectedChar) ?? ADJ_ZERO
		const next    = { ...current, [key]: value }
		const newMap  = new Map(charAdjs)
		newMap.set(selectedChar, next)
		setCharAdjs(newMap)
		scheduleApply(font, globalAdj, newMap)
	}

	function resetCharAdj() {
		if (!selectedChar || !font) return
		const newMap = new Map(charAdjs)
		newMap.delete(selectedChar)
		setCharAdjs(newMap)
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		applyAdjs(font, globalAdj, newMap)
	}

	function handleBezierDragStart(snapshot: PathCommand[]) {
		setBezierHistory(h => {
			const next = [...h, snapshot]
			return next.length > 50 ? next.slice(-50) : next
		})
	}

	function handleBezierUndo() {
		setBezierHistory(h => {
			if (!h.length) return h
			setBezierCmds(h[h.length - 1])
			return h.slice(0, -1)
		})
	}

	function handleBezierApply() {
		if (!font || !selectedChar) return
		// Bake bezier edits into the snapshot (pre-adjustment)
		const newSnap = new Map(origCmdsRef.current)
		const baked   = bezierCmds.map(c => ({ ...c }) as PathCommand)
		newSnap.set(selectedChar, { cmds: baked, cx: computeCx(baked) })
		origCmdsRef.current = newSnap
		// Re-apply all slider adjustments using the updated snapshot
		applyAdjs(font, globalAdj, charAdjs)
		// Re-load bezier editor from the new snapshot
		setBezierCmds(baked.map(c => ({ ...c }) as PathCommand))
		setBezierHistory([])
		setPathEdited(prev => prev.includes(selectedChar) ? prev : [...prev, selectedChar])
	}

	function handleBezierCancel() {
		// Restore snapshot (discard unsaved bezier changes)
		if (selectedChar) {
			const snap = origCmdsRef.current.get(selectedChar)
			setBezierCmds(snap ? snap.cmds.map(c => ({ ...c }) as PathCommand) : [])
		}
		setBezierHistory([])
	}

	const handleSelect = useCallback((ch: string | null, rect: DOMRect) => {
		setSelectedChar(ch)
		setAnchorRect(ch ? rect : null)
	}, [])

	const closeTooltip = useCallback(() => {
		setSelectedChar(null)
		setAnchorRect(null)
	}, [])

	/**
	 * Take a font file's bytes through the whole pipeline: parse, register the untouched original as its own
	 * family, snapshot the outlines, write with the current path and report. Shared by samples and uploads.
	 */
	const openFont = useCallback(async (buffer: ArrayBuffer, name: string, isCancelled: () => boolean = () => false) => {
		setLoadStage("Parsing glyphs")
		const parsed = await parseFont(buffer, decompressWoff2)
		if (isCancelled()) return

		// The original file, untouched, as its own family for the comparison row.
		if (origFaceRef.current) { document.fonts.delete(origFaceRef.current); origFaceRef.current = null }
		origBytesRef.current = getFontSource(parsed) ?? (new DataView(buffer).getUint32(0) === 0x4f54544f ? buffer.slice(0) : null)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ot = (parsed as any)._font
		const wAxis = (ot.tables?.fvar?.axes ?? []).find((a: { tag: string }) => a.tag === "wght")
		try {
			const face = new FontFace(ORIGINAL_FAMILY, buffer.slice(0), wAxis ? { weight: `${wAxis.minValue} ${wAxis.maxValue}` } : {})
			await face.load()
			if (isCancelled()) return
			document.fonts.add(face)
			origFaceRef.current = face
		} catch { /* the original row falls back to the page font */ }

		setLoadStage("Applying to page")
		setLoadPct(88)
		await new Promise(r => setTimeout(r, 0))
		snapshotFont(parsed)
		setWghtRange(wAxis ? { min: wAxis.minValue, max: wAxis.maxValue, def: wAxis.defaultValue } : null)
		setWght(wAxis ? wAxis.defaultValue : null)
		setOrigShaping(null)
		writeFont(parsed)
		measureShaping(ORIGINAL_FAMILY, ot.unitsPerEm ?? 1000).then((sh) => { if (!isCancelled()) setOrigShaping(sh) })
		setLoadPct(100)
		setFont(parsed)
		setFileName(name)
	// writeFont and snapshotFont only touch refs and state setters, so the callback never goes stale.
	}, [])

	/** Reset the editing state before a different font is opened */
	const resetForNewFont = useCallback(() => {
		setLoading(true)
		setLoadPct(0)
		setError(null)
		setFont(null)
		setReport(null)
		setPathEdited([])
		writeModeRef.current = "patch"
		setWriteMode("patch")
		setSelectedChar(null)
		setAnchorRect(null)
		setGlobalAdj(ADJ_ZERO)
		setCharAdjs(new Map())
	}, [])

	/** Fetch and open one of the bundled sample fonts */
	const loadSample = useCallback(async (sample: Sample, isCancelled: () => boolean = () => false, signal?: AbortSignal) => {
		try {
			setLoadStage("Fetching font")
			setLoadPct(10)
			const res = await fetch(sample.url, { signal })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const buffer = await res.arrayBuffer()
			if (isCancelled()) return
			setLoadPct(45)
			await openFont(buffer, sample.label, isCancelled)
		} catch (err: unknown) {
			if (!isCancelled()) setError(err instanceof Error ? err.message : "Could not load the sample font.")
		} finally {
			if (!isCancelled()) { setLoading(false); setLoadStage(null); setLoadPct(0) }
		}
	}, [openFont])

	// Load the default font on mount
	useEffect(() => {
		let cancelled = false
		const abortController = new AbortController()
		// Kicking off the fetch is the effect; its progress updates are the state changes the lint rule sees.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		loadSample(SAMPLES[0], () => cancelled, abortController.signal)
		return () => {
			cancelled = true
			abortController.abort()
			if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
			if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
			if (origFaceRef.current) { document.fonts.delete(origFaceRef.current); origFaceRef.current = null }
		}
	}, [loadSample])

	const handleSample = useCallback((sample: Sample) => {
		resetForNewFont()
		loadSample(sample)
	}, [resetForNewFont, loadSample])

	const handleFile = useCallback(async (file: File) => {
		resetForNewFont()
		try {
			setLoadPct(30)
			const buffer = await file.arrayBuffer()
			setLoadPct(55)
			await openFont(buffer, file.name)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Could not parse this font file.")
		} finally {
			setLoading(false); setLoadStage(null); setLoadPct(0)
		}
	}, [resetForNewFont, openFont])

	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) handleFile(file)
		e.target.value = ""
	}, [handleFile])

	const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		const file = e.dataTransfer.files[0]
		if (file) handleFile(file)
	}, [handleFile])

	const charAdj = selectedChar ? (charAdjs.get(selectedChar) ?? ADJ_ZERO) : ADJ_ZERO
	const variation = wght !== null ? { fontVariationSettings: `"wght" ${wght}` } : {}
	const textStyle: React.CSSProperties = { fontFamily: DEMO_FAMILY, fontSize: "1.125rem", lineHeight: "1.8", ...variation }
	const specStyle: React.CSSProperties = { fontSize: "clamp(1.5rem, 4.6vw, 2.75rem)", lineHeight: 1.25, whiteSpace: "nowrap", ...variation }
	const canPatch = font ? getFontSource(font) !== null : true
	const isSample = SAMPLES.some((s) => s.label === fileName)

	const [isDragOver, setIsDragOver] = useState(false)

	return (
		<div className="w-full">

			{/* Font source: samples or an upload */}
			<div
				onDrop={e => { setIsDragOver(false); handleDrop(e) }}
				onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
				onDragEnter={() => setIsDragOver(true)}
				onDragLeave={() => setIsDragOver(false)}
				aria-label="Font file drop zone — drag a TTF, OTF, WOFF, or WOFF2 font file here"
				className={`flex flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed py-5 px-6 text-center transition-colors mb-6 ${isDragOver ? "border-foreground/60 bg-foreground/5" : "border-foreground/20 hover:border-foreground/40"}`}
			>
				<p className="text-xs uppercase tracking-[0.18em] font-medium text-muted w-full sm:w-auto">
					{loading ? (loadStage ?? "Loading…") : "Font"}
				</p>
				{SAMPLES.map((s) => (
					<button
						key={s.id}
						onClick={() => handleSample(s)}
						disabled={loading}
						aria-pressed={fileName === s.label}
						title={`Load ${s.label} (${s.note}), an open-source font bundled with this page`}
						className={`text-xs px-4 py-2 rounded-full border transition-colors ${fileName === s.label ? "border-foreground/70 bg-foreground/10" : "border-foreground/30 hover:bg-foreground/5"}`}
					>
						{s.label} <span className="text-muted">· {s.note}</span>
					</button>
				))}
				<label title="Upload a TTF, OTF, WOFF, or WOFF2 file to replace the current demo font" className={`text-xs px-4 py-2 rounded-full border cursor-pointer transition-colors ${fileName && !isSample ? "border-foreground/70 bg-foreground/10" : "border-foreground/30 hover:bg-foreground/5"}`}>
					{fileName && !isSample ? fileName : "Your font…"}
					<input type="file" accept={ACCEPT} onChange={handleInputChange} className="sr-only" aria-label="Upload a font file (TTF, OTF, WOFF, or WOFF2)" title="Upload a TTF, OTF, WOFF, or WOFF2 font file to use in the demo" />
				</label>
			</div>

			{error && <p role="alert" aria-live="assertive" className="text-xs text-red-400 opacity-80 mb-6">{error}</p>}

			{/* Loading progress */}
			{loading && (
				<div className="rounded-xl px-6 py-8 flex flex-col gap-4 mb-6" style={{ background: "var(--panel)" }}>
					<div className="flex items-center justify-between">
						<p className="text-xs text-muted tracking-widest uppercase">{loadStage ?? "Loading…"}</p>
						<p className="text-xs text-subtle font-mono tabular-nums">{loadPct}%</p>
					</div>
					<div className="w-full h-px rounded-full overflow-hidden" style={{ background: "color-mix(in oklch, var(--foreground) 8%, transparent)" }}>
						<div
							role="progressbar"
							aria-valuenow={loadPct}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label={`Loading font: ${loadPct}%`}
							className="h-full rounded-full transition-all duration-300"
							style={{ width: `${loadPct}%`, background: "var(--panel)" }}
						/>
					</div>
				</div>
			)}

			{font && !loading && (
				<>
					{/* Write path */}
					<div className="flex flex-wrap items-center gap-3 mb-5">
						<p id="write-path-label" className="text-xs uppercase tracking-[0.18em] font-medium text-muted">When you edit, write back</p>
						<div role="radiogroup" aria-labelledby="write-path-label" className="flex flex-wrap gap-2">
							{([["patch", "Only the edited glyph"], ["rebuild", "The whole font, rebuilt"]] as const).map(([mode, label]) => {
								const disabled = mode === "patch" && !canPatch
								return (
									<button
										key={mode}
										role="radio"
										aria-checked={writeMode === mode && !disabled}
										data-write-mode={mode}
										disabled={disabled}
										onClick={() => handleWriteMode(mode)}
										title={mode === "patch"
											? "Re-encode only the glyphs you edited and copy every other table byte-for-byte (the library's default for TrueType fonts)"
											: "Re-create the whole file with opentype.js, the way glyphShaper wrote up to version 1.1.0. opentype.js can't write kerning, hinting or variable-font tables; glyphShaper also left out the ligature table, because opentype.js can't write every kind of substitution"}
										className={`text-xs px-4 py-2 rounded-full border transition-colors ${(writeMode === mode && !disabled) || (mode === "rebuild" && !canPatch) ? "border-foreground/70 bg-foreground/10" : "border-foreground/30 hover:bg-foreground/5"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
									>
										{label}
									</button>
								)
							})}
						</div>
						{!canPatch && <p className="text-xs text-muted">This font has CFF outlines, so it can only be rebuilt.</p>}
					</div>

					{/* Specimen: the original file above the written font */}
					<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] mb-8">
						<div className="flex flex-col gap-4 min-w-0 overflow-x-auto pb-1">
							<div>
								<p className="text-xs uppercase tracking-[0.18em] text-muted mb-1">Original file{origShaping && <span className="normal-case tracking-normal" data-line="original"> · kerning tightens the top line by {origShaping.kernGain.toFixed(1)} px (at 100 px)</span>}</p>
								<p aria-hidden="true" data-spec="original" style={{ ...specStyle, fontFamily: ORIGINAL_FAMILY }} className="text-muted">
									{SPEC_KERN}<br />{SPEC_LIGA}
								</p>
							</div>
							<div>
								<p className="text-xs uppercase tracking-[0.18em] text-muted mb-1">After the write{writtenShaping && <span className="normal-case tracking-normal" data-line="written"> · kerning tightens the top line by {writtenShaping.kernGain.toFixed(1)} px (at 100 px)</span>}</p>
								{/* One text node per line, so the browser kerns and forms ligatures exactly as it would in running text */}
								<p data-spec="written" style={{ ...specStyle, fontFamily: DEMO_FAMILY }}>
									{SPEC_KERN}<br />{SPEC_LIGA}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<p className="text-xs uppercase tracking-[0.18em] text-muted mr-1">Edit a letter</p>
								{SPEC_CHARS.map((ch) => (
									<button
										key={ch}
										data-edit-char={ch}
										aria-label={`Edit the letter ${ch}`}
										aria-pressed={selectedChar === ch}
										title={`Open the editor for "${ch}"`}
										onClick={e => handleSelect(selectedChar === ch ? null : ch, e.currentTarget.getBoundingClientRect())}
										className={`w-9 h-9 rounded-full border text-base transition-colors ${selectedChar === ch ? "border-foreground/70 bg-foreground/10" : "border-foreground/30 hover:bg-foreground/5"}`}
										style={{ fontFamily: DEMO_FAMILY }}
									>
										{ch}
									</button>
								))}
								{(charAdjs.size > 0 || pathEdited.length > 0) && <span className="text-xs text-muted">edited: {Array.from(new Set([...charAdjs.keys(), ...pathEdited])).join(" ")}</span>}
							</div>
						</div>
						<div>
							<p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">What this write kept</p>
							{report && <WriteReportPanel report={report} original={origShaping} written={writtenShaping} untouchedDiff={untouchedDiff} />}
						</div>
					</div>

					{/* Weight, for variable fonts: proof that the axes survived */}
					{wghtRange && wght !== null && (
						<div className="mb-8 max-w-md">
							<div className="flex justify-between items-baseline">
								<label htmlFor="demo-wght" className="text-xs text-muted">Weight axis (wght)</label>
								<span className="text-xs text-subtle font-mono tabular-nums">{Math.round(wght)}</span>
							</div>
							<input id="demo-wght" type="range" min={wghtRange.min} max={wghtRange.max} step={1} value={wght}
								aria-label="Weight axis of the variable font"
								title="Move the weight axis: a patched font still responds, a rebuilt one is frozen at one weight"
								onChange={e => setWght(Number(e.target.value))} className="w-full" />
						</div>
					)}

					{/* Global adjustment sliders */}
					<p className="text-xs uppercase tracking-[0.18em] text-muted mb-3">Or reshape every letter used on this page at once</p>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
						<AdjSlider label="Width"           value={globalAdj.width}     min={-50} max={100} onChange={v => handleGlobalAdjChange("width",     v)} title="Scale every glyph horizontally around its centre — positive values widen all characters, negative values condense them" />
						<AdjSlider label="Shoulders"       value={globalAdj.shoulders} min={-80} max={100} onChange={v => handleGlobalAdjChange("shoulders", v)} title="Globally stretch or compress Bézier handle distances — higher values make all curves rounder and more swollen" />
						<AdjSlider label="Left thickness"  value={globalAdj.leftSide}  min={-50} max={100} onChange={v => handleGlobalAdjChange("leftSide",  v)} title="Globally thicken or thin the left-side strokes of every glyph" />
						<AdjSlider label="Right thickness" value={globalAdj.rightSide} min={-50} max={100} onChange={v => handleGlobalAdjChange("rightSide", v)} title="Globally thicken or thin the right-side strokes of every glyph" />
					</div>

					{/* Two editorial paragraphs */}
					<div className="flex flex-col gap-6 relative pb-2">
						<ClickableText text={PARA_1} selectedChar={selectedChar} onSelect={handleSelect} style={textStyle} />
						<ClickableText text={PARA_2} selectedChar={selectedChar} onSelect={handleSelect} style={textStyle} />
					</div>

					{/* Reset */}
					<div className="flex justify-end mt-4">
						<button onClick={resetGlobalAdj} aria-label="Reset every adjustment and restore every glyph to its original shape" title="Clear the global and per-letter slider adjustments and restore every glyph to its original shape" className="text-xs text-muted hover:text-foreground transition-colors">
							Reset all
						</button>
					</div>
				</>
			)}

			{/* Caption */}
			{!loading && (
				<p className="text-xs text-muted italic mt-6" style={{ lineHeight: "1.8" }}>
					{font
						? "Click any letter to reshape it, then switch the write path. Kerning, the ligature and the untouched letter are measured in your browser after every write; the table lines compare the written file with the original, byte for byte. Limits of writing back one glyph: a ligature that is a glyph of its own (PT Serif’s fi) doesn’t pick up an edited f, though one assembled from the letter does; the kerning and the variation data that are kept are the original’s, made for the original shapes; and a font with CFF outlines can only be rebuilt."
						: "PT Serif loads by default — swap it for Roboto Flex or any TTF, OTF, WOFF, or WOFF2 above."
					}
				</p>
			)}

			{/* Floating tooltip — rendered in a portal via fixed position */}
			{selectedChar && anchorRect && font && (
				<Tooltip
					key={selectedChar}
					char={selectedChar}
					anchor={anchorRect}
					font={font}
					charAdj={charAdj}
					onCharAdjChange={handleCharAdjChange}
					onResetCharAdj={resetCharAdj}
					bezierCmds={bezierCmds}
					onBezierChange={setBezierCmds}
					onBezierDragStart={handleBezierDragStart}
					bezierHistory={bezierHistory}
					onBezierUndo={handleBezierUndo}
					onBezierApply={handleBezierApply}
					onBezierCancel={handleBezierCancel}
					onClose={closeTooltip}
				/>
			)}
		</div>
	)
}
