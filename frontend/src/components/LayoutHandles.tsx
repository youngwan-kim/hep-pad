// Drag handles on the canvas for margins, panel sizes (row/column ratios) and the gaps between panels.
import { useEffect, useState, type PointerEvent as RPointerEvent } from "react";
import { gridCells, padRect } from "../spec";
import { useStore } from "../store";
import type { EffectiveLayout, Layout, PlotSpec } from "../types";

type Side = "left" | "right" | "top" | "bottom";
type Handle = { kind: "margin"; side: Side } | { kind: "row" | "col"; index: number };

interface Draft {
  layout: Layout;
  eff: EffectiveLayout;
  label: string;
}

const MIN_GRID = 0.1; // the pad grid keeps at least this fraction of the canvas
const MIN_SHARE = 0.08; // a panel keeps at least this share of the pair it is resized against
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sig3 = (v: number) => Number(v.toPrecision(3));

/** The layout after dragging ``h`` to canvas fraction (fx, fy), origin top-left. */
export function dragged(layout: Layout, eff: EffectiveLayout, h: Handle, fx: number, fy: number, gap: boolean): Draft {
  const next: Layout = structuredClone(layout);
  const nextEff: EffectiveLayout = structuredClone(eff);
  const m = nextEff.margins;

  if (h.kind === "margin") {
    const v = {
      left: clamp(fx, 0, 1 - m.right - MIN_GRID),
      right: clamp(1 - fx, 0, 1 - m.left - MIN_GRID),
      top: clamp(fy, 0, 1 - m.bottom - MIN_GRID),
      bottom: clamp(1 - fy, 0, 1 - m.top - MIN_GRID),
    }[h.side];
    m[h.side] = v;
    next.margins = { ...next.margins, [h.side]: r3(v) };
    return { layout: next, eff: nextEff, label: `${h.side} margin ${r3(v).toFixed(3)}` };
  }

  const rows = h.kind === "row";
  const cells = gridCells(layout, eff)[rows ? "rows" : "cols"];
  const pos = rows ? fy : fx;
  const i = h.index;
  const start = cells[i][0], end = cells[i + 1][1];
  const sep = cells[i + 1][0] - cells[i][1];

  if (gap) {
    // matplotlib has one hspace/wspace for the whole grid, in units of the average cell size.
    const n = rows ? layout.rows : layout.cols;
    const total = rows ? 1 - m.top - m.bottom : 1 - m.left - m.right;
    const width = Math.min(2 * Math.abs(pos - (cells[i][1] + sep / 2)), total / n);
    const space = clamp((width * n) / (total - width * (n - 1)), 0, 2);
    if (rows) next.hspace = nextEff.hspace = r3(space);
    else next.wspace = nextEff.wspace = r3(space);
    return { layout: next, eff: nextEff, label: `gap ${r3(space).toFixed(3)} (all ${rows ? "rows" : "columns"})` };
  }

  // Move the split between cells i and i+1; their ratio sum stays, so other cells keep their size.
  const avail = end - start - sep;
  const first = clamp(pos - sep / 2 - start, MIN_SHARE * avail, (1 - MIN_SHARE) * avail);
  const n = rows ? layout.rows : layout.cols;
  const ratios = [...((rows ? layout.height_ratios : layout.width_ratios) ?? Array(n).fill(1))];
  const sum = ratios[i] + ratios[i + 1];
  ratios[i] = sig3((sum * first) / avail);
  ratios[i + 1] = sig3(sum - ratios[i]);
  if (rows) next.height_ratios = ratios;
  else next.width_ratios = ratios;
  return { layout: next, eff: nextEff, label: `${rows ? "heights" : "widths"} ${ratios.join(" : ")}` };
}

