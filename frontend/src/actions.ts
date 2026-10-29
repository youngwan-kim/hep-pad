// Edit operations used by menus, the browser, the canvas and keyboard shortcuts.
import { api } from "./api";
import { useStore, validSelection } from "./store";
import {
  BAND_LABELS,
  PALETTE,
  allLayers,
  hasSystematics,
  basename,
  graph,
  hist2d,
  histogram,
  inputFor,
  lineAnnotation,
  stack,
  stackMember,
  textAnnotation,
  uniqueLayerId,
} from "./spec";
import type { BandContent, Layer, Pad, PlotSpec, RootObject } from "./types";

export type AddMode = "auto" | "step" | "fill" | "data" | "stack";

const store = () => useStore.getState();

function nextColor(spec: PlotSpec): string {
  const used = new Set<string>();
  for (const l of allLayers(spec)) {
    if (l.kind === "stack") l.members.forEach((m) => m.color && used.add(m.color));
    else if ("color" in l && l.color) used.add(l.color);
  }
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length];
}

/** Target pad: the given one, else the selected one, else the first. */
export function targetPad(spec: PlotSpec, padId?: string): Pad {
  const sel = store().selection;
  const id = padId ?? (sel && sel.type !== "canvas" ? sel.pad : undefined);
  return spec.pads.find((p) => p.id === id) ?? spec.pads[0];
}

/** Draw a ROOT object from the browser into a pad. */
export function addObject(file: string, obj: RootObject, mode: AddMode = "auto", padId?: string) {
  const { spec } = store();
  if (!spec) return;
  if (obj.kind !== "h1" && obj.kind !== "h2" && obj.kind !== "graph") {
    store().flash(`${obj.classname} objects cannot be drawn`);
    return;
  }
  let selectAfter: { pad: string; layer: string; member?: number } | null = null;
  store().update((s) => {
    const p = targetPad(s, padId);
    const ref = { file: inputFor(s, file), path: obj.path };
    const name = basename(obj.path);
    if (obj.kind === "h2") {
      const id = uniqueLayerId(s, name);
      p.layers.push(hist2d(id, ref));
      selectAfter = { pad: p.id, layer: id };
    } else if (obj.kind === "graph") {
      const id = uniqueLayerId(s, name);
      p.layers.push(graph(id, ref, { label: name, color: nextColor(s) }));
      selectAfter = { pad: p.id, layer: id };
    } else if (mode === "stack") {
      let st = p.layers.find((l) => l.kind === "stack");
      if (!st) {
        st = stack(uniqueLayerId(s, "stack"));
        // Stacks go underneath what is already drawn (data points etc.).
        p.layers.unshift(st);
      }
      if (st.kind === "stack") {
        st.members.push(stackMember(ref, { label: name, color: nextColor(s) }));
        selectAfter = { pad: p.id, layer: st.id, member: st.members.length - 1 };
      }
    } else {
      const id = uniqueLayerId(s, name);
      const data = mode === "data";
      p.layers.push(histogram(id, ref, {
        histtype: data ? "errorbar" : mode === "fill" ? "fill" : "step",
        label: data ? "Data" : name,
        color: data ? "black" : nextColor(s),
      }));
      selectAfter = { pad: p.id, layer: id };
    }
  });
  const sel = selectAfter as { pad: string; layer: string; member?: number } | null;
  if (sel)
    store().select(sel.member !== undefined
      ? { type: "member", pad: sel.pad, layer: sel.layer, index: sel.member }
      : { type: "layer", pad: sel.pad, layer: sel.layer });
}

export function addText(padId?: string) {
  let at: { pad: string; index: number } | null = null;
  store().update((s) => {
    const p = targetPad(s, padId);
    p.annotations.push(textAnnotation());
    at = { pad: p.id, index: p.annotations.length - 1 };
  });
  const a = at as { pad: string; index: number } | null;
  if (a) store().select({ type: "annotation", ...a });
}

export function addLine(kind: "hline" | "vline", padId?: string) {
  const r = store().render;
  let at: { pad: string; index: number } | null = null;
  store().update((s) => {
    const p = targetPad(s, padId);
    const lims = r?.axes[p.id]?.[kind === "hline" ? "ylim" : "xlim"];
    const mid = lims ? (lims[0] + lims[1]) / 2 : kind === "hline" ? 1 : 0;
    p.annotations.push(lineAnnotation(kind, Number(mid.toPrecision(3))));
    at = { pad: p.id, index: p.annotations.length - 1 };
  });
  const a = at as { pad: string; index: number } | null;
  if (a) store().select({ type: "annotation", ...a });
}

