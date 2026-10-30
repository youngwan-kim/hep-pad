import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { addObject, type AddMode } from "../actions";
import { gidBase, parseGid, selectionGid, type Selection } from "../spec";
import { useStore } from "../store";
import type { BBox, PlotSpec, RenderResponse, RootObject } from "../types";
import { LayoutHandles } from "./LayoutHandles";

export const DRAG_MIME = "application/x-heppad-object";
export interface DragPayload {
  file: string;
  obj: RootObject;
  mode: AddMode;
}

const PX_PER_INCH = 96;
type Zoom = "fit" | number;

interface Drag {
  gid: string;
  sel: Selection;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
}

/** Which tagged element (if any) an SVG node belongs to. */
function hitGid(target: EventTarget | null, root: Element, render: RenderResponse): string | null {
  let el = target as Element | null;
  while (el && el !== root) {
    if (el.id) {
      const base = gidBase(el.id);
      if (base in render.elements) return base;
    }
    el = el.parentElement;
  }
  return null;
}

function padAt(fx: number, fy: number, render: RenderResponse): string | null {
  for (const [id, a] of Object.entries(render.axes)) {
    const [x0, y0, x1, y1] = a.bbox;
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) return id;
  }
  return null;
}

/** Elements that can be dragged to a new position. */
function draggable(sel: Selection | null, spec: PlotSpec): boolean {
  if (!sel) return false;
  if (sel.type === "legend") return true;
  if (sel.type === "xlabel" || sel.type === "ylabel" || sel.type === "label" || sel.type === "lumi") return true;
  if (sel.type === "annotation") {
    const a = spec.pads.find((p) => p.id === sel.pad)?.annotations[sel.index];
    return a?.kind === "text";
  }
  return false;
}

