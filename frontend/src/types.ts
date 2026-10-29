// Mirrors src/heppad/spec/models.py (as sent by the server: all fields present).

export interface Ref {
  file: string;
  path: string;
}
export type RefLike = Ref | Ref[];

export interface ShapeSyst {
  kind: "shape";
  up: string;
  down: string | null;
  sources: string[] | null;
  exclude: string[];
  file: string | null;
}

export interface NormSyst {
  kind: "norm";
  source: string;
  up: number;
  down: number | null;
}

export interface EnvelopeSyst {
  kind: "envelope";
  source: string;
  variations: string[];
  path: string;
  file: string | null;
}

export type Systematic = ShapeSyst | NormSyst | EnvelopeSyst;
export type Symmetrize = "none" | "max" | "average";
/** A preset, or items added in quadrature: "stat", "syst", group names ("Other" = ungrouped) or source names. */
export type BandContent = "stat" | "syst" | "total" | string[];
/** {group: [regex, ...]} matched against systematic source names. */
export type SystGroups = Record<string, string[]>;

export interface HistOps {
  flow: "none" | "fold";
  rebin: number | number[] | null;
  xrange: [number, number] | null;
  scale: number;
  normalize: boolean;
}

interface LayerBase {
  id: string;
  visible: boolean;
  zorder: number | null;
}

export interface HistogramLayer extends LayerBase, HistOps {
  kind: "histogram";
  ref: RefLike;
  histtype: "step" | "fill" | "errorbar" | "band";
  label: string | null;
  color: string | null;
  linewidth: number | null;
  linestyle: string | null;
  alpha: number | null;
  hatch: string | null;
  marker: string | null;
  markersize: number | null;
  yerr: "auto" | "sumw2" | "poisson" | "none";
  xerr: boolean;
  binwnorm: number | null;
  systematics: Systematic[];
  symmetrize: Symmetrize;
  syst_groups: SystGroups;
}

export interface StackMember extends HistOps {
  ref: RefLike;
  label: string | null;
  color: string | null;
  edgecolor: string | null;
  hatch: string | null;
  systematics: Systematic[];
}

export interface StackLayer extends LayerBase {
  kind: "stack";
  members: StackMember[];
  histtype: "fill" | "step";
  linewidth: number | null;
  alpha: number | null;
  binwnorm: number | null;
  systematics: Systematic[];
  symmetrize: Symmetrize;
  syst_groups: SystGroups;
}

export interface ErrorBandLayer extends LayerBase {
  kind: "errorband";
  of: string;
  content: BandContent;
  relative: boolean;
  style: "fill" | "lines";
  linewidth: number | null;
  linestyle: string | null;
  label: string | null;
  hatch: string | null;
  color: string;
  facecolor: string;
  alpha: number | null;
}

export interface GraphLayer extends LayerBase {
  kind: "graph";
  ref: Ref;
  label: string | null;
  color: string | null;
  marker: string | null;
  markersize: number | null;
  linestyle: string | null;
  linewidth: number | null;
  xerr: boolean;
  yerr: boolean;
  capsize: number | null;
}

export interface Hist2DLayer extends LayerBase {
  kind: "hist2d";
  ref: RefLike;
  cmap: string | null;
  logz: boolean;
  zrange: [number, number] | null;
  cbar: boolean;
  cbar_label: string | null;
  cmin: number | null;
  bin_labels: boolean;
  bin_labels_format: string;
  scale: number;
}

export interface RatioLayer extends LayerBase {
  kind: "ratio";
  num: string;
  den: string;
  histtype: "errorbar" | "step";
  label: string | null;
  color: string | null;
  marker: string | null;
  markersize: number | null;
  den_band: boolean;
  den_band_content: BandContent;
  den_band_hatch: string | null;
  den_band_color: string;
}

export interface PullLayer extends LayerBase {
  kind: "pull";
  num: string;
  den: string;
  color: string | null;
  label: string | null;
}

export type Layer =
  | HistogramLayer
  | StackLayer
  | ErrorBandLayer
  | GraphLayer
  | Hist2DLayer
  | RatioLayer
  | PullLayer;