export function addRatio(num: string, den: string, padId: string) {
  store().update((s) => {
    // Show systematics in the ratio band when the denominator has them.
    const denLayer = allLayers(s).find((l) => l.id === den);
    const denContent: BandContent = denLayer && hasSystematics(denLayer) ? "total" : "stat";
    const p = s.pads.find((x) => x.id === padId)!;
    p.layers.push({
      id: uniqueLayerId(s, `${num}_over_${den}`), visible: true, zorder: null, kind: "ratio",
      num, den, histtype: "errorbar", label: null, color: "black", marker: null,
      markersize: null, den_band: true, den_band_content: denContent, den_band_hatch: "////",
      den_band_color: "gray",
    });
    if (!p.annotations.some((a) => a.kind === "hline" && a.at === 1))
      p.annotations.push(lineAnnotation("hline", 1));
  });
}

export function addErrorband(of: string) {
  store().update((s) => {
    const p = s.pads.find((x) => x.layers.some((l) => l.id === of))!;
    const idx = p.layers.findIndex((l) => l.id === of);
    const content: BandContent = hasSystematics(p.layers[idx]) ? "total" : "stat";
    p.layers.splice(idx + 1, 0, {
      id: uniqueLayerId(s, `${of}_unc`), visible: true, zorder: null, kind: "errorband", of, content,
      relative: false, style: "fill", label: BAND_LABELS[content as "stat" | "total"], hatch: "////",
      color: "gray", facecolor: "none", alpha: null, linewidth: null, linestyle: null,
    });
  });
}

export function toggleLabel(padId: string) {
  store().update((s) => {
    const p = s.pads.find((x) => x.id === padId)!;
    p.label = p.label ? null : {
      show: true, experiment: "CMS", text: "Preliminary", data: true, lumi: null, com: 13,
      year: null, loc: 0, rlabel: null, llabel: null, fontsize: null,
    };
  });
}

/** Layers that refer to ``id`` (ratios, pulls, bands). */
export function dependents(spec: PlotSpec, id: string): Layer[] {
  return allLayers(spec).filter(
    (l) => (l.kind === "errorband" && l.of === id) ||
           ((l.kind === "ratio" || l.kind === "pull") && (l.num === id || l.den === id)),
  );
}

export function deleteSelection() {
  const { selection: sel, spec } = store();
  if (!sel || !spec || sel.type === "canvas" || sel.type === "pad") return;
  if (sel.type === "layer") {
    const deps = dependents(spec, sel.layer);
    store().update((s) => {
      const doomed = new Set([sel.layer, ...deps.map((d) => d.id)]);
      for (const p of s.pads) p.layers = p.layers.filter((l) => !doomed.has(l.id));
    });
    if (deps.length) store().flash(`Also removed ${deps.map((d) => d.id).join(", ")}, which used ${sel.layer}`);
  } else if (sel.type === "member") {
    store().update((s) => {
      const l = s.pads.find((p) => p.id === sel.pad)!.layers.find((x) => x.id === sel.layer);
      if (l?.kind === "stack") l.members.splice(sel.index, 1);
    });
  } else if (sel.type === "annotation") {
    store().update((s) => {
      s.pads.find((p) => p.id === sel.pad)!.annotations.splice(sel.index, 1);
    });
  } else if (sel.type === "label") {
    toggleLabel(sel.pad);
  } else if (sel.type === "legend") {
    store().update((s) => {
      s.pads.find((p) => p.id === sel.pad)!.legend.show = false;
    });
  } else {
    return;
  }
  store().select(validSelection(sel, store().spec!));
}

