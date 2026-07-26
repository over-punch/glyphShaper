import Demo from "@/components/Demo"
import CopyInstall from "@/components/CopyInstall"
import CodeBlock from "@/components/CodeBlock"
import ToolDirectory from "@/components/ToolDirectory"
import { version } from "../../../package.json"
import { version as siteVersion } from "../../package.json"
import SiteFooter from "../components/SiteFooter"
import PortsSection from "../components/PortsSection"
import { MagnetChar } from "@liiift-studio/magnettype"

export default function Home() {
	return (
		<main className="flex flex-col items-center px-6 py-20 gap-24">

			{/* Hero */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<div className="flex flex-col gap-2">
					<p className="text-xs uppercase tracking-[0.18em] font-medium text-muted">glyphshaper</p>
					<h1 className="text-4xl lg:text-8xl xl:text-9xl" style={{ fontFamily: "var(--font-merriweather), serif", fontVariationSettings: '"wght" 300, "opsz" 144', lineHeight: "1.05em" }}>
						<MagnetChar as="span" minWeight={300} maxWeight={800} spreadRadius={220} fixedAxes={{ opsz: 144 }}>Edit a glyph.</MagnetChar><br />
						<MagnetChar as="span" minWeight={300} maxWeight={800} spreadRadius={220} fixedAxes={{ opsz: 144 }} style={{ color: "var(--foreground-subtle)", fontStyle: "italic" }}>Watch it everywhere.</MagnetChar>
					</h1>
				</div>
				<div className="flex items-center gap-4">
					<CopyInstall />
					<a href="https://github.com/Liiift-Studio/glyphShaper" target="_blank" rel="noopener noreferrer" aria-label="glyphShaper on GitHub (opens in new tab)" className="text-sm text-muted hover:text-foreground transition-colors">GitHub ↗</a>
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tracking-wide">
					<span>TypeScript</span><span aria-hidden="true">·</span><span>opentype.js</span><span aria-hidden="true">·</span><span>React + Vanilla JS</span><span aria-hidden="true">·</span><span>No server</span>
				</div>
				<p className="text-base leading-relaxed max-w-lg">
					Click any character, drag its bezier control points to reshape the outline, then
					hit Apply. glyphShaper regenerates the font binary in the browser and injects a
					dynamic <code className="text-xs font-mono">@font-face</code> override — every
					instance of that character on the page re-renders instantly. No server, no export,
					no page reload.
				</p>
			</section>

			{/* Demo */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-4">
				<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">Interactive demo — click any character</h2>
				<div className="rounded-xl -mx-8 px-8 py-8" style={{ background: "var(--panel)", overflow: "hidden" }}>
					<Demo />
				</div>
			</section>

			{/* Explanation */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">How it works</h2>
				<div className="prose-grid grid grid-cols-1 sm:grid-cols-2 gap-12 text-sm leading-relaxed">
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-base">Parse, edit, regenerate</p>
						<p>glyphShaper uses opentype.js to parse the uploaded font binary into a structured
						object. Each glyph&rsquo;s <code className="text-xs font-mono">path.commands</code> array
						— moveTo, lineTo, curveTo, quadraticCurveTo — is exposed as draggable SVG control
						points. When you hit Apply, the modified font object is serialised back to an
						ArrayBuffer via <code className="text-xs font-mono">font.toArrayBuffer()</code>.</p>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-base">Dynamic @font-face injection</p>
						<p>The regenerated buffer becomes a Blob URL. A <code className="text-xs font-mono">{'<style>'}</code> element
						is injected (or replaced) in <code className="text-xs font-mono">{'<head>'}</code> with a new{" "}
						<code className="text-xs font-mono">@font-face</code> rule pointing at that URL.
						The browser immediately re-renders any element using that font&#8209;family —
						headings, body text, buttons — with the modified glyph outline.</p>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-base">Bezier control points</p>
						<p>Glyph outlines use cubic and quadratic Bézier segments. Anchor points
						(filled circles) are on-curve endpoints. Handle points (outlined circles)
						are off-curve control handles that pull the curve without touching it.
						Moving handles reshapes the curve smoothly; moving anchors shifts the
						segment endpoint. Pointer capture keeps the drag working even when the
						cursor leaves the SVG area.</p>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-base">Ephemeral by design</p>
						<p>Every edit lives entirely in the browser&rsquo;s memory. The original font
						file is never written to disk. Refreshing the page resets everything.
						This makes glyphShaper ideal for live demos, design explorations, and
						teaching moments — low commitment, instant feedback, no pipeline.</p>
					</div>
				</div>
			</section>

			{/* Usage */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<div className="flex items-baseline gap-4">
					<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">Usage</h2>
					<p className="text-xs text-muted tracking-wide">TypeScript + React · Vanilla JS</p>
				</div>
				<div className="flex flex-col gap-8 text-sm">
					<div className="flex flex-col gap-3">
						<p className="text-muted">Drop-in editor component</p>
						<CodeBlock code={`import { useGlyphFont, GlyphShaperEditor } from '@liiift-studio/glyphshaper'

const { font } = useGlyphFont('/fonts/MyFont.ttf')

// fontFamily must match the CSS font-family name applied to the child element
<GlyphShaperEditor font={font} fontFamily="MyFont" text="Heading">
  <h1 style={{ fontFamily: 'MyFont' }}>Heading</h1>
</GlyphShaperEditor>`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Load from uploaded File</p>
						<CodeBlock code={`import { useGlyphFont } from '@liiift-studio/glyphshaper'

// Pass a File object from an <input type="file"> onChange handler
// Note: useGlyphFont supports TTF, OTF, and WOFF1 only.
// For WOFF2, use parseFont() directly with a woff2Decompressor callback.
const { font, loading, error } = useGlyphFont(file)

// Pass null to reset the hook to idle state
const { font } = useGlyphFont(null)`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Low-level — vanilla JS</p>
						<CodeBlock code={`import {
  parseFont, getGlyphCommands, setGlyphCommands,
  fontToBlob, applyFontBlob,
} from '@liiift-studio/glyphshaper'

const res    = await fetch('/fonts/MyFont.ttf')
const buffer = await res.arrayBuffer()
const font   = await parseFont(buffer)

// Read glyph path commands
const cmds = getGlyphCommands(font, 'A')

// Modify — e.g. shift all anchor y values up by 50 units
const shifted = cmds.map(c =>
  c.type !== 'Z' ? { ...c, y: c.y + 50 } : c
)

// Write back and apply
setGlyphCommands(font, 'A', shifted)
const url = applyFontBlob('MyFont', fontToBlob(font))
// All elements using font-family: MyFont now show the shifted A`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">API</p>
						<table className="w-full text-xs">
							<caption className="sr-only">glyphShaper API</caption>
							<thead>
								<tr className="text-subtle text-left">
									<th className="pb-2 pr-6 font-normal">Name</th>
									<th className="pb-2 font-normal">Description</th>
								</tr>
							</thead>
							<tbody className="text-muted zebra">
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">parseFont(buffer, decompressor?)</td>
									<td className="py-2">Parse an ArrayBuffer (TTF, OTF, or WOFF1) into a GlyphFont handle. For WOFF2 input, pass a <code className="font-mono">woff2Decompressor</code> callback — the function throws without it.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">getGlyphCommands(font, char)</td>
									<td className="py-2">Return a deep copy of the path commands for a character.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">setGlyphCommands(font, char, cmds)</td>
									<td className="py-2">Write modified commands back into the font object (mutates in place).</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">fontToBlob(font)</td>
									<td className="py-2">Serialise the font to a Blob (OTF binary).</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">applyFontBlob(family, blob, existingUrl?, options?)</td>
									<td className="py-2">Inject a @font-face override; returns the Blob URL for later cleanup. Pass <code className="font-mono">existingUrl</code> to revoke the previous Blob URL and prevent memory leaks. <code className="font-mono">options</code> accepts <code className="font-mono">fontWeight</code> and <code className="font-mono">fontStyle</code>.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">revokeFont(url)</td>
									<td className="py-2">Revoke the Blob URL and remove the override style element.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">commandsToPathD(cmds)</td>
									<td className="py-2">Convert a PathCommand[] to an SVG path <code className="font-mono">d</code> string for use in a <code className="font-mono">&lt;path&gt;</code> element.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">useGlyphFont(source)</td>
									<td className="py-2">React hook — accepts a URL string, File, or <code className="font-mono">null</code> (resets to idle). Supports TTF, OTF, and WOFF1; for WOFF2 use <code className="font-mono">parseFont()</code> directly. Returns <code className="font-mono">{'{font, loading, error}'}</code>.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">GlyphShaperEditor</td>
									<td className="py-2">Drop-in React component — handles font loading, glyph state, and bezier editing in a single wrapper. Accepts <code className="font-mono">font</code>, <code className="font-mono">fontFamily</code>, and <code className="font-mono">text</code>.</td>
								</tr>
								<tr className="hover:bg-foreground/5 transition-colors">
									<td className="py-2 pr-6 font-mono">GlyphSvgEditor</td>
									<td className="py-2">Lower-level React component exposing just the SVG bezier editor. Use when you want to manage font loading and state yourself.</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Font format support</p>
						<p className="text-xs leading-relaxed">
							glyphShaper accepts <strong>TTF, OTF, WOFF1, and WOFF2</strong>. WOFF2 support
							requires passing a <code className="font-mono">woff2Decompressor</code> callback
							to <code className="font-mono">parseFont()</code> — the demo uses{" "}
							<code className="font-mono">wawoff2</code> (a WASM brotli decoder) for this.
							The <code className="font-mono">useGlyphFont</code> hook does not accept a
							decompressor and therefore does not support WOFF2; use{" "}
							<code className="font-mono">parseFont()</code> directly if you need WOFF2.
						</p>
					</div>
				</div>
			</section>

			<PortsSection figma="full" />

			<SiteFooter current="glyphShaper" npmVersion={version} siteVersion={siteVersion} />

		</main>
	)
}
