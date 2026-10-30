// Spec factories and helpers. Defaults mirror src/heppad/spec/models.py.
import type {
  Annotation,
  Axis,
  EffectiveLayout,
  ExpLabel,
  HistogramLayer,
  Hist2DLayer,
  GraphLayer,
  Layer,
  Layout,
  Legend,
  Pad,
  PlotSpec,
  Ref,
  StackLayer,
  StackMember,
  Style,
  Systematic,
  BandContent,
} from "./types";

// Petroff 10-colour palette (recommended for CMS plots).
export const PALETTE = [
  "#3f90da", "#ffa90e", "#bd1f01", "#94a4a2", "#832db6",
  "#a96b59", "#e76300", "#b9ac70", "#717581", "#92dadd",
];

export const axis = (over: Partial<Axis> = {}): Axis => ({
  label: null, range: null, log: false, label_loc: null, label_pos: null, ticklabels: true, ...over,
});

export const legend = (): Legend => ({
  show: true, loc: "best", bbox: null, ncol: 1, fontsize: null, frameon: null,
  title: null, order: null, reverse: false,
});

export const expLabel = (over: Partial<ExpLabel> = {}): ExpLabel => ({
  show: true, experiment: "CMS", text: "Preliminary", data: true, lumi: null, com: 13,
  year: null, loc: 0, rlabel: null, llabel: null, fontsize: null, offset: null, lumi_offset: null, ...over,
});

export const pad = (id: string, over: Partial<Pad> = {}): Pad => ({
  id, row: 0, col: 0, rowspan: 1, colspan: 1, sharex: null, label: null,
  xaxis: axis(), yaxis: axis(), legend: legend(), layers: [], annotations: [], ...over,
});

const ops = { flow: "none" as const, rebin: null, xrange: null, scale: 1, normalize: false };
const base = (id: string) => ({ id, visible: true, zorder: null });

export const histogram = (id: string, ref: Ref, over: Partial<HistogramLayer> = {}): HistogramLayer => ({
  ...base(id), ...ops, kind: "histogram", ref, histtype: "step", label: null, color: null,
  linewidth: null, linestyle: null, alpha: null, hatch: null, marker: null, markersize: null,
  yerr: "auto", xerr: false, binwnorm: null, systematics: [], symmetrize: "none", syst_groups: {}, ...over,
});

export const stackMember = (ref: Ref, over: Partial<StackMember> = {}): StackMember => ({
  ...ops, ref, label: null, color: null, edgecolor: null, hatch: null, systematics: [], ...over,
});

export const stack = (id: string, members: StackMember[] = []): StackLayer => ({
  ...base(id), kind: "stack", members, histtype: "fill", linewidth: null, alpha: null, binwnorm: null,
  systematics: [], symmetrize: "none", syst_groups: {},
});

export const shapeSyst = (): Systematic => ({
  kind: "shape", up: "{path}_{source}Up", down: "{path}_{source}Down", sources: null, exclude: [], file: null,
});
export const normSyst = (source = "lumi"): Systematic => ({ kind: "norm", source, up: 0.016, down: null });
export const envelopeSyst = (): Systematic => ({
  kind: "envelope", source: "scale", variations: [], path: "{path}_{variation}", file: null,
});

/** Default band labels; a band still carrying one is relabelled when its content changes. */
export const BAND_LABELS: Record<"stat" | "syst" | "total", string> = {
  stat: "Stat. unc.",
  syst: "Syst. unc.",
  total: "Stat. $\\oplus$ syst. unc.",
};

/** Band content as a list of items added in quadrature. */
export function contentItems(c: BandContent): string[] {
  if (Array.isArray(c)) return c;
  return { stat: ["stat"], syst: ["syst"], total: ["stat", "syst"] }[c];
}

/** Store presets by name so the YAML stays readable. */
export function contentValue(items: string[]): BandContent {
  const key = [...items].sort().join("+");
  if (key === "stat") return "stat";
  if (key === "syst") return "syst";
  if (key === "stat+syst") return "total";
  return items;
}

export function defaultBandLabel(c: BandContent): string | null {
  return Array.isArray(c) ? null : BAND_LABELS[c];
}

/** Does a histogram/stack layer define any systematics? */
export function hasSystematics(l: Layer): boolean {
  if (l.kind === "histogram") return l.systematics.length > 0;
  if (l.kind === "stack") return l.systematics.length > 0 || l.members.some((m) => m.systematics.length > 0);
  return false;
}

export const graph = (id: string, ref: Ref, over: Partial<GraphLayer> = {}): GraphLayer => ({
  ...base(id), kind: "graph", ref, label: null, color: null, marker: "o", markersize: null,
  linestyle: "none", linewidth: null, xerr: true, yerr: true, capsize: null, ...over,
});

