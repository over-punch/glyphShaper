import { parseFont as j, revokeFont as O, getGlyphCommands as K, commandsToPathD as V, setGlyphCommands as X, fontToBlob as Y, applyFontBlob as q } from "./core.js";
import { compareFontTables as pt, getFontSource as ht, getWriteInfo as xt } from "./core.js";
import { useState as z, useEffect as $, useRef as G, useCallback as J } from "react";
import { jsxs as C, jsx as w } from "react/jsx-runtime";
function ut(t) {
  const [o, l] = z({
    font: null,
    loading: !1,
    error: null
  });
  return $(() => {
    if (!t) {
      l({ font: null, loading: !1, error: null });
      return;
    }
    let r = !1;
    l((y) => ({ ...y, loading: !0, error: null }));
    async function e() {
      try {
        let y;
        if (typeof t == "string") {
          const v = await fetch(t);
          if (!v.ok) throw new Error(`HTTP ${v.status} fetching font`);
          y = await v.arrayBuffer();
        } else
          y = await t.arrayBuffer();
        if (r) return;
        const m = await j(y);
        if (r) return;
        l({ font: m, loading: !1, error: null });
      } catch (y) {
        if (r) return;
        l({
          font: null,
          loading: !1,
          error: y instanceof Error ? y.message : "Failed to load font"
        });
      }
    }
    return e(), () => {
      r = !0;
    };
  }, [t]), o;
}
const A = 360, M = 32, tt = 7, rt = 5, N = 50;
function B(t, o, l, r, e) {
  return [
    M + (t - r) * l,
    M + (e - o) * l
  ];
}
function et(t, o, l, r, e) {
  return [
    (t - M) / l + r,
    e - (o - M) / l
  ];
}
function nt(t) {
  const o = [];
  for (let l = 0; l < t.length; l++) {
    const r = t[l];
    r.type === "M" || r.type === "L" ? o.push({ cmdIdx: l, field: "xy", kind: "anchor", x: r.x, y: r.y }) : r.type === "C" ? (o.push({ cmdIdx: l, field: "x1y1", kind: "handle", x: r.x1, y: r.y1 }), o.push({ cmdIdx: l, field: "x2y2", kind: "handle", x: r.x2, y: r.y2 }), o.push({ cmdIdx: l, field: "xy", kind: "anchor", x: r.x, y: r.y })) : r.type === "Q" && (o.push({ cmdIdx: l, field: "x1y1", kind: "handle", x: r.x1, y: r.y1 }), o.push({ cmdIdx: l, field: "xy", kind: "anchor", x: r.x, y: r.y }));
  }
  return o;
}
function ot(t) {
  const o = [];
  let l = 0, r = 0;
  for (const e of t)
    e.type === "M" || e.type === "L" ? (l = e.x, r = e.y) : e.type === "C" ? (o.push({ x1: l, y1: r, x2: e.x1, y2: e.y1 }), o.push({ x1: e.x2, y1: e.y2, x2: e.x, y2: e.y }), l = e.x, r = e.y) : e.type === "Q" && (o.push({ x1: l, y1: r, x2: e.x1, y2: e.y1 }), o.push({ x1: e.x1, y1: e.y1, x2: e.x, y2: e.y }), l = e.x, r = e.y);
  return o;
}
function Q(t, o, l, r, e) {
  const y = Math.round(r), m = Math.round(e), v = t[o];
  if (!v || v.type === "Z") return t;
  let c = o, p = o;
  for (; c > 0 && t[c].type !== "M"; ) c--;
  for (; p < t.length - 1 && t[p].type !== "Z"; ) p++;
  const x = t[c].type === "M" ? c + 1 : c, g = t[p].type === "Z" ? p - 1 : p, k = g - x + 1, h = t.map((n) => ({ ...n })), R = (n) => x + (n - x + 1) % k, I = (n) => {
    const u = t[n], d = k > 1 ? t[R(n)] : null;
    return !u || !d || u.type !== "Q" || d.type !== "Q" ? !1 : Math.abs(u.x - (u.x1 + d.x1) / 2) < 1e-6 && Math.abs(u.y - (u.y1 + d.y1) / 2) < 1e-6;
  }, E = [];
  for (let n = x; n <= g; n++) E[n] = o >= x && k > 0 ? I(n) : !1;
  const b = t[c], D = t[g], W = b.type === "M" && D && D.type !== "Z" && g >= x && b.x === D.x && b.y === D.y;
  if (l === "xy" && o >= x && E[o]) {
    const n = h[o], u = h[R(o)], d = Math.round(r - n.x), S = Math.round(e - n.y);
    n.x1 += d, n.y1 += S, u !== n && (u.x1 += d, u.y1 += S);
  } else if (l === "xy") {
    const n = v.x, u = v.y;
    for (let d = c; d <= p; d++) {
      const S = h[d];
      S.type !== "Z" && (d === o || S.x === n && S.y === u) && (S.x = y, S.y = m);
    }
  } else {
    const n = h[o];
    l === "x1y1" && (n.type === "C" || n.type === "Q") && (n.x1 = y, n.y1 = m), l === "x2y2" && n.type === "C" && (n.x2 = y, n.y2 = m);
  }
  for (let n = x; n <= g; n++) {
    if (!E[n]) continue;
    const u = h[n], d = h[R(n)];
    u.x = (u.x1 + d.x1) / 2, u.y = (u.y1 + d.y1) / 2;
  }
  if (W && E[g]) {
    const n = h[c], u = h[g];
    n.type === "M" && u.type !== "Z" && (n.x = u.x, n.y = u.y);
  }
  return h;
}
const _ = typeof Intl < "u" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
function it(t) {
  const o = /* @__PURE__ */ new Set();
  return (_ ? Array.from(_.segment(t), (r) => r.segment) : Array.from(t)).filter((r) => !r.trim() || o.has(r) ? !1 : (o.add(r), !0));
}
function lt({
  commands: t,
  font: o,
  char: l,
  onChange: r,
  onDragStart: e
}) {
  const y = G(null), m = G(null), v = o._font, c = v.charToGlyphIndex(l), p = v.glyphs.get(c), x = (p == null ? void 0 : p.leftSideBearing) ?? 0, g = (p == null ? void 0 : p.advanceWidth) ?? v.unitsPerEm, k = v.ascender, h = v.descender, R = g, I = k - h, E = A - 2 * M, b = Math.min(E / R, E / I), D = M + k * b, W = J((s) => {
    const i = y.current;
    if (!i) return [0, 0];
    const a = i.getScreenCTM();
    if (!a) return [0, 0];
    const f = i.createSVGPoint();
    f.x = s.clientX, f.y = s.clientY;
    const T = f.matrixTransform(a.inverse());
    return et(T.x, T.y, b, x, k);
  }, [b, x, k]);
  function n(s, i, a) {
    s.isPrimary && (s.stopPropagation(), s.target.setPointerCapture(s.pointerId), e(t), m.current = { cmdIdx: i, field: a });
  }
  function u(s) {
    if (!m.current) return;
    const [i, a] = W(s);
    r(Q(t, m.current.cmdIdx, m.current.field, i, a));
  }
  function d() {
    m.current = null;
  }
  function S(s, i, a, f, T) {
    const P = s.shiftKey ? 10 : 1, Z = { ArrowLeft: [-P, 0], ArrowRight: [P, 0], ArrowUp: [0, P], ArrowDown: [0, -P] }[s.key];
    Z && (s.preventDefault(), e(t), r(Q(t, i, a, f + Z[0], T + Z[1])));
  }
  const L = V(t), F = nt(t), H = ot(t);
  return /* @__PURE__ */ C(
    "svg",
    {
      ref: y,
      width: "100%",
      viewBox: `0 0 ${A} ${A}`,
      onPointerMove: u,
      onPointerUp: d,
      onPointerLeave: d,
      style: {
        display: "block",
        touchAction: "none",
        cursor: "default",
        // Maintain a 1:1 aspect ratio as width scales with the container
        aspectRatio: "1 / 1"
      },
      role: "group",
      "aria-label": `Glyph path editor for character ${l}. Tab to a point, then use the arrow keys to move it (Shift for 10 units).`,
      children: [
        /* @__PURE__ */ w(
          "line",
          {
            x1: M / 2,
            y1: D,
            x2: A - M / 2,
            y2: D,
            stroke: "rgba(255,255,255,0.08)",
            strokeWidth: 1
          }
        ),
        (() => {
          const [s] = B(g, 0, b, x, k);
          return /* @__PURE__ */ w(
            "line",
            {
              x1: s,
              y1: M / 2,
              x2: s,
              y2: A - M / 2,
              stroke: "rgba(255,255,255,0.08)",
              strokeWidth: 1,
              strokeDasharray: "4 4"
            }
          );
        })(),
        /* @__PURE__ */ w("g", { transform: `translate(${M + (0 - x) * b}, ${M + k * b}) scale(${b}, ${-b})`, children: t.length > 0 && /* @__PURE__ */ w(
          "path",
          {
            d: L,
            fill: "rgba(53,221,226,0.12)",
            stroke: "rgba(53,221,226,0.55)",
            strokeWidth: 2 / b,
            fillRule: "nonzero"
          }
        ) }),
        H.map((s, i) => {
          const [a, f] = B(s.x1, s.y1, b, x, k), [T, P] = B(s.x2, s.y2, b, x, k);
          return /* @__PURE__ */ w(
            "line",
            {
              x1: a,
              y1: f,
              x2: T,
              y2: P,
              stroke: "rgba(255,255,255,0.18)",
              strokeWidth: 1,
              strokeDasharray: "3 3"
            },
            i
          );
        }),
        F.map((s, i) => {
          const [a, f] = B(s.x, s.y, b, x, k), T = s.kind === "anchor" ? tt : rt;
          return /* @__PURE__ */ w(
            "circle",
            {
              role: "button",
              "aria-label": `${s.kind === "anchor" ? "Anchor" : "Handle"} point ${i + 1} of ${F.length}, x ${Math.round(s.x)}, y ${Math.round(s.y)}`,
              tabIndex: 0,
              onKeyDown: (P) => S(P, s.cmdIdx, s.field, s.x, s.y),
              cx: a,
              cy: f,
              r: T,
              fill: s.kind === "anchor" ? "rgba(53,221,226,0.9)" : "rgba(0,0,0,0)",
              stroke: "rgba(53,221,226,0.75)",
              strokeWidth: 1.5,
              style: { cursor: "grab" },
              onPointerDown: (P) => n(P, s.cmdIdx, s.field)
            },
            i
          );
        }),
        t.length === 0 && /* @__PURE__ */ w(
          "text",
          {
            x: A / 2,
            y: A / 2,
            textAnchor: "middle",
            fill: "rgba(255,255,255,0.3)",
            fontSize: 12,
            fontFamily: "sans-serif",
            children: "No outlines for this character"
          }
        )
      ]
    }
  );
}
function yt({
  font: t,
  fontFamily: o,
  text: l = "Typography",
  children: r,
  selectedChar: e,
  onClose: y,
  onApply: m,
  hidePalette: v = !1
}) {
  const [c, p] = z(null), [x, g] = z([]), [k, h] = z([]), R = G(null), I = G(null), [E, b] = z(null), D = G(null), W = it(l), n = k.length > 0;
  $(() => () => {
    R.current && (O(R.current), R.current = null);
  }, []), $(() => {
    I.current = c;
  }, [c]);
  const u = G(t);
  $(() => {
    u.current !== t && (u.current = t, I.current !== null && e === void 0 ? (p(null), g([]), h([])) : I.current !== null && t && (g(K(t, I.current)), h([])));
  }, [t, e]), $(() => {
    var i, a, f;
    c && ((f = (a = (i = D.current) == null ? void 0 : i.querySelector("circle")) == null ? void 0 : a.focus) == null || f.call(a));
  }, [c]), $(() => {
    if (e === void 0 || !t) return;
    const i = I.current;
    e === null ? i !== null && (p(null), g([]), h([])) : e !== i && (g(K(t, e)), p(e), h([]));
  }, [e, t]);
  function d() {
    if (k.length === 0) return;
    const i = k[k.length - 1];
    h((a) => a.slice(0, -1)), g(i);
  }
  function S(i) {
    h((a) => {
      const f = [...a, i];
      return f.length > N ? f.slice(-N) : f;
    });
  }
  const L = G(d);
  $(() => {
    L.current = d;
  }), $(() => {
    if (!c) return;
    function i(a) {
      var U;
      const f = a.target, T = !!f && !!((U = D.current) != null && U.contains(f)), P = !f || f === document.body || f === document.documentElement;
      !T && !P || (a.metaKey || a.ctrlKey) && !a.shiftKey && a.key === "z" && (a.preventDefault(), L.current());
    }
    return window.addEventListener("keydown", i), () => window.removeEventListener("keydown", i);
  }, [c]);
  function F(i) {
    t && (g(K(t, i)), p(i), h([]));
  }
  function H() {
    p(null), g([]), h([]), y == null || y();
  }
  function s() {
    if (!t || !c) return;
    let i;
    try {
      X(t, c, x);
      const a = Y(t);
      i = q(o, a, R.current ?? void 0);
    } catch (a) {
      b(a instanceof Error ? a.message : String(a));
      return;
    }
    b(null), R.current = i, m == null || m(c, [...x]), p(null), g([]), h([]), y == null || y();
  }
  return /* @__PURE__ */ C("div", { children: [
    (r != null || !v) && /* @__PURE__ */ w("div", { style: { fontFamily: o }, children: r ?? /* @__PURE__ */ w("p", { children: l }) }),
    t && !v && /* @__PURE__ */ w(
      "div",
      {
        role: "group",
        "aria-label": "Character palette — click to edit",
        style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "16px" },
        children: W.map((i) => /* @__PURE__ */ w(
          "button",
          {
            onClick: () => F(i),
            "aria-pressed": c === i,
            style: {
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: o,
              fontSize: 16,
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              background: c === i ? "rgba(53,221,226,0.15)" : "transparent",
              cursor: "pointer",
              color: "inherit",
              transition: "background 0.15s"
            },
            children: i
          },
          i
        ))
      }
    ),
    c && t && /* @__PURE__ */ C(
      "div",
      {
        ref: D,
        style: {
          marginTop: 16,
          padding: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8
        },
        children: [
          /* @__PURE__ */ C("p", { style: { fontSize: 11, opacity: 0.5, marginBottom: 12, fontFamily: "sans-serif" }, children: [
            "Editing “",
            c,
            "” — drag filled circles (anchors) or outlined circles (handles) to reshape"
          ] }),
          /* @__PURE__ */ w(
            lt,
            {
              commands: x,
              font: t,
              char: c,
              onChange: g,
              onDragStart: S
            }
          ),
          /* @__PURE__ */ C("div", { style: { display: "flex", gap: 8, marginTop: 12, alignItems: "center" }, children: [
            /* @__PURE__ */ w(
              "button",
              {
                onClick: H,
                style: {
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "inherit",
                  opacity: 0.6,
                  cursor: "pointer"
                },
                children: "Cancel"
              }
            ),
            /* @__PURE__ */ w(
              "button",
              {
                onClick: d,
                disabled: !n,
                title: "Undo last drag (Ctrl+Z / Cmd+Z)",
                style: {
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "inherit",
                  opacity: n ? 0.7 : 0.25,
                  cursor: n ? "pointer" : "default",
                  transition: "opacity 0.15s"
                },
                children: "Undo"
              }
            ),
            /* @__PURE__ */ w(
              "button",
              {
                onClick: s,
                style: {
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid rgba(53,221,226,0.7)",
                  background: "rgba(53,221,226,0.1)",
                  color: "inherit",
                  cursor: "pointer",
                  marginLeft: "auto"
                },
                children: "Apply to page"
              }
            )
          ] }),
          E && /* @__PURE__ */ w("p", { role: "alert", style: { marginTop: 8, fontSize: 12, fontFamily: "sans-serif" }, children: E })
        ]
      }
    ),
    !t && /* @__PURE__ */ w("p", { style: { marginTop: 12, fontSize: 12, opacity: 0.4, fontFamily: "sans-serif" }, children: "No font loaded." })
  ] });
}
export {
  yt as GlyphShaperEditor,
  lt as GlyphSvgEditor,
  q as applyFontBlob,
  V as commandsToPathD,
  pt as compareFontTables,
  Y as fontToBlob,
  ht as getFontSource,
  K as getGlyphCommands,
  xt as getWriteInfo,
  j as parseFont,
  O as revokeFont,
  X as setGlyphCommands,
  ut as useGlyphFont
};
