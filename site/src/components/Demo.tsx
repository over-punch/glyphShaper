"use client"

// Interactive demo — loads Inter by default; file upload replaces it
import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react"
import { useMediaQuery } from "@/lib/clientValue"
import {
	parseFont, applyFontBlob, fontToBlob,
	getGlyphCommands, setGlyphCommands,
	GlyphSvgEditor,
} from "@liiift-studio/glyphshaper"
import type { GlyphFont, PathCommand } from "@liiift-studio/glyphshaper"

/** CSS font-family name used for the demo override rule */
const DEMO_FAMILY = "GlyphShaperDemo"

/** Accepted font file extensions */
const ACCEPT = ".ttf,.otf,.woff,.woff2"

/** URL of the default font bundled with the site */
const DEFAULT_FONT_URL = "/fonts/inter-300.woff"

/** Display name shown in the upload zone for the default font */
const DEFAULT_FONT_NAME = "Inter"

/** Two editorial paragraphs shown in the demo */
const PARA_1 = "Every typeface carries the fingerprints of its maker — the exact weight a stroke achieves before it stops, the angle at which a curve resolves, the precise distance between letters that lets the eye rest. These decisions accumulate invisibly. A good font is one where the reader never notices the design, only the words."
const PARA_2 = "Sphinx of black quartz, judge my vow. The quick brown fox jumps over the lazy dog, and somewhere in that familiar sentence, the full alphabet completes itself. Five boxing wizards jump quickly; pack my box with five dozen liquor jugs."

/** Every unique character across both paragraphs — snapshotted at parse time */
const ALL_DEMO_TEXT = PARA_1 + PARA_2

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