export const hist2d = (id: string, ref: Ref): Hist2DLayer => ({
  ...base(id), kind: "hist2d", ref, cmap: null, logz: false, zrange: null, cbar: true,
  cbar_label: null, cmin: null, bin_labels: false, bin_labels_format: "{:.2f}", scale: 1,
});

export const textAnnotation = (xy: [number, number] = [0.05, 0.9]): Annotation => ({
  kind: "text", text: "Text", xy, coords: "axes", fontsize: null, color: null, ha: "left",
  va: "top", rotation: 0, fontweight: "normal", fontstyle: "normal",
});

export const lineAnnotation = (kind: "hline" | "vline", at: number): Annotation => ({
  kind, at, color: "black", linestyle: "--", linewidth: 1,
});

// ------------------------------------------------------------------ ids, refs

export function allLayers(spec: PlotSpec): Layer[] {
  return spec.pads.flatMap((p) => p.layers);
}

export function uniqueId(taken: Iterable<string>, wanted: string): string {
  const used = new Set(taken);
  const stem = wanted.replace(/\W+/g, "_").replace(/^_+|_+$/g, "") || "layer";
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i++) if (!used.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

export const uniqueLayerId = (spec: PlotSpec, wanted: string) =>
  uniqueId(allLayers(spec).map((l) => l.id), wanted);

/** Input alias for a ROOT file, adding it to spec.inputs if new (mutates spec). */
export function inputFor(spec: PlotSpec, file: string): string {
  for (const [key, path] of Object.entries(spec.inputs)) if (path === file) return key;
  const stem = file.split("/").pop()!.replace(/\.root$/, "");
  const key = uniqueId(Object.keys(spec.inputs), stem);
  spec.inputs[key] = file;
  return key;
}

export const basename = (path: string) => path.split("/").pop() ?? path;

/** Histogram/stack layers, i.e. things a ratio or band can refer to. */
export const histLayers = (spec: PlotSpec) =>
  allLayers(spec).filter((l) => l.kind === "histogram" || l.kind === "stack");

/** Legend entries a pad will show, in draw order. */
export function legendLabels(p: Pad): string[] {
  const out: string[] = [];
  for (const l of p.layers) {
    if (!l.visible) continue;
    if (l.kind === "stack") l.members.forEach((m) => m.label && out.push(m.label));
    else if ("label" in l && l.label) out.push(l.label);
  }
  return out;
}

// --------------------------------------------------------------- selections

export type Selection =
  | { type: "canvas" }
  | { type: "pad"; pad: string }
  | { type: "layer"; pad: string; layer: string }
  | { type: "member"; pad: string; layer: string; index: number }
  | { type: "annotation"; pad: string; index: number }
  | { type: "legend" | "label" | "lumi" | "xaxis" | "yaxis" | "xlabel" | "ylabel"; pad: string };

/** Strip the "@n" suffix that makes SVG ids unique. */
export const gidBase = (id: string) => id.replace(/@\d+$/, "");

/** Element path (as tagged by the renderer) -> selection. Layer ids may contain dots. */
export function parseGid(gid: string, spec: PlotSpec): Selection | null {
  const m = /^pads\.(.+?)\.(layers|annotations|legend|label|xaxis|yaxis)(?:\.(.*))?$/.exec(gid);
  if (!m) return null;
  const [, padId, what, rest] = m;
  const p = spec.pads.find((x) => x.id === padId);
  if (!p) return null;
  if (what === "annotations") return { type: "annotation", pad: padId, index: Number(rest) };
  if (what === "label" && rest === "lumi") return { type: "lumi", pad: padId };
  if ((what === "xaxis" || what === "yaxis") && rest === "label") return { type: what === "xaxis" ? "xlabel" : "ylabel", pad: padId };
  if (what === "layers" && rest) {
    for (const l of p.layers) {
      if (rest === l.id) return { type: "layer", pad: padId, layer: l.id };
      const mm = rest.startsWith(`${l.id}.members.`) && /\.members\.(\d+)$/.exec(rest);
      if (mm) return { type: "member", pad: padId, layer: l.id, index: Number(mm[1]) };
    }
    return null;
  }
  return { type: what as "legend" | "label" | "xaxis" | "yaxis", pad: padId };
}

export function selectionGid(sel: Selection): string | null {
  switch (sel.type) {
    case "canvas":
    case "pad":
      return null;
    case "layer":
      return `pads.${sel.pad}.layers.${sel.layer}`;
    case "member":
      return `pads.${sel.pad}.layers.${sel.layer}.members.${sel.index}`;
    case "annotation":
      return `pads.${sel.pad}.annotations.${sel.index}`;
    case "xlabel":
    case "ylabel":
      return `pads.${sel.pad}.${sel.type[0]}axis.label`;
    case "lumi":
      return `pads.${sel.pad}.label.lumi`;
    default:
      return `pads.${sel.pad}.${sel.type}`;
  }
}

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ layout

export type Rect = { x: number; y: number; w: number; h: number }; // canvas fraction, top-left

/** Cell rectangles of the pad grid, using matplotlib's GridSpec arithmetic. */
export function gridCells(layout: Layout, eff: EffectiveLayout): { rows: number[][]; cols: number[][] } {
  const m = eff.margins;
  const split = (n: number, total: number, space: number, ratios: number[] | null, start: number) => {
    const cell = total / (n + space * (n - 1));
    const sep = space * cell;
    const r = ratios ?? Array(n).fill(1);
    const sum = r.reduce((a, b) => a + b, 0);
    const sizes = r.map((x) => (cell * n * x) / sum);
    const out: number[][] = [];
    let pos = start;
    for (const s of sizes) {
      out.push([pos, pos + s]);
      pos += s + sep;
    }
    return out;
  };
  return {
    rows: split(layout.rows, 1 - m.top - m.bottom, eff.hspace, layout.height_ratios, m.top),
    cols: split(layout.cols, 1 - m.left - m.right, eff.wspace, layout.width_ratios, m.left),
  };
}

export function padRect(p: Pad, cells: ReturnType<typeof gridCells>): Rect | null {
  const r0 = cells.rows[p.row], r1 = cells.rows[p.row + p.rowspan - 1];
  const c0 = cells.cols[p.col], c1 = cells.cols[p.col + p.colspan - 1];
  if (!r0 || !r1 || !c0 || !c1) return null;
  return { x: c0[0], y: r0[0], w: c1[1] - c0[0], h: r1[1] - r0[0] };
}

/** Fill ``null`` margins/spacing from the style defaults. */
export function effective(layout: Layout, defaults: EffectiveLayout): EffectiveLayout {
  const m = layout.margins;
  return {
    margins: {
      left: m.left ?? defaults.margins.left,
      right: m.right ?? defaults.margins.right,
      top: m.top ?? defaults.margins.top,
      bottom: m.bottom ?? defaults.margins.bottom,
    },
    hspace: layout.hspace ?? defaults.hspace,
    wspace: layout.wspace ?? defaults.wspace,
  };
}

// ----------------------------------------------------------- canvas presets

export interface LayoutPreset {
  name: string;
  rows: number;
  cols: number;
  height_ratios: number[] | null;
  hspace: number | null;
  /** Build the pads for this preset. */
  pads: () => Pad[];
}

const withLabel = (p: Pad) => ({ ...p, label: expLabel() });

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { name: "Single", rows: 1, cols: 1, height_ratios: null, hspace: null,
    pads: () => [withLabel(pad("main"))] },
  { name: "Main + ratio", rows: 2, cols: 1, height_ratios: [3, 1], hspace: 0.07,
    pads: () => [
      withLabel(pad("main", { xaxis: axis({ ticklabels: false }) })),
      pad("ratio", { row: 1, sharex: "main", yaxis: axis({ label: "Data / MC", range: [0.5, 1.5] }) }),
    ] },
  { name: "Main + ratio + pull", rows: 3, cols: 1, height_ratios: [3, 1, 1], hspace: 0.07,
    pads: () => [
      withLabel(pad("main", { xaxis: axis({ ticklabels: false }) })),
      pad("ratio", { row: 1, sharex: "main", xaxis: axis({ ticklabels: false }),
                     yaxis: axis({ label: "Data / MC", range: [0.5, 1.5] }) }),
      pad("pull", { row: 2, sharex: "main", yaxis: axis({ label: "Pull", range: [-3, 3] }) }),
    ] },
];

