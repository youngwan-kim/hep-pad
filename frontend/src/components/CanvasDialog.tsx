// "New canvas" and "Panels & margins": canvas size, style, pad grid, margins and spacing.
import { useEffect, useState } from "react";
import {
  LAYOUT_PRESETS,
  effective,
  gridCells,
  gridPads,
  newSpec,
  padRect,
} from "../spec";
import { useStore } from "../store";
import type { EffectiveLayout, Layout, Pad, Style } from "../types";
import { NumberInput } from "./fields";

const SIZE_PRESETS: { name: string; w: number; h: number }[] = [
  { name: "Square 10×10 (mplhep default)", w: 10, h: 10 },
  { name: "Landscape 12×9", w: 12, h: 9 },
  { name: "Wide 16×9", w: 16, h: 9 },
  { name: "Tall 10×12 (with ratio)", w: 10, h: 12 },
];

const parseRatios = (text: string, n: number): number[] | null => {
  const parts = text.split(/[,:\s]+/).filter(Boolean).map(Number);
  return parts.length === n && parts.every((x) => x > 0) ? parts : null;
};

/** Keep layers etc. of existing pads whose id the new layout reuses. */
function mergePads(next: Pad[], existing: Pad[]): Pad[] {
  return next.map((p) => {
    const old = existing.find((e) => e.id === p.id);
    if (!old) return p;
    return {
      ...old, row: p.row, col: p.col, rowspan: p.rowspan, colspan: p.colspan, sharex: p.sharex,
      xaxis: { ...old.xaxis, ticklabels: p.xaxis.ticklabels },
    };
  });
}