function applyTransform(cmds: PathCommand[], cx: number, adj: Adjustments): PathCommand[] {
	const { width, leftSide, rightSide, shoulders } = adj
	const tx = (x: number) => adjX(x, cx, width, leftSide, rightSide)
	let px = 0, py = 0
	return cmds.map(cmd => {
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

	// Selection
	const [selectedChar, setSelectedChar]     = useState<string | null>(null)
	const [anchorRect, setAnchorRect]         = useState<DOMRect | null>(null)

	// Global adjustments
	const [globalAdj, setGlobalAdj] = useState<Adjustments>(ADJ_ZERO)
	// Per-character adjustments
	const [charAdjs, setCharAdjs]   = useState<Map<string, Adjustments>>(new Map())

	// Bezier editor state (managed here to avoid font-blob conflicts with GlyphShaperEditor)
	const [bezierCmds, setBezierCmds]         = useState<PathCommand[]>([])
	const [bezierHistory, setBezierHistory]   = useState<PathCommand[][]>([])

	const blobUrlRef  = useRef<string | null>(null)
	const origCmdsRef = useRef<Map<string, GlyphSnapshot>>(new Map())
	const adjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
	}

	function applyAdjs(f: GlyphFont, gAdj: Adjustments, cAdjs: Map<string, Adjustments>) {
		for (const [ch, { cmds, cx }] of origCmdsRef.current) {
			const cAdj = cAdjs.get(ch) ?? ADJ_ZERO
			const eff  = combineAdj(gAdj, cAdj)
			setGlyphCommands(f, ch, isZeroAdj(eff) ? cmds.map(c => ({ ...c }) as PathCommand) : applyTransform(cmds, cx, eff))
		}
		const blob = fontToBlob(f)
		const url  = applyFontBlob(DEMO_FAMILY, blob, blobUrlRef.current ?? undefined)
		blobUrlRef.current = url
	}

	function scheduleApply(f: GlyphFont, gAdj: Adjustments, cAdjs: Map<string, Adjustments>) {
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		adjTimerRef.current = setTimeout(() => applyAdjs(f, gAdj, cAdjs), 60)
	}

	function handleGlobalAdjChange(key: keyof Adjustments, value: number) {
		const next = { ...globalAdj, [key]: value }
		setGlobalAdj(next)
		if (font) scheduleApply(font, next, charAdjs)
	}

	function resetGlobalAdj() {
		setGlobalAdj(ADJ_ZERO)
		if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		if (font) applyAdjs(font, ADJ_ZERO, charAdjs)
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

	// Load the default font on mount
	useEffect(() => {
		let cancelled = false
		const abortController = new AbortController()

		async function loadDefault() {
			try {
				setLoadStage("Fetching font")
				const res = await fetch(DEFAULT_FONT_URL, { signal: abortController.signal })
				if (!res.ok) throw new Error(`HTTP ${res.status}`)

				const contentLength = Number(res.headers.get("content-length") ?? 0)
				let buffer: ArrayBuffer

				if (contentLength > 0 && res.body) {
					const reader = res.body.getReader()
					const chunks: Uint8Array[] = []
					let received = 0
					while (true) {
						const { done, value } = await reader.read()
						if (done || cancelled) { reader.cancel(); break }
						chunks.push(value)
						received += value.length
						setLoadPct(Math.round((received / contentLength) * 40))
					}
					if (cancelled) return
					const totalLength = chunks.reduce((s, c) => s + c.length, 0)
					const merged = new Uint8Array(totalLength)
					let off = 0
					for (const chunk of chunks) { merged.set(chunk, off); off += chunk.length }
					buffer = merged.buffer
				} else {
					buffer = await res.arrayBuffer()
					setLoadPct(40)
				}

				if (cancelled) return

				setLoadStage("Parsing glyphs")
				setLoadPct(42)
				await new Promise(r => setTimeout(r, 0))

				let animPct = 42
				const animTimer = setInterval(() => {
					animPct = animPct + (85 - animPct) * 0.06
					setLoadPct(Math.round(animPct))
				}, 80)

				const parsed = await parseFont(buffer, decompressWoff2).finally(() => clearInterval(animTimer))
				if (cancelled) return

				setLoadStage("Applying to page")
				setLoadPct(88)
				await new Promise(r => setTimeout(r, 0))
				snapshotFont(parsed)
				const blob = fontToBlob(parsed)
				const url  = applyFontBlob(DEMO_FAMILY, blob, blobUrlRef.current ?? undefined)
				blobUrlRef.current = url
				setLoadPct(100)
				setFont(parsed)
				setFileName(DEFAULT_FONT_NAME)
			} catch (err: unknown) {
				if (!cancelled) setError(err instanceof Error ? err.message : "Could not load default font.")
			} finally {
				if (!cancelled) { setLoading(false); setLoadStage(null); setLoadPct(0) }
			}
		}

		loadDefault()
		return () => {
			cancelled = true
			abortController.abort()
			if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
			if (adjTimerRef.current) clearTimeout(adjTimerRef.current)
		}
	}, [])

	const handleFile = useCallback(async (file: File) => {
		setLoading(true)
		setLoadPct(0)
		setError(null)
		setFont(null)
		setSelectedChar(null)
		setAnchorRect(null)
		setGlobalAdj(ADJ_ZERO)
		setCharAdjs(new Map())
		setFileName(file.name)

		try {
			setLoadStage("Parsing glyphs")
			setLoadPct(30)
			const buffer = await file.arrayBuffer()
			setLoadPct(55)
			const parsed = await parseFont(buffer, decompressWoff2)

			setLoadStage("Applying to page")
			setLoadPct(88)
			snapshotFont(parsed)
			const blob = fontToBlob(parsed)
			const url  = applyFontBlob(DEMO_FAMILY, blob, blobUrlRef.current ?? undefined)
			blobUrlRef.current = url
			setLoadPct(100)
			setFont(parsed)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Could not parse this font file.")
		} finally {
			setLoading(false); setLoadStage(null); setLoadPct(0)
		}
	}, [])

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
	const textStyle: React.CSSProperties = { fontFamily: DEMO_FAMILY, fontSize: "1.125rem", lineHeight: "1.8" }

	const [isDragOver, setIsDragOver] = useState(false)

	return (
		<div className="w-full">

			{/* Upload zone */}
			<div
				onDrop={e => { setIsDragOver(false); handleDrop(e) }}
				onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
				onDragEnter={() => setIsDragOver(true)}
				onDragLeave={() => setIsDragOver(false)}
				aria-label="Font file drop zone — drag a TTF, OTF, WOFF, or WOFF2 font file here"
				className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-8 px-6 text-center transition-colors mb-6 ${isDragOver ? "border-foreground/60 bg-foreground/5" : "border-foreground/20 hover:border-foreground/40"}`}
			>
				<p className="text-xs uppercase tracking-[0.18em] font-medium text-muted">
					{loading ? (loadStage ?? "Loading…") : fileName ? `Loaded: ${fileName}` : "Drop a font file or click to browse"}
				</p>
				{fileName && !loading && fileName !== DEFAULT_FONT_NAME && (
					<p className="text-xs text-subtle font-mono">{fileName}</p>
				)}
				<label title="Upload a TTF, OTF, WOFF, or WOFF2 file to replace the current demo font" className="text-xs px-4 py-2 rounded-full border border-foreground/30 cursor-pointer hover:bg-foreground/5 transition-colors">
					{font ? "Swap font" : "Choose TTF / OTF / WOFF / WOFF2"}
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
					{/* Global adjustment sliders */}
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

					{/* Reset global */}
					<div className="flex justify-end mt-4">
						<button onClick={resetGlobalAdj} aria-label="Reset all global adjustments and restore every glyph to its original shape" title="Clear all global slider adjustments and restore every glyph to its original shape" className="text-xs text-muted hover:text-foreground transition-colors">
							Reset all
						</button>
					</div>
				</>
			)}

			{/* Caption */}
			{!loading && (
				<p className="text-xs text-muted italic mt-6" style={{ lineHeight: "1.8" }}>
					{font
						? "Click any character to open per-glyph sliders and the bezier path editor. Global sliders reshape every glyph at once."
						: "Loaded with Inter by default — swap it for any TTF, OTF, WOFF, or WOFF2 above."
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