/** Pads for a plain rows x cols grid, keeping existing pads that still fit. */
export function gridPads(rows: number, cols: number, existing: Pad[] = []): Pad[] {
  const kept = existing.filter((p) => p.row + p.rowspan <= rows && p.col + p.colspan <= cols);
  const covered = new Set<string>();
  for (const p of kept)
    for (let r = p.row; r < p.row + p.rowspan; r++)
      for (let c = p.col; c < p.col + p.colspan; c++) covered.add(`${r},${c}`);
  const out = [...kept];
  const ids = kept.map((p) => p.id);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const id = uniqueId(ids, rows * cols === 1 ? "main" : `p${r + 1}${c + 1}`);
      ids.push(id);
      out.push(pad(id, { row: r, col: c }));
    }
  if (out.length && !out.some((p) => p.label)) out[0] = withLabel(out[0]);
  // Drop dangling sharex references to removed pads.
  const alive = new Set(out.map((p) => p.id));
  return out.map((p) => (p.sharex && !alive.has(p.sharex) ? { ...p, sharex: null } : p));
}

export function newSpec(style: Style = "CMS"): PlotSpec {
  return {
    version: 1,
    style,
    inputs: {},
    canvas: { width: 10, height: 10, dpi: 100 },
    layout: { rows: 1, cols: 1, height_ratios: null, width_ratios: null,
              margins: { left: null, right: null, top: null, bottom: null }, hspace: null, wspace: null },
    pads: [withLabel(pad("main"))],
  };
}