export function CanvasDialog({ mode }: { mode: "new" | "layout" }) {
  const store = useStore();
  const existing = mode === "layout" ? store.spec : null;
  const [style, setStyle] = useState<Style>(existing?.style ?? "CMS");
  const [w, setW] = useState(existing?.canvas.width ?? 10);
  const [h, setH] = useState(existing?.canvas.height ?? 10);
  const [dpi, setDpi] = useState(existing?.canvas.dpi ?? 100);
  const [layout, setLayout] = useState<Layout>(existing?.layout ?? newSpec().layout);
  const [pads, setPads] = useState<Pad[]>(existing?.pads ?? LAYOUT_PRESETS[0].pads());
  const [preset, setPreset] = useState<string>(existing ? "" : LAYOUT_PRESETS[0].name);
  const [hText, setHText] = useState((layout.height_ratios ?? []).join(", "));
  const [wText, setWText] = useState((layout.width_ratios ?? []).join(", "));
  const [defaults, setDefaults] = useState<EffectiveLayout | null>(null);

  useEffect(() => {
    store.getDefaults(style).then(setDefaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  const applyPreset = (name: string) => {
    const p = LAYOUT_PRESETS.find((x) => x.name === name)!;
    setPreset(name);
    setLayout({ ...layout, rows: p.rows, cols: p.cols, height_ratios: p.height_ratios, width_ratios: null, hspace: p.hspace });
    setHText((p.height_ratios ?? []).join(", "));
    setWText("");
    setPads(existing ? mergePads(p.pads(), existing.pads) : p.pads());
    if (!existing && p.rows > 1 && w === 10 && h === 10) setH(12);
  };

  const setGrid = (rows: number, cols: number) => {
    setPreset("");
    const hr = parseRatios(hText, rows), wr = parseRatios(wText, cols);
    setLayout({ ...layout, rows, cols, height_ratios: hr, width_ratios: wr });
    setPads(gridPads(rows, cols, pads));
  };

  const setMargin = (k: keyof Layout["margins"]) => (v: number | null) =>
    setLayout({ ...layout, margins: { ...layout.margins, [k]: v } });

  const lostLayers = existing
    ? existing.pads.filter((p) => !pads.some((q) => q.id === p.id)).reduce((n, p) => n + p.layers.length, 0)
    : 0;

  const finish = () => {
    const finalLayout: Layout = {
      ...layout,
      height_ratios: parseRatios(hText, layout.rows),
      width_ratios: parseRatios(wText, layout.cols),
    };
    if (existing) {
      store.update((s) => {
        s.style = style;
        s.canvas = { width: w, height: h, dpi };
        s.layout = finalLayout;
        s.pads = pads;
      });
      store.setDialog(null);
    } else {
      const spec = newSpec(style);
      spec.canvas = { width: w, height: h, dpi };
      spec.layout = finalLayout;
      spec.pads = pads;
      store.openDocument(spec, null, store.startDir);
      store.select({ type: "canvas" });
    }
  };

  // Live preview of the canvas with its pads.
  const eff = defaults ? effective(layout, defaults) : null;
  const previewLayout = { ...layout, height_ratios: parseRatios(hText, layout.rows), width_ratios: parseRatios(wText, layout.cols) };
  const cells = eff ? gridCells(previewLayout, eff) : null;
  const pw = 260, ph = (pw * h) / w;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && existing && store.setDialog(null)}>
      <div className="modal wide">
        <h2>{existing ? "Panels & margins" : "New canvas"}</h2>
        <div className="dialog-grid">
          <div>
            <h3>Canvas</h3>
            <div className="chips">
              {SIZE_PRESETS.map((p) => (
                <button key={p.name} className={w === p.w && h === p.h ? "chip active" : "chip"}
                  onClick={() => { setW(p.w); setH(p.h); }}>{p.name}</button>
              ))}
            </div>
            <div className="inline-fields">
              <label>Width [in] <NumberInput value={w} nullable={false} min={1} onChange={(v) => setW(v!)} /></label>
              <label>Height [in] <NumberInput value={h} nullable={false} min={1} onChange={(v) => setH(v!)} /></label>
              <label>DPI <NumberInput value={dpi} nullable={false} min={10} onChange={(v) => setDpi(v!)} /></label>
            </div>
            <label className="row">
              <span className="row-label">Style</span>
              <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
                {["CMS", "ATLAS", "LHCb2", "ALICE", "ROOT"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>

            <h3>Panels</h3>
            <div className="chips">
              {LAYOUT_PRESETS.map((p) => (
                <button key={p.name} className={preset === p.name ? "chip active" : "chip"} onClick={() => applyPreset(p.name)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="inline-fields">
              <label>Rows <NumberInput value={layout.rows} nullable={false} integer min={1} onChange={(v) => setGrid(v!, layout.cols)} /></label>
              <label>Columns <NumberInput value={layout.cols} nullable={false} integer min={1} onChange={(v) => setGrid(layout.rows, v!)} /></label>
            </div>
            <div className="inline-fields">
              <label title="Relative heights, e.g. 3, 1">Row heights
                <input value={hText} placeholder="equal" onChange={(e) => setHText(e.target.value)} />
              </label>
              <label title="Relative widths, e.g. 2, 1">Column widths
                <input value={wText} placeholder="equal" onChange={(e) => setWText(e.target.value)} />
              </label>
            </div>
            {hText && !parseRatios(hText, layout.rows) && <p className="warning-text">Give {layout.rows} positive numbers for row heights.</p>}
            {wText && !parseRatios(wText, layout.cols) && <p className="warning-text">Give {layout.cols} positive numbers for column widths.</p>}

            <h3>Margins &amp; spacing <span className="muted">(fraction of canvas; empty = style default)</span></h3>
            <div className="inline-fields">
              {(["left", "right", "top", "bottom"] as const).map((k) => (
                <label key={k}>{k}
                  <NumberInput value={layout.margins[k]} step={0.01} min={0}
                    placeholder={defaults ? defaults.margins[k].toFixed(3) : "auto"} onChange={setMargin(k)} />
                </label>
              ))}
            </div>
            <div className="inline-fields">
              <label title="Vertical gap between pads, relative to the average pad height">Vertical gap
                <NumberInput value={layout.hspace} step={0.01} min={0} placeholder={defaults?.hspace.toFixed(2)}
                  onChange={(v) => setLayout({ ...layout, hspace: v })} />
              </label>
              <label title="Horizontal gap between pads, relative to the average pad width">Horizontal gap
                <NumberInput value={layout.wspace} step={0.01} min={0} placeholder={defaults?.wspace.toFixed(2)}
                  onChange={(v) => setLayout({ ...layout, wspace: v })} />
              </label>
            </div>
          </div>

          <div className="preview-col">
            <svg className="layout-preview" width={pw} height={ph} viewBox={`0 0 ${pw} ${ph}`}>
              <rect x={0} y={0} width={pw} height={ph} className="lp-canvas" />
              {cells && pads.map((p) => {
                const r = padRect(p, cells);
                if (!r) return null;
                return (
                  <g key={p.id}>
                    <rect x={r.x * pw} y={r.y * ph} width={r.w * pw} height={r.h * ph} className="lp-pad" />
                    <text x={(r.x + r.w / 2) * pw} y={(r.y + r.h / 2) * ph} className="lp-label">{p.id}</text>
                  </g>
                );
              })}
            </svg>
            <p className="muted small">{w}×{h} in · {pads.length} pad{pads.length === 1 ? "" : "s"}</p>
            <p className="hint">Pads can be merged across cells later (select a pad, set its row/column span).</p>
          </div>
        </div>
        {lostLayers > 0 && <p className="warning-text">{lostLayers} layer(s) in removed pads will be deleted.</p>}
        <div className="modal-actions">
          {existing && <button onClick={() => store.setDialog(null)}>Cancel</button>}
          <button className="primary" onClick={finish}>{existing ? "Apply" : "Create canvas"}</button>
        </div>
      </div>
    </div>
  );
}
