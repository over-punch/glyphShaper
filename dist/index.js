import { parseFont as _, revokeFont as j, getGlyphCommands as N, commandsToPathD as O, setGlyphCommands as V, fontToBlob as q, applyFontBlob as Z } from "./core.js";
import { useState as G, useEffect as S, useRef as D, useCallback as J } from "react";
import { jsxs as M, jsx as y } from "react/jsx-runtime";
function ur(r) {
  const [a, o] = G({
    font: null,
    loading: !1,
    error: null
  });
  return S(() => {
    if (!r) {
      o({ font: null, loading: !1, error: null });
      return;
    }
    let n = !1;
    o((c) => ({ ...c, loading: !0, error: null }));
    async function t() {
      try {
        let c;
        if (typeof r == "string") {
          const s = await fetch(r);
          if (!s.ok) throw new Error(`HTTP ${s.status} fetching font`);
          c = await s.arrayBuffer();
        } else
          c = await r.arrayBuffer();
        if (n) return;
        const f = await _(c);
        if (n) return;
        o({ font: f, loading: !1, error: null });
      } catch (c) {
        if (n) return;
        o({
          font: null,
          loading: !1,
          error: c instanceof Error ? c.message : "Failed to load font"
        });
      }
    }
    return t(), () => {
      n = !0;
    };
  }, [r]), a;
}
const R = 360, m = 32, rr = 7, nr = 5, Q = 50;
function W(r, a, o, n, t) {
  return [
    m + (r - n) * o,
    m + (t - a) * o
  ];
}
function tr(r, a, o, n, t) {
  return [
    (r - m) / o + n,
    t - (a - m) / o
  ];
}
function er(r) {
  const a = [];
  for (let o = 0; o < r.length; o++) {
    const n = r[o];
    n.type === "M" || n.type === "L" ? a.push({ cmdIdx: o, field: "xy", kind: "anchor", x: n.x, y: n.y }) : n.type === "C" ? (a.push({ cmdIdx: o, field: "x1y1", kind: "handle", x: n.x1, y: n.y1 }), a.push({ cmdIdx: o, field: "x2y2", kind: "handle", x: n.x2, y: n.y2 }), a.push({ cmdIdx: o, field: "xy", kind: "anchor", x: n.x, y: n.y })) : n.type === "Q" && (a.push({ cmdIdx: o, field: "x1y1", kind: "handle", x: n.x1, y: n.y1 }), a.push({ cmdIdx: o, field: "xy", kind: "anchor", x: n.x, y: n.y }));
  }
  return a;
}
function or(r) {
  const a = [];
  let o = 0, n = 0;
  for (const t of r)
    t.type === "M" || t.type === "L" ? (o = t.x, n = t.y) : t.type === "C" ? (a.push({ x1: o, y1: n, x2: t.x1, y2: t.y1 }), a.push({ x1: t.x2, y1: t.y2, x2: t.x, y2: t.y }), o = t.x, n = t.y) : t.type === "Q" && (a.push({ x1: o, y1: n, x2: t.x1, y2: t.y1 }), a.push({ x1: t.x1, y1: t.y1, x2: t.x, y2: t.y }), o = t.x, n = t.y);
  return a;
}
function X(r, a, o, n, t) {
  const c = Math.round(n), f = Math.round(t);
  return r.map((s, d) => d !== a ? s : o === "xy" && (s.type === "M" || s.type === "L") ? { ...s, x: c, y: f } : o === "xy" && (s.type === "C" || s.type === "Q") ? { ...s, x: c, y: f } : o === "x1y1" && (s.type === "C" || s.type === "Q") ? { ...s, x1: c, y1: f } : o === "x2y2" && s.type === "C" ? { ...s, x2: c, y2: f } : s);
}
const Y = typeof Intl < "u" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
function ir(r) {
  const a = /* @__PURE__ */ new Set();
  return (Y ? Array.from(Y.segment(r), (n) => n.segment) : Array.from(r)).filter((n) => !n.trim() || a.has(n) ? !1 : (a.add(n), !0));
}
function lr({
  commands: r,
  font: a,
  char: o,
  onChange: n,
  onDragStart: t
}) {
  const c = D(null), f = D(null), s = a._font, d = s.charToGlyphIndex(o), x = s.glyphs.get(d), k = (x == null ? void 0 : x.leftSideBearing) ?? 0, g = (x == null ? void 0 : x.advanceWidth) ?? s.unitsPerEm, h = s.ascender, v = s.descender, I = g, P = h - v, $ = R - 2 * m, p = Math.min($ / I, $ / P), E = m + h * p, B = J((i) => {
    const e = c.current;
    if (!e) return [0, 0];
    const l = e.getScreenCTM();
    if (!l) return [0, 0];
    const u = e.createSVGPoint();
    u.x = i.clientX, u.y = i.clientY;
    const w = u.matrixTransform(l.inverse());
    return tr(w.x, w.y, p, k, h);
  }, [p, k, h]);
  function A(i, e, l) {
    i.isPrimary && (i.stopPropagation(), i.target.setPointerCapture(i.pointerId), t(r), f.current = { cmdIdx: e, field: l });
  }
  function C(i) {
    if (!f.current) return;
    const [e, l] = B(i);
    n(X(r, f.current.cmdIdx, f.current.field, e, l));
  }
  function T() {
    f.current = null;
  }
  function H(i, e, l, u, w) {
    const b = i.shiftKey ? 10 : 1, K = { ArrowLeft: [-b, 0], ArrowRight: [b, 0], ArrowUp: [0, b], ArrowDown: [0, -b] }[i.key];
    K && (i.preventDefault(), t(r), n(X(r, e, l, u + K[0], w + K[1])));
  }
  const L = O(r), z = er(r), U = or(r);
  return /* @__PURE__ */ M(
    "svg",
    {
      ref: c,
      width: "100%",
      viewBox: `0 0 ${R} ${R}`,
      onPointerMove: C,
      onPointerUp: T,
      onPointerLeave: T,
      style: {
        display: "block",
        touchAction: "none",
        cursor: "default",
        // Maintain a 1:1 aspect ratio as width scales with the container
        aspectRatio: "1 / 1"
      },
      role: "group",
      "aria-label": `Glyph path editor for character ${o}. Tab to a point, then use the arrow keys to move it (Shift for 10 units).`,
      children: [
        /* @__PURE__ */ y(
          "line",
          {
            x1: m / 2,
            y1: E,
            x2: R - m / 2,
            y2: E,
            stroke: "rgba(255,255,255,0.08)",
            strokeWidth: 1
          }
        ),
        (() => {
          const [i] = W(g, 0, p, k, h);
          return /* @__PURE__ */ y(
            "line",
            {
              x1: i,
              y1: m / 2,
              x2: i,
              y2: R - m / 2,
              stroke: "rgba(255,255,255,0.08)",
              strokeWidth: 1,
              strokeDasharray: "4 4"
            }
          );
        })(),
        /* @__PURE__ */ y("g", { transform: `translate(${m + (0 - k) * p}, ${m + h * p}) scale(${p}, ${-p})`, children: r.length > 0 && /* @__PURE__ */ y(
          "path",
          {
            d: L,
            fill: "rgba(53,221,226,0.12)",
            stroke: "rgba(53,221,226,0.55)",
            strokeWidth: 2 / p,
            fillRule: "nonzero"
          }
        ) }),
        U.map((i, e) => {
          const [l, u] = W(i.x1, i.y1, p, k, h), [w, b] = W(i.x2, i.y2, p, k, h);
          return /* @__PURE__ */ y(
            "line",
            {
              x1: l,
              y1: u,
              x2: w,
              y2: b,
              stroke: "rgba(255,255,255,0.18)",
              strokeWidth: 1,
              strokeDasharray: "3 3"
            },
            e
          );
        }),
        z.map((i, e) => {
          const [l, u] = W(i.x, i.y, p, k, h), w = i.kind === "anchor" ? rr : nr;
          return /* @__PURE__ */ y(
            "circle",
            {
              role: "button",
              "aria-label": `${i.kind === "anchor" ? "Anchor" : "Handle"} point ${e + 1} of ${z.length}, x ${Math.round(i.x)}, y ${Math.round(i.y)}`,
              tabIndex: 0,
              onKeyDown: (b) => H(b, i.cmdIdx, i.field, i.x, i.y),
              cx: l,
              cy: u,
              r: w,
              fill: i.kind === "anchor" ? "rgba(53,221,226,0.9)" : "rgba(0,0,0,0)",
              stroke: "rgba(53,221,226,0.75)",
              strokeWidth: 1.5,
              style: { cursor: "grab" },
              onPointerDown: (b) => A(b, i.cmdIdx, i.field)
            },
            e
          );
        }),
        r.length === 0 && /* @__PURE__ */ y(
          "text",
          {
            x: R / 2,
            y: R / 2,
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
function dr({
  font: r,
  fontFamily: a,
  text: o = "Typography",
  children: n,
  selectedChar: t,
  onClose: c,
  onApply: f,
  hidePalette: s = !1
}) {
  const [d, x] = G(null), [k, g] = G([]), [h, v] = G([]), I = D(null), P = D(null), [$, p] = G(null), E = D(null), B = ir(o), A = h.length > 0;
  S(() => () => {
    I.current && (j(I.current), I.current = null);
  }, []), S(() => {
    P.current = d;
  }, [d]);
  const C = D(r);
  S(() => {
    C.current !== r && (C.current = r, P.current !== null && t === void 0 ? (x(null), g([]), v([])) : P.current !== null && r && (g(N(r, P.current)), v([])));
  }, [r, t]), S(() => {
    var e, l, u;
    d && ((u = (l = (e = E.current) == null ? void 0 : e.querySelector("circle")) == null ? void 0 : l.focus) == null || u.call(l));
  }, [d]), S(() => {
    if (t === void 0 || !r) return;
    const e = P.current;
    t === null ? e !== null && (x(null), g([]), v([])) : t !== e && (g(N(r, t)), x(t), v([]));
  }, [t, r]);
  function T() {
    if (h.length === 0) return;
    const e = h[h.length - 1];
    v((l) => l.slice(0, -1)), g(e);
  }
  function H(e) {
    v((l) => {
      const u = [...l, e];
      return u.length > Q ? u.slice(-Q) : u;
    });
  }
  const L = D(T);
  S(() => {
    L.current = T;
  }), S(() => {
    if (!d) return;
    function e(l) {
      var F;
      const u = l.target, w = !!u && !!((F = E.current) != null && F.contains(u)), b = !u || u === document.body || u === document.documentElement;
      !w && !b || (l.metaKey || l.ctrlKey) && !l.shiftKey && l.key === "z" && (l.preventDefault(), L.current());
    }
    return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
  }, [d]);
  function z(e) {
    r && (g(N(r, e)), x(e), v([]));
  }
  function U() {
    x(null), g([]), v([]), c == null || c();
  }
  function i() {
    if (!r || !d) return;
    let e;
    try {
      V(r, d, k);
      const l = q(r);
      e = Z(a, l, I.current ?? void 0);
    } catch (l) {
      p(l instanceof Error ? l.message : String(l));
      return;
    }
    p(null), I.current = e, f == null || f(d, [...k]), x(null), g([]), v([]), c == null || c();
  }
  return /* @__PURE__ */ M("div", { children: [
    (n != null || !s) && /* @__PURE__ */ y("div", { style: { fontFamily: a }, children: n ?? /* @__PURE__ */ y("p", { children: o }) }),
    r && !s && /* @__PURE__ */ y(
      "div",
      {
        role: "group",
        "aria-label": "Character palette — click to edit",
        style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "16px" },
        children: B.map((e) => /* @__PURE__ */ y(
          "button",
          {
            onClick: () => z(e),
            "aria-pressed": d === e,
            style: {
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: a,
              fontSize: 16,
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              background: d === e ? "rgba(53,221,226,0.15)" : "transparent",
              cursor: "pointer",
              color: "inherit",
              transition: "background 0.15s"
            },
            children: e
          },
          e
        ))
      }
    ),
    d && r && /* @__PURE__ */ M(
      "div",
      {
        ref: E,
        style: {
          marginTop: 16,
          padding: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8
        },
        children: [
          /* @__PURE__ */ M("p", { style: { fontSize: 11, opacity: 0.5, marginBottom: 12, fontFamily: "sans-serif" }, children: [
            "Editing “",
            d,
            "” — drag filled circles (anchors) or outlined circles (handles) to reshape"
          ] }),
          /* @__PURE__ */ y(
            lr,
            {
              commands: k,
              font: r,
              char: d,
              onChange: g,
              onDragStart: H
            }
          ),
          /* @__PURE__ */ M("div", { style: { display: "flex", gap: 8, marginTop: 12, alignItems: "center" }, children: [
            /* @__PURE__ */ y(
              "button",
              {
                onClick: U,
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
            /* @__PURE__ */ y(
              "button",
              {
                onClick: T,
                disabled: !A,
                title: "Undo last drag (Ctrl+Z / Cmd+Z)",
                style: {
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "inherit",
                  opacity: A ? 0.7 : 0.25,
                  cursor: A ? "pointer" : "default",
                  transition: "opacity 0.15s"
                },
                children: "Undo"
              }
            ),
            /* @__PURE__ */ y(
              "button",
              {
                onClick: i,
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
          $ && /* @__PURE__ */ y("p", { role: "alert", style: { marginTop: 8, fontSize: 12, fontFamily: "sans-serif" }, children: $ })
        ]
      }
    ),
    !r && /* @__PURE__ */ y("p", { style: { marginTop: 12, fontSize: 12, opacity: 0.4, fontFamily: "sans-serif" }, children: "No font loaded." })
  ] });
}
export {
  dr as GlyphShaperEditor,
  lr as GlyphSvgEditor,
  Z as applyFontBlob,
  O as commandsToPathD,
  q as fontToBlob,
  N as getGlyphCommands,
  _ as parseFont,
  j as revokeFont,
  V as setGlyphCommands,
  ur as useGlyphFont
};
