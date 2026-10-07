import { parseFont as Y, revokeFont as _, getGlyphCommands as N, commandsToPathD as j, setGlyphCommands as O, fontToBlob as V, applyFontBlob as q } from "./core.js";
import { compareFontTables as pr, getFontSource as hr, getWriteInfo as xr } from "./core.js";
import { useState as A, useEffect as S, useRef as D, useCallback as J } from "react";
import { jsxs as G, jsx as x } from "react/jsx-runtime";
function cr(r) {
  const [a, e] = A({
    font: null,
    loading: !1,
    error: null
  });
  return S(() => {
    if (!r) {
      e({ font: null, loading: !1, error: null });
      return;
    }
    let t = !1;
    e((u) => ({ ...u, loading: !0, error: null }));
    async function n() {
      try {
        let u;
        if (typeof r == "string") {
          const h = await fetch(r);
          if (!h.ok) throw new Error(`HTTP ${h.status} fetching font`);
          u = await h.arrayBuffer();
        } else
          u = await r.arrayBuffer();
        if (t) return;
        const p = await Y(u);
        if (t) return;
        e({ font: p, loading: !1, error: null });
      } catch (u) {
        if (t) return;
        e({
          font: null,
          loading: !1,
          error: u instanceof Error ? u.message : "Failed to load font"
        });
      }
    }
    return n(), () => {
      t = !0;
    };
  }, [r]), a;
}
const R = 360, v = 32, rr = 7, tr = 5, Z = 50;
function W(r, a, e, t, n) {
  return [
    v + (r - t) * e,
    v + (n - a) * e
  ];
}
function nr(r, a, e, t, n) {
  return [
    (r - v) / e + t,
    n - (a - v) / e
  ];
}
function er(r) {
  const a = [];
  for (let e = 0; e < r.length; e++) {
    const t = r[e];
    t.type === "M" || t.type === "L" ? a.push({ cmdIdx: e, field: "xy", kind: "anchor", x: t.x, y: t.y }) : t.type === "C" ? (a.push({ cmdIdx: e, field: "x1y1", kind: "handle", x: t.x1, y: t.y1 }), a.push({ cmdIdx: e, field: "x2y2", kind: "handle", x: t.x2, y: t.y2 }), a.push({ cmdIdx: e, field: "xy", kind: "anchor", x: t.x, y: t.y })) : t.type === "Q" && (a.push({ cmdIdx: e, field: "x1y1", kind: "handle", x: t.x1, y: t.y1 }), a.push({ cmdIdx: e, field: "xy", kind: "anchor", x: t.x, y: t.y }));
  }
  return a;
}
function or(r) {
  const a = [];
  let e = 0, t = 0;
  for (const n of r)
    n.type === "M" || n.type === "L" ? (e = n.x, t = n.y) : n.type === "C" ? (a.push({ x1: e, y1: t, x2: n.x1, y2: n.y1 }), a.push({ x1: n.x2, y1: n.y2, x2: n.x, y2: n.y }), e = n.x, t = n.y) : n.type === "Q" && (a.push({ x1: e, y1: t, x2: n.x1, y2: n.y1 }), a.push({ x1: n.x1, y1: n.y1, x2: n.x, y2: n.y }), e = n.x, t = n.y);
  return a;
}
function Q(r, a, e, t, n) {
  const u = Math.round(t), p = Math.round(n), h = r[a];
  let d = a, y = a;
  for (; d > 0 && r[d].type !== "M"; ) d--;
  for (; y < r.length - 1 && r[y].type !== "Z"; ) y++;
  const g = e === "xy" && h && h.type !== "Z" ? { x: h.x, y: h.y } : null;
  return r.map((s, f) => f !== a ? g && f >= d && f <= y && s.type !== "Z" && s.x === g.x && s.y === g.y ? { ...s, x: u, y: p } : s : e === "xy" && (s.type === "M" || s.type === "L") ? { ...s, x: u, y: p } : e === "xy" && (s.type === "C" || s.type === "Q") ? { ...s, x: u, y: p } : e === "x1y1" && (s.type === "C" || s.type === "Q") ? { ...s, x1: u, y1: p } : e === "x2y2" && s.type === "C" ? { ...s, x2: u, y2: p } : s);
}
const X = typeof Intl < "u" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
function ir(r) {
  const a = /* @__PURE__ */ new Set();
  return (X ? Array.from(X.segment(r), (t) => t.segment) : Array.from(r)).filter((t) => !t.trim() || a.has(t) ? !1 : (a.add(t), !0));
}
function lr({
  commands: r,
  font: a,
  char: e,
  onChange: t,
  onDragStart: n
}) {
  const u = D(null), p = D(null), h = a._font, d = h.charToGlyphIndex(e), y = h.glyphs.get(d), g = (y == null ? void 0 : y.leftSideBearing) ?? 0, s = (y == null ? void 0 : y.advanceWidth) ?? h.unitsPerEm, f = h.ascender, w = h.descender, P = s, I = f - w, M = R - 2 * v, b = Math.min(M / P, M / I), E = v + f * b, F = J((i) => {
    const o = u.current;
    if (!o) return [0, 0];
    const l = o.getScreenCTM();
    if (!l) return [0, 0];
    const c = o.createSVGPoint();
    c.x = i.clientX, c.y = i.clientY;
    const m = c.matrixTransform(l.inverse());
    return nr(m.x, m.y, b, g, f);
  }, [b, g, f]);
  function $(i, o, l) {
    i.isPrimary && (i.stopPropagation(), i.target.setPointerCapture(i.pointerId), n(r), p.current = { cmdIdx: o, field: l });
  }
  function C(i) {
    if (!p.current) return;
    const [o, l] = F(i);
    t(Q(r, p.current.cmdIdx, p.current.field, o, l));
  }
  function T() {
    p.current = null;
  }
  function B(i, o, l, c, m) {
    const k = i.shiftKey ? 10 : 1, K = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[i.key];
    K && (i.preventDefault(), n(r), t(Q(r, o, l, c + K[0], m + K[1])));
  }
  const L = j(r), z = er(r), H = or(r);
  return /* @__PURE__ */ G(
    "svg",
    {
      ref: u,
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
      "aria-label": `Glyph path editor for character ${e}. Tab to a point, then use the arrow keys to move it (Shift for 10 units).`,
      children: [
        /* @__PURE__ */ x(
          "line",
          {
            x1: v / 2,
            y1: E,
            x2: R - v / 2,
            y2: E,
            stroke: "rgba(255,255,255,0.08)",
            strokeWidth: 1
          }
        ),
        (() => {
          const [i] = W(s, 0, b, g, f);
          return /* @__PURE__ */ x(
            "line",
            {
              x1: i,
              y1: v / 2,
              x2: i,
              y2: R - v / 2,
              stroke: "rgba(255,255,255,0.08)",
              strokeWidth: 1,
              strokeDasharray: "4 4"
            }
          );
        })(),
        /* @__PURE__ */ x("g", { transform: `translate(${v + (0 - g) * b}, ${v + f * b}) scale(${b}, ${-b})`, children: r.length > 0 && /* @__PURE__ */ x(
          "path",
          {
            d: L,
            fill: "rgba(53,221,226,0.12)",
            stroke: "rgba(53,221,226,0.55)",
            strokeWidth: 2 / b,
            fillRule: "nonzero"
          }
        ) }),
        H.map((i, o) => {
          const [l, c] = W(i.x1, i.y1, b, g, f), [m, k] = W(i.x2, i.y2, b, g, f);
          return /* @__PURE__ */ x(
            "line",
            {
              x1: l,
              y1: c,
              x2: m,
              y2: k,
              stroke: "rgba(255,255,255,0.18)",
              strokeWidth: 1,
              strokeDasharray: "3 3"
            },
            o
          );
        }),
        z.map((i, o) => {
          const [l, c] = W(i.x, i.y, b, g, f), m = i.kind === "anchor" ? rr : tr;
          return /* @__PURE__ */ x(
            "circle",
            {
              role: "button",
              "aria-label": `${i.kind === "anchor" ? "Anchor" : "Handle"} point ${o + 1} of ${z.length}, x ${Math.round(i.x)}, y ${Math.round(i.y)}`,
              tabIndex: 0,
              onKeyDown: (k) => B(k, i.cmdIdx, i.field, i.x, i.y),
              cx: l,
              cy: c,
              r: m,
              fill: i.kind === "anchor" ? "rgba(53,221,226,0.9)" : "rgba(0,0,0,0)",
              stroke: "rgba(53,221,226,0.75)",
              strokeWidth: 1.5,
              style: { cursor: "grab" },
              onPointerDown: (k) => $(k, i.cmdIdx, i.field)
            },
            o
          );
        }),
        r.length === 0 && /* @__PURE__ */ x(
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
  text: e = "Typography",
  children: t,
  selectedChar: n,
  onClose: u,
  onApply: p,
  hidePalette: h = !1
}) {
  const [d, y] = A(null), [g, s] = A([]), [f, w] = A([]), P = D(null), I = D(null), [M, b] = A(null), E = D(null), F = ir(e), $ = f.length > 0;
  S(() => () => {
    P.current && (_(P.current), P.current = null);
  }, []), S(() => {
    I.current = d;
  }, [d]);
  const C = D(r);
  S(() => {
    C.current !== r && (C.current = r, I.current !== null && n === void 0 ? (y(null), s([]), w([])) : I.current !== null && r && (s(N(r, I.current)), w([])));
  }, [r, n]), S(() => {
    var o, l, c;
    d && ((c = (l = (o = E.current) == null ? void 0 : o.querySelector("circle")) == null ? void 0 : l.focus) == null || c.call(l));
  }, [d]), S(() => {
    if (n === void 0 || !r) return;
    const o = I.current;
    n === null ? o !== null && (y(null), s([]), w([])) : n !== o && (s(N(r, n)), y(n), w([]));
  }, [n, r]);
  function T() {
    if (f.length === 0) return;
    const o = f[f.length - 1];
    w((l) => l.slice(0, -1)), s(o);
  }
  function B(o) {
    w((l) => {
      const c = [...l, o];
      return c.length > Z ? c.slice(-Z) : c;
    });
  }
  const L = D(T);
  S(() => {
    L.current = T;
  }), S(() => {
    if (!d) return;
    function o(l) {
      var U;
      const c = l.target, m = !!c && !!((U = E.current) != null && U.contains(c)), k = !c || c === document.body || c === document.documentElement;
      !m && !k || (l.metaKey || l.ctrlKey) && !l.shiftKey && l.key === "z" && (l.preventDefault(), L.current());
    }
    return window.addEventListener("keydown", o), () => window.removeEventListener("keydown", o);
  }, [d]);
  function z(o) {
    r && (s(N(r, o)), y(o), w([]));
  }
  function H() {
    y(null), s([]), w([]), u == null || u();
  }
  function i() {
    if (!r || !d) return;
    let o;
    try {
      O(r, d, g);
      const l = V(r);
      o = q(a, l, P.current ?? void 0);
    } catch (l) {
      b(l instanceof Error ? l.message : String(l));
      return;
    }
    b(null), P.current = o, p == null || p(d, [...g]), y(null), s([]), w([]), u == null || u();
  }
  return /* @__PURE__ */ G("div", { children: [
    (t != null || !h) && /* @__PURE__ */ x("div", { style: { fontFamily: a }, children: t ?? /* @__PURE__ */ x("p", { children: e }) }),
    r && !h && /* @__PURE__ */ x(
      "div",
      {
        role: "group",
        "aria-label": "Character palette — click to edit",
        style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "16px" },
        children: F.map((o) => /* @__PURE__ */ x(
          "button",
          {
            onClick: () => z(o),
            "aria-pressed": d === o,
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
              background: d === o ? "rgba(53,221,226,0.15)" : "transparent",
              cursor: "pointer",
              color: "inherit",
              transition: "background 0.15s"
            },
            children: o
          },
          o
        ))
      }
    ),
    d && r && /* @__PURE__ */ G(
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
          /* @__PURE__ */ G("p", { style: { fontSize: 11, opacity: 0.5, marginBottom: 12, fontFamily: "sans-serif" }, children: [
            "Editing “",
            d,
            "” — drag filled circles (anchors) or outlined circles (handles) to reshape"
          ] }),
          /* @__PURE__ */ x(
            lr,
            {
              commands: g,
              font: r,
              char: d,
              onChange: s,
              onDragStart: B
            }
          ),
          /* @__PURE__ */ G("div", { style: { display: "flex", gap: 8, marginTop: 12, alignItems: "center" }, children: [
            /* @__PURE__ */ x(
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
            /* @__PURE__ */ x(
              "button",
              {
                onClick: T,
                disabled: !$,
                title: "Undo last drag (Ctrl+Z / Cmd+Z)",
                style: {
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.3)",
                  background: "transparent",
                  color: "inherit",
                  opacity: $ ? 0.7 : 0.25,
                  cursor: $ ? "pointer" : "default",
                  transition: "opacity 0.15s"
                },
                children: "Undo"
              }
            ),
            /* @__PURE__ */ x(
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
          M && /* @__PURE__ */ x("p", { role: "alert", style: { marginTop: 8, fontSize: 12, fontFamily: "sans-serif" }, children: M })
        ]
      }
    ),
    !r && /* @__PURE__ */ x("p", { style: { marginTop: 12, fontSize: 12, opacity: 0.4, fontFamily: "sans-serif" }, children: "No font loaded." })
  ] });
}
export {
  dr as GlyphShaperEditor,
  lr as GlyphSvgEditor,
  q as applyFontBlob,
  j as commandsToPathD,
  pr as compareFontTables,
  V as fontToBlob,
  hr as getFontSource,
  N as getGlyphCommands,
  xr as getWriteInfo,
  Y as parseFont,
  _ as revokeFont,
  O as setGlyphCommands,
  cr as useGlyphFont
};