export function LayoutHandles({ spec, eff, W, H }: { spec: PlotSpec; eff: EffectiveLayout; W: number; H: number }) {
  const update = useStore((s) => s.update);
  const [active, setActive] = useState<{ handle: Handle; draft: Draft | null; x: number; y: number } | null>(null);

  // A new render (or undo) ends any drag in progress.
  useEffect(() => setActive(null), [spec, eff]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [!!active]);

  const cells = gridCells(spec.layout, eff);
  const rows = cells.rows, cols = cells.cols;
  const gx0 = cols[0][0], gx1 = cols[cols.length - 1][1];
  const gy0 = rows[0][0], gy1 = rows[rows.length - 1][1];

  const handles: { h: Handle; x0: number; y0: number; x1: number; y1: number; title: string }[] = [
    { h: { kind: "margin", side: "left" }, x0: gx0, y0: gy0, x1: gx0, y1: gy1, title: "Drag to change the left margin" },
    { h: { kind: "margin", side: "right" }, x0: gx1, y0: gy0, x1: gx1, y1: gy1, title: "Drag to change the right margin" },
    { h: { kind: "margin", side: "top" }, x0: gx0, y0: gy0, x1: gx1, y1: gy0, title: "Drag to change the top margin" },
    { h: { kind: "margin", side: "bottom" }, x0: gx0, y0: gy1, x1: gx1, y1: gy1, title: "Drag to change the bottom margin" },
    ...rows.slice(0, -1).map((r, i) => {
      const y = (r[1] + rows[i + 1][0]) / 2;
      return { h: { kind: "row" as const, index: i }, x0: gx0, y0: y, x1: gx1, y1: y,
               title: "Drag to resize the panels above and below · Shift-drag to change the gap" };
    }),
    ...cols.slice(0, -1).map((c, i) => {
      const x = (c[1] + cols[i + 1][0]) / 2;
      return { h: { kind: "col" as const, index: i }, x0: x, y0: gy0, x1: x, y1: gy1,
               title: "Drag to resize the panels left and right · Shift-drag to change the gap" };
    }),
  ];

  const fracOf = (e: RPointerEvent) => {
    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };

  const onDown = (h: Handle) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive({ handle: h, draft: null, x: e.clientX, y: e.clientY });
  };
  const onMove = (e: RPointerEvent) => {
    if (!active) return;
    const [fx, fy] = fracOf(e);
    const draft = dragged(spec.layout, eff, active.handle, fx, fy, e.shiftKey);
    setActive({ ...active, draft, x: fx * W, y: fy * H });
  };
  const onUp = () => {
    if (!active) return;
    const draft = active.draft;
    if (!draft) return setActive(null);
    update((s) => {
      s.layout = draft.layout;
    });
    // Keep the outlines until the new render arrives (the effect above clears them).
  };

  const isActive = (h: Handle) =>
    !!active && active.handle.kind === h.kind &&
    (h.kind === "margin" ? active.handle.kind === "margin" && active.handle.side === h.side
      : active.handle.kind !== "margin" && active.handle.index === h.index);

  const draftCells = active?.draft ? gridCells(active.draft.layout, active.draft.eff) : null;
  return (
    <>
      {draftCells && spec.pads.map((p) => {
        const r = padRect(p, draftCells);
        return r && (
          <div key={p.id} className="layout-draft"
            style={{ left: r.x * W, top: r.y * H, width: r.w * W, height: r.h * H }} />
        );
      })}
      {handles.map(({ h, x0, y0, x1, y1, title }) => {
        const vertical = x0 === x1;
        const key = h.kind === "margin" ? h.side : `${h.kind}${h.index}`;
        return (
          <div key={key} title={title}
            className={`layout-handle ${vertical ? "vertical" : "horizontal"} ${h.kind} ${isActive(h) ? "active" : ""}`}
            style={vertical
              ? { left: x0 * W - 4, top: y0 * H, width: 9, height: (y1 - y0) * H }
              : { left: x0 * W, top: y0 * H - 4, width: (x1 - x0) * W, height: 9 }}
            onPointerDown={onDown(h)} onPointerMove={onMove} onPointerUp={onUp}
            onLostPointerCapture={() => setActive((a) => (a && !a.draft ? null : a))} />
        );
      })}
      {active?.draft && (
        <div className="layout-label" style={{ left: active.x + 12, top: active.y + 12 }}>{active.draft.label}</div>
      )}
    </>
  );
}