export function moveLayer(padId: string, layerId: string, delta: number) {
  store().update((s) => {
    const p = s.pads.find((x) => x.id === padId)!;
    const i = p.layers.findIndex((l) => l.id === layerId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= p.layers.length) return;
    [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
  });
}

export function setVisible(padId: string, layerId: string, visible: boolean) {
  store().update((s) => {
    const l = s.pads.find((p) => p.id === padId)!.layers.find((x) => x.id === layerId);
    if (l) l.visible = visible;
  });
}

export function docName(): string {
  const p = store().docPath;
  return p ? basename(p).replace(/\.ya?ml$/, "") : "plot";
}

export async function exportAs(format: "pdf" | "png" | "svg" | "py" | "yaml") {
  const { spec, baseDir } = store();
  if (!spec) return;
  try {
    await api.exportFile(spec, baseDir, format, docName());
  } catch (e) {
    store().flash(String(e));
  }
}

// Light (largest band, drawn first) to dark (smallest, on top).
const NESTED_COLORS = ["#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c"];

/** Replace ``layerId``'s breakdown bands in ``padId``.
 *  nested: stat, stat + group 1, ..., total (filled, each drawn over the larger one);
 *  separate: each component on its own, drawn as lines. */
export function createBreakdownBands(layerId: string, padId: string, mode: "nested" | "separate") {
  const { spec, render } = store();
  if (!spec) return;
  const layer = allLayers(spec).find((l) => l.id === layerId);
  if (!layer || (layer.kind !== "histogram" && layer.kind !== "stack")) return;
  const groupNames = Object.keys(layer.syst_groups);
  if (render?.systematics?.[layerId]?.groups.some((g) => g.group === "Other") && !groupNames.includes("Other"))
    groupNames.push("Other");
  const components = ["stat", ...(groupNames.length ? groupNames : ["syst"])];
  const label = (c: string) => (c === "stat" ? "Stat." : c === "syst" ? "Syst." : c);
  const prefix = `${layerId}_bd_`;

  type Band = { content: string[]; label: string; color: string };
  let bands: Band[];
  if (mode === "nested") {
    const cumulative = components.map((_, i) => components.slice(0, i + 1));
    cumulative[cumulative.length - 1] = ["stat", "syst"]; // the last one is the full total
    bands = cumulative
      .map((content, i) => ({ content, label: i === 0 ? "Stat." : i === cumulative.length - 1 ? "Total" : `+ ${label(components[i])}`, color: "" }))
      .reverse(); // largest first
    // Spread the bands evenly over the colour scale.
    const last = NESTED_COLORS.length - 1;
    bands.forEach((b, i) => (b.color = NESTED_COLORS[bands.length === 1 ? last : Math.round((i * last) / (bands.length - 1))]));
  } else {
    bands = [
      ...components.map((c, i) => ({ content: [c], label: label(c), color: PALETTE[i % PALETTE.length] })),
      { content: ["stat", "syst"], label: "Total", color: "#000000" },
    ];
  }

  store().update((s) => {
    for (const p of s.pads) p.layers = p.layers.filter((l) => !l.id.startsWith(prefix));
    const pad = s.pads.find((p) => p.id === padId)!;
    const relative = !pad.layers.some((l) => l.id === layerId);
    const made: Layer[] = bands.map((b, i) => ({
      id: `${prefix}${i}`, visible: true, zorder: null, kind: "errorband", of: layerId,
      content: b.content.length === 1 && b.content[0] === "stat" ? "stat"
        : b.content.join("+") === "stat+syst" ? "total" : b.content,
      relative, style: mode === "nested" ? "fill" : "lines", label: b.label,
      hatch: null, color: b.color, facecolor: mode === "nested" ? b.color : "none", alpha: null,
      linewidth: mode === "separate" ? 1.5 : null, linestyle: null,
    }));
    // Bands go underneath ratio points / histograms already in the pad.
    const firstPoints = pad.layers.findIndex((l) => l.kind === "ratio" || l.kind === "pull" || l.kind === "histogram");
    pad.layers.splice(firstPoints < 0 ? pad.layers.length : firstPoints, 0, ...made);
    if (mode === "nested")
      for (const l of pad.layers) if (l.kind === "ratio" && l.den === layerId) l.den_band = false;
    // A short ratio pad fits the band legend best as one compact row, unless placed by hand.
    if (relative && !pad.legend.bbox && pad.legend.ncol === 1) {
      pad.legend.loc = "upper left";
      pad.legend.ncol = made.length;
      pad.legend.fontsize = pad.legend.fontsize ?? 14;
    }
  });
  store().flash(`Added ${bands.length} breakdown bands to pad “${padId}”`);
}