export function CanvasView() {
  const spec = useStore((s) => s.spec);
  const render = useStore((s) => s.render);
  const selection = useStore((s) => s.selection);
  const renderErrors = useStore((s) => s.renderErrors);
  const rendering = useStore((s) => s.rendering);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);

  const areaRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [area, setArea] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const [dropPad, setDropPad] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [spec === null]);

  // A drag preview moves the SVG groups of the dragged element; reset when a new render arrives.
  useEffect(() => setDrag(null), [render]);

  if (!spec) return <div className="canvas-area empty" />;

  const natW = spec.canvas.width * PX_PER_INCH;
  const natH = spec.canvas.height * PX_PER_INCH;
  const scale = zoom === "fit" ? Math.min((area.w - 48) / natW, (area.h - 48) / natH) : zoom;
  const W = Math.max(50, natW * scale);
  const H = Math.max(50, natH * scale);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };

  const svgGroups = (gid: string) =>
    Array.from(svgRef.current?.querySelectorAll<SVGElement>("[id]") ?? []).filter(
      (el) => gidBase(el.id) === gid,
    );

  /** Move SVG groups by a screen offset (converted to SVG user units). */
  const previewMove = (gid: string, dx: number, dy: number) => {
    const svg = svgRef.current?.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const kx = vb.width / W, ky = vb.height / H;
    for (const el of svgGroups(gid)) el.style.transform = `translate(${dx * kx}px, ${dy * ky}px)`;
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (!render || e.button !== 0) return;
    const gid = hitGid(e.target, svgRef.current!, render);
    let sel: Selection | null = gid ? parseGid(gid, spec) : null;
    if (!sel) {
      const [fx, fy] = frac(e);
      const p = padAt(fx, fy, render);
      sel = p ? { type: "pad", pad: p } : { type: "canvas" };
    }
    select(sel);
    if (gid && draggable(sel, spec)) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ gid, sel, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
    }
  };

  const onPointerMove = (e: RPointerEvent) => {
    if (!render) return;
    if (drag) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      const moved = drag.moved || Math.hypot(dx, dy) > 3;
      if (moved) previewMove(drag.gid, dx, dy);
      setDrag({ ...drag, dx, dy, moved });
      return;
    }
    const gid = hitGid(e.target, svgRef.current!, render);
    if (gid) setHover(gid);
    else {
      const [fx, fy] = frac(e);
      const p = padAt(fx, fy, render);
      setHover(p ? `pad:${p}` : null);
    }
  };

  const onPointerUp = () => {
    if (!drag || !render) return;
    if (!drag.moved) {
      setDrag(null);
      return;
    }
    commitDrag(drag, W, H, render, spec, update);
    // Keep the preview offset until the new render replaces the SVG.
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!render || !e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    const [fx, fy] = frac(e);
    setDropPad(padAt(fx, fy, render));
  };

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    setDropPad(null);
    if (!raw || !render) return;
    e.preventDefault();
    const [fx, fy] = frac(e);
    const pad = padAt(fx, fy, render) ?? undefined;
    const p = JSON.parse(raw) as DragPayload;
    addObject(p.file, p.obj, p.mode, pad);
  };

  const box = (b: BBox, cls: string, key?: string) => (
    <div key={key} className={cls}
      style={{ left: b[0] * W - 3, top: b[1] * H - 3, width: (b[2] - b[0]) * W + 6, height: (b[3] - b[1]) * H + 6,
               transform: drag && cls.includes("selected") ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }} />
  );

  const selGid = selection ? selectionGid(selection) : null;
  const selBox: BBox | undefined =
    selection?.type === "pad" ? render?.axes[selection.pad]?.bbox : selGid ? render?.elements[selGid]?.bbox : undefined;
  const hoverBox: BBox | undefined = hover?.startsWith("pad:")
    ? render?.axes[hover.slice(4)]?.bbox
    : hover ? render?.elements[hover]?.bbox : undefined;
  const canDrag = draggable(selection, spec);
  // Margin and panel-size handles, while the canvas or a pad (rather than something in it) is selected.
  const showLayout = !!render && !drag && (selection?.type === "canvas" || selection?.type === "pad");

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className={zoom === "fit" ? "active" : ""} onClick={() => setZoom("fit")}>Fit</button>
        <button onClick={() => setZoom(Math.max(0.1, scale / 1.25))}>−</button>
        <span className="muted">{Math.round(scale * 100)}%</span>
        <button onClick={() => setZoom(Math.min(4, scale * 1.25))}>+</button>
        <button onClick={() => setZoom(1)}>100%</button>
        <span className="spacer" />
        <span className="muted">
          {spec.canvas.width}×{spec.canvas.height} in · {spec.style}
          {rendering && " · rendering…"}
        </span>
      </div>
      <div className="canvas-area" ref={areaRef}
        onPointerDown={(e) => e.target === e.currentTarget && select({ type: "canvas" })}>
        {renderErrors && (
          <div className="banner error">
            <b>Cannot draw this:</b>
            <ul>{renderErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>
            <span className="muted">Showing the last valid version. Undo (⌘Z) to go back.</span>
          </div>
        )}
        {render && render.warnings.length > 0 && (
          <div className="banner warning">
            <ul>{render.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        <div className="page" style={{ width: W, height: H }}
          onDragOver={onDragOver} onDragLeave={() => setDropPad(null)} onDrop={onDrop}>
          <div
            ref={svgRef}
            className={`svg ${canDrag ? "can-drag" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            dangerouslySetInnerHTML={{ __html: render?.svg ?? "" }}
          />
          {!render && <div className="placeholder">Drawing…</div>}
          <div className="overlay">
            {hoverBox && hover !== selGid && !drag && box(hoverBox, "hover-box")}
            {selBox && box(selBox, `selected-box${canDrag ? " draggable" : ""}`)}
            {dropPad && render?.axes[dropPad] && box(render.axes[dropPad].bbox, "drop-box")}
            {showLayout && <LayoutHandles spec={spec} eff={render!.layout} W={W} H={H} />}
            {render && spec.pads.every((p) => p.layers.length === 0) &&
              Object.entries(render.axes).map(([id, a]) => (
                <div key={id} className="empty-pad-hint"
                  style={{ left: a.bbox[0] * W, top: a.bbox[1] * H, width: (a.bbox[2] - a.bbox[0]) * W, height: (a.bbox[3] - a.bbox[1]) * H }}>
                  Drag a histogram here from the browser
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Turn a finished drag (screen pixels) into a spec change. */
function commitDrag(
  drag: Drag, W: number, H: number, render: RenderResponse, spec: PlotSpec,
  update: (m: (s: PlotSpec) => void, key?: string) => void,
) {
  const sel = drag.sel;
  if (!["legend", "annotation", "xlabel", "ylabel", "label", "lumi"].includes(sel.type) || !("pad" in sel)) return;
  const ax = render.axes[sel.pad];
  if (!ax) return;
  const [ax0, ay0, ax1, ay1] = ax.bbox;
  const dxAx = drag.dx / W / (ax1 - ax0);
  const dyAx = -drag.dy / H / (ay1 - ay0); // screen y grows downwards, axes y upwards
  const r4 = (v: number) => Math.round(v * 10000) / 10000;

  if (sel.type === "label" || sel.type === "lumi") {
    // Shift from mplhep's own placement; the lumi text moves separately.
    const key = sel.type === "label" ? "offset" : "lumi_offset";
    update((s) => {
      const label = s.pads.find((p) => p.id === sel.pad)!.label;
      if (!label) return;
      const [x, y] = label[key] ?? [0, 0];
      label[key] = [r4(x + dxAx), r4(y + dyAx)];
    });
    return;
  }

  if (sel.type === "xlabel" || sel.type === "ylabel") {
    // Move the title's anchor (where matplotlib put it, or where it was dragged before).
    const [x, y] = ax[sel.type];
    update((s) => {
      const pad = s.pads.find((p) => p.id === sel.pad)!;
      pad[sel.type === "xlabel" ? "xaxis" : "yaxis"].label_pos = [r4(x + dxAx), r4(y + dyAx)];
    });
    return;
  }

  if (sel.type === "legend") {
    const b = render.elements[drag.gid]?.bbox;
    if (!b) return;
    // New upper-left corner of the legend frame, in axes fraction.
    const x = (b[0] + drag.dx / W - ax0) / (ax1 - ax0);
    const y = (ay1 - (b[1] + drag.dy / H)) / (ay1 - ay0);
    update((s) => {
      const lg = s.pads.find((p) => p.id === sel.pad)!.legend;
      lg.loc = "upper left";
      lg.bbox = [r4(x), r4(y)];
    });
    return;
  }

  if (sel.type !== "annotation") return;
  const index = sel.index;
  const ann = spec.pads.find((p) => p.id === sel.pad)?.annotations[index];
  if (!ann || ann.kind !== "text") return;
  const shift = (v: number, d: number, lim: [number, number], log: boolean) =>
    log ? v * Math.pow(lim[1] / lim[0], d) : v + d * (lim[1] - lim[0]);
  const xy: [number, number] = ann.coords === "axes"
    ? [r4(ann.xy[0] + dxAx), r4(ann.xy[1] + dyAx)]
    : [shift(ann.xy[0], dxAx, ax.xlim, ax.xlog), shift(ann.xy[1], dyAx, ax.ylim, ax.ylog)].map(
        (v) => Number(v.toPrecision(5)),
      ) as [number, number];
  update((s) => {
    const a = s.pads.find((p) => p.id === sel.pad)!.annotations[index];
    if (a.kind === "text") a.xy = xy;
  });
}