export interface TextAnnotation {
  kind: "text";
  text: string;
  xy: [number, number];
  coords: "axes" | "data";
  fontsize: number | null;
  color: string | null;
  ha: "left" | "center" | "right";
  va: "top" | "center" | "bottom" | "baseline";
  rotation: number;
  fontweight: "normal" | "bold";
  fontstyle: "normal" | "italic";
}

export interface LineAnnotation {
  kind: "hline" | "vline";
  at: number;
  color: string;
  linestyle: string;
  linewidth: number;
}

export type Annotation = TextAnnotation | LineAnnotation;

export interface Axis {
  label: string | null;
  range: [number, number] | null;
  log: boolean;
  label_loc: string | null;
  ticklabels: boolean;
}

export interface Legend {
  show: boolean;
  loc: string;
  bbox: [number, number] | null;
  ncol: number;
  fontsize: number | null;
  frameon: boolean | null;
  title: string | null;
  order: string[] | null;
  reverse: boolean;
}

export interface ExpLabel {
  show: boolean;
  experiment: "CMS" | "ATLAS" | "LHCb" | "ALICE";
  text: string;
  data: boolean;
  lumi: number | string | null;
  com: number | string | null;
  year: string | number | null;
  loc: number;
  rlabel: string | null;
  llabel: string | null;
  fontsize: number | null;
}

export interface Pad {
  id: string;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  sharex: string | null;
  label: ExpLabel | null;
  xaxis: Axis;
  yaxis: Axis;
  legend: Legend;
  layers: Layer[];
  annotations: Annotation[];
}

export interface Margins {
  left: number | null;
  right: number | null;
  top: number | null;
  bottom: number | null;
}

export interface Layout {
  rows: number;
  cols: number;
  height_ratios: number[] | null;
  width_ratios: number[] | null;
  margins: Margins;
  hspace: number | null;
  wspace: number | null;
}

export interface Canvas {
  width: number;
  height: number;
  dpi: number;
}

export type Style = "CMS" | "ATLAS" | "LHCb2" | "ALICE" | "ROOT";

export interface PlotSpec {
  version: number;
  style: Style;
  inputs: Record<string, string>;
  canvas: Canvas;
  layout: Layout;
  pads: Pad[];
}

// ---------------------------------------------------------------- API shapes

/** [x0, y0, x1, y1] as fractions of the canvas, origin top-left. */
export type BBox = [number, number, number, number];

export interface EffectiveLayout {
  margins: { left: number; right: number; top: number; bottom: number };
  hspace: number;
  wspace: number;
}

export interface RenderResponse {
  svg: string;
  elements: Record<string, { bbox: BBox }>;
  axes: Record<string, { bbox: BBox; xlim: [number, number]; ylim: [number, number]; xlog: boolean; ylog: boolean }>;
  warnings: string[];
  systematics: Record<string, SystBreakdown>;
  layout: EffectiveLayout;
}

/** Relative uncertainties: yield-weighted average (up/down) and largest single bin (_max). */
export interface SystSummary {
  up: number;
  down: number;
  up_max: number;
  down_max: number;
}

export interface SystBreakdown {
  sources: (SystSummary & { source: string })[];
  /** Empty unless the layer defines syst_groups. */
  groups: (SystSummary & { group: string; sources: string[] })[];
  stat: SystSummary;
  /** All systematics. */
  total: SystSummary;
  /** Stat and syst in quadrature. */
  combined: SystSummary;
  missing: [string, string][];
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "dir" | "root" | "spec";
}

export interface RootObject {
  path: string;
  classname: string;
  kind: "h1" | "h2" | "graph" | "dir" | "other";
}

export interface Preview {
  kind: "h1" | "h2" | "graph";
  nbins?: number | number[];
  npoints?: number;
  xmin: number;
  xmax: number;
  ymin?: number;
  ymax?: number;
  integral?: number;
  values?: number[];
}

export interface LoadedSpec {
  path: string;
  base_dir: string;
  spec: PlotSpec;
}
