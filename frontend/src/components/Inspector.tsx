import { addErrorband, dependents } from "../actions";
import { BAND_LABELS, contentItems, contentValue, defaultBandLabel, hasSystematics, histLayers, legendLabels } from "../spec";
import { useStore } from "../store";
import type {
  Annotation,
  Axis,
  ErrorBandLayer,
  BandContent,
  ExpLabel,
  GraphLayer,
  Hist2DLayer,
  HistOps,
  HistogramLayer,
  Layer,
  Legend,
  Pad,
  PlotSpec,
  PullLayer,
  RatioLayer,
  RefLike,
  StackLayer,
  StackMember,
} from "../types";
import {
  CheckField,
  ColorField,
  HATCHES,
  LEGEND_LOCS,
  LINESTYLES,
  MARKERS,
  NumberField,
  RangeField,
  Section,
  SelectField,
  TextField,
} from "./fields";
import { Breakdown, BreakdownBands, GroupsEditor, SystematicsEditor } from "./Systematics";

type Setter<T> = <K extends keyof T>(key: K) => (value: T[K]) => void;

/** Setter for fields of the object ``locate`` finds in the spec; typing in one field is one undo step. */
function useSetter<T>(locate: (s: PlotSpec) => T, keyPrefix: string): Setter<T> {
  const update = useStore((s) => s.update);
  return (key) => (value) =>
    update((s) => {
      (locate(s) as T)[key] = value;
    }, `${keyPrefix}.${String(key)}`);
}

const findPad = (s: PlotSpec, id: string) => s.pads.find((p) => p.id === id)!;
const findLayer = <L extends Layer>(s: PlotSpec, pad: string, id: string) =>
  findPad(s, pad).layers.find((l) => l.id === id) as L;

export function Inspector() {
  const spec = useStore((s) => s.spec);
  const sel = useStore((s) => s.selection);
  if (!spec) return null;
  if (!sel || sel.type === "canvas") return <CanvasForm spec={spec} />;
  const pad = spec.pads.find((p) => p.id === sel.pad);
  if (!pad) return <CanvasForm spec={spec} />;
  switch (sel.type) {
    case "pad":
      return <PadForm pad={pad} />;
    case "xaxis":
    case "yaxis":
      return <AxisForm pad={pad} which={sel.type} />;
    case "legend":
      return <LegendForm pad={pad} />;
    case "label":
      return pad.label ? <LabelForm pad={pad} label={pad.label} /> : <PadForm pad={pad} />;
    case "annotation": {
      const a = pad.annotations[sel.index];
      return a ? <AnnotationForm pad={pad} index={sel.index} ann={a} /> : <PadForm pad={pad} />;
    }
    case "layer":
    case "member": {
      const layer = pad.layers.find((l) => l.id === sel.layer);
      if (!layer) return <PadForm pad={pad} />;
      if (sel.type === "member" && layer.kind === "stack" && layer.members[sel.index])
        return <MemberForm pad={pad} layer={layer} index={sel.index} />;
      return <LayerForm pad={pad} layer={layer} />;
    }
  }
}

// ------------------------------------------------------------------ canvas

function CanvasForm({ spec }: { spec: PlotSpec }) {
  const update = useStore((s) => s.update);
  const setDialog = useStore((s) => s.setDialog);
  const setCanvas = useSetter((s) => s.canvas, "canvas");
  return (
    <>
      <Section title="Canvas">
        <SelectField label="Style" value={spec.style} options={["CMS", "ATLAS", "LHCb2", "ALICE", "ROOT"]}
          onChange={(v) => update((s) => { s.style = v; })} />
        <NumberField label="Width [in]" value={spec.canvas.width} nullable={false} min={1}
          onChange={(v) => setCanvas("width")(v!)} />
        <NumberField label="Height [in]" value={spec.canvas.height} nullable={false} min={1}
          onChange={(v) => setCanvas("height")(v!)} />
        <NumberField label="DPI" value={spec.canvas.dpi} nullable={false} min={10}
          hint="Resolution of PNG exports" onChange={(v) => setCanvas("dpi")(v!)} />
        <button onClick={() => setDialog("layout")}>Panels &amp; margins…</button>
      </Section>
      <Section title="Input files">
        {Object.keys(spec.inputs).length === 0 && <p className="muted">Nothing imported yet. Pick a ROOT file in the browser on the left.</p>}
        {Object.entries(spec.inputs).map(([k, v]) => (
          <div key={k} className="kv"><b>{k}</b><span title={v}>{v}</span></div>
        ))}
      </Section>
      <p className="hint">Click any part of the plot to edit it. Drag the legend or a text box to move it.</p>
    </>
  );
}

// --------------------------------------------------------------------- pad

function PadForm({ pad }: { pad: Pad }) {
  const spec = useStore((s) => s.spec)!;
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const set = useSetter((s) => findPad(s, pad.id), `pad.${pad.id}`);
  return (
    <>
      <Section title={`Pad “${pad.id}”`}>
        <NumberField label="Row" value={pad.row} nullable={false} integer min={0} onChange={(v) => set("row")(v!)} />
        <NumberField label="Column" value={pad.col} nullable={false} integer min={0} onChange={(v) => set("col")(v!)} />
        <NumberField label="Row span" value={pad.rowspan} nullable={false} integer min={1} onChange={(v) => set("rowspan")(v!)} />
        <NumberField label="Col span" value={pad.colspan} nullable={false} integer min={1} onChange={(v) => set("colspan")(v!)} />
        <SelectField label="Share x with" value={pad.sharex}
          options={[{ value: null, label: "—" }, ...spec.pads.filter((p) => p.id !== pad.id).map((p) => ({ value: p.id, label: p.id }))]}
          onChange={set("sharex")}
          hint="Shared pads use the same x range and scale (e.g. a ratio pad)" />
        <CheckField label="Experiment label" value={pad.label !== null}
          onChange={(on) => update((s) => {
            findPad(s, pad.id).label = on ? {
              show: true, experiment: "CMS", text: "Preliminary", data: true, lumi: null, com: 13,
              year: null, loc: 0, rlabel: null, llabel: null, fontsize: null,
            } : null;
          })} />
      </Section>
      <AxisFields pad={pad} which="xaxis" />
      <AxisFields pad={pad} which="yaxis" />
      <Section title="Legend" actions={<button className="link" onClick={() => select({ type: "legend", pad: pad.id })}>edit</button>}>
        <CheckField label="Show" value={pad.legend.show}
          onChange={(v) => update((s) => { findPad(s, pad.id).legend.show = v; })} />
      </Section>
    </>
  );
}

function AxisForm({ pad, which }: { pad: Pad; which: "xaxis" | "yaxis" }) {
  return <AxisFields pad={pad} which={which} />;
}

function AxisFields({ pad, which }: { pad: Pad; which: "xaxis" | "yaxis" }) {
  const spec = useStore((s) => s.spec)!;
  const current = useStore((s) => s.render?.axes[pad.id]);
  // A shared x axis takes range and scale from the pad it shares with.
  let root = pad;
  while (which === "xaxis" && root.sharex) root = spec.pads.find((p) => p.id === root.sharex) ?? root;
  const ax = pad[which];
  const rangeAx = root[which];
  const set = useSetter<Axis>((s) => findPad(s, pad.id)[which], `${pad.id}.${which}`);
  const setRoot = useSetter<Axis>((s) => findPad(s, root.id)[which], `${root.id}.${which}`);
  const name = which === "xaxis" ? "X axis" : "Y axis";
  return (
    <Section title={`${name}${pad.id !== root.id ? ` (range shared with “${root.id}”)` : ""}`}>
      <TextField label="Title" value={ax.label} onChange={set("label")} placeholder="LaTeX: $p_T$ [GeV]" />
      <RangeField label="Range" value={rangeAx.range} onChange={setRoot("range")}
        current={current?.[which === "xaxis" ? "xlim" : "ylim"]} />
      <CheckField label="Log scale" value={rangeAx.log} onChange={setRoot("log")} />
      <CheckField label="Tick labels" value={ax.ticklabels} onChange={set("ticklabels")} />
      <SelectField label="Title position" value={ax.label_loc}
        options={which === "xaxis" ? [null, "left", "center", "right"] : [null, "bottom", "center", "top"]}
        onChange={set("label_loc")} />
    </Section>
  );
}

function LegendForm({ pad }: { pad: Pad }) {
  const lg = pad.legend;
  const update = useStore((s) => s.update);
  const set = useSetter<Legend>((s) => findPad(s, pad.id).legend, `${pad.id}.legend`);
  const labels = legendLabels(pad);
  const order = [...(lg.order ?? []).filter((l) => labels.includes(l)),
                 ...(lg.reverse ? [...labels].reverse() : labels).filter((l) => !(lg.order ?? []).includes(l))];
  const move = (i: number, d: number) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update((s) => { findPad(s, pad.id).legend.order = next; });
  };
  return (
    <Section title={`Legend of “${pad.id}”`}>
      <CheckField label="Show" value={lg.show} onChange={set("show")} />
      <SelectField label="Position" value={lg.loc} options={LEGEND_LOCS}
        onChange={(v) => update((s) => { const l = findPad(s, pad.id).legend; l.loc = v; l.bbox = null; })} />
      {lg.bbox && (
        <div className="row">
          <span className="row-label">Anchor</span>
          <span className="row-control">
            <span className="muted">dragged to ({lg.bbox[0].toFixed(3)}, {lg.bbox[1].toFixed(3)})</span>
            <button className="link" onClick={() => set("bbox")(null)}>reset</button>
          </span>
        </div>
      )}
      <NumberField label="Columns" value={lg.ncol} nullable={false} integer min={1} onChange={(v) => set("ncol")(v!)} />
      <NumberField label="Font size" value={lg.fontsize} onChange={set("fontsize")} />
      <SelectField label="Frame" value={lg.frameon} options={[{ value: null, label: "style default" }, { value: true, label: "on" }, { value: false, label: "off" }]} onChange={set("frameon")} />
      <TextField label="Title" value={lg.title} onChange={set("title")} />
      <div className="row">
        <span className="row-label">Order</span>
        <ol className="order">
          {order.map((l, i) => (
            <li key={l}>
              <span>{l}</span>
              <button disabled={i === 0} onClick={() => move(i, -1)} title="Move up">▲</button>
              <button disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down">▼</button>
            </li>
          ))}
        </ol>
      </div>
      <p className="hint">Drag the legend on the canvas to place it freely. Entries come from layer labels; clear a label to hide an entry.</p>
    </Section>
  );
}

function LabelForm({ pad, label }: { pad: Pad; label: ExpLabel }) {
  const set = useSetter<ExpLabel>((s) => findPad(s, pad.id).label!, `${pad.id}.label`);
  return (
    <Section title={`Experiment label on “${pad.id}”`}>
      <SelectField label="Experiment" value={label.experiment} options={["CMS", "ATLAS", "LHCb", "ALICE"]} onChange={set("experiment")} />
      <TextField label="Text" value={label.text} nullable={false} onChange={(v) => set("text")(v ?? "")} placeholder="(none)" />
      <div className="chips">
        {["", "Preliminary", "Supplementary", "Work in progress", "Private work"].map((t) => (
          <button key={t} className={label.text === t ? "chip active" : "chip"} onClick={() => set("text")(t)}>
            {t || "none"}
          </button>
        ))}
      </div>
      <CheckField label="Data" value={label.data} onChange={set("data")} hint='Unchecked adds "Simulation"' />
      <TextField label="Luminosity" value={label.lumi === null ? null : String(label.lumi)}
        onChange={(v) => set("lumi")(v === null ? null : isNaN(Number(v)) ? v : Number(v))} placeholder="e.g. 138" />
      <TextField label="√s [TeV]" value={label.com === null ? null : String(label.com)}
        onChange={(v) => set("com")(v === null ? null : isNaN(Number(v)) ? v : Number(v))} />
      <TextField label="Year" value={label.year === null ? null : String(label.year)} onChange={set("year")} />
      <SelectField label="Placement" value={label.loc}
        options={[0, 1, 2, 3, 4].map((v) => ({ value: v, label: ["0: above frame", "1: inside, top left", "2: inside, stacked", "3: inside, split", "4: above, stacked"][v] }))}
        onChange={set("loc")} />
      <NumberField label="Font size" value={label.fontsize} onChange={set("fontsize")} />
      <TextField label="Right text" value={label.rlabel} onChange={set("rlabel")} placeholder="overrides lumi / √s" />
      <TextField label="Left text" value={label.llabel} onChange={set("llabel")} placeholder="overrides the left label" />
    </Section>
  );
}

// ------------------------------------------------------------------ layers

function LayerForm({ pad, layer }: { pad: Pad; layer: Layer }) {
  switch (layer.kind) {
    case "histogram": return <HistogramForm pad={pad} layer={layer} />;
    case "stack": return <StackForm pad={pad} layer={layer} />;
    case "errorband": return <ErrorbandForm pad={pad} layer={layer} />;
    case "graph": return <GraphForm pad={pad} layer={layer} />;
    case "hist2d": return <Hist2DForm pad={pad} layer={layer} />;
    case "ratio": return <RatioForm pad={pad} layer={layer} />;
    case "pull": return <PullForm pad={pad} layer={layer} />;
  }
}

function RefInfo({ refs }: { refs: RefLike }) {
  const inputs = useStore((s) => s.spec!.inputs);
  const list = Array.isArray(refs) ? refs : [refs];
  return (
    <div className="refs">
      {list.map((r, i) => (
        <div key={i} className="kv" title={inputs[r.file] ?? r.file}>
          <b>{r.file}</b><span>{r.path}</span>
        </div>
      ))}
      {list.length > 1 && <span className="muted">summed</span>}
    </div>
  );
}

function CommonLayerFields<L extends Layer>({ layer, set }: { layer: L; set: Setter<L> }) {
  return (
    <>
      <CheckField label="Visible" value={layer.visible} onChange={set("visible" as keyof L) as (v: boolean) => void} />
      <NumberField label="Z order" value={layer.zorder} onChange={set("zorder" as keyof L) as (v: number | null) => void}
        hint="Drawing order; higher is on top" />
    </>
  );
}

function OpsFields<T extends HistOps>({ ops, set }: { ops: T; set: Setter<T> }) {
  const s = set as unknown as Setter<HistOps>;
  return (
    <Section title="Operations">
      <TextField label="Rebin" value={ops.rebin === null ? null : Array.isArray(ops.rebin) ? ops.rebin.join(", ") : String(ops.rebin)}
        placeholder="2 or edges: 60, 80, 120"
        onChange={(v) => {
          if (v === null) return s("rebin")(null);
          const parts = v.split(/[,\s]+/).filter(Boolean).map(Number);
          if (parts.some((n) => !Number.isFinite(n))) return;
          s("rebin")(parts.length === 1 ? Math.max(1, Math.round(parts[0])) : parts);
        }} />
      <RangeField label="Keep x range" value={ops.xrange} onChange={s("xrange")} />
      <CheckField label="Fold overflow" value={ops.flow === "fold"} onChange={(v) => s("flow")(v ? "fold" : "none")}
        hint="Add underflow/overflow to the first/last bin" />
      <NumberField label="Scale" value={ops.scale} nullable={false} onChange={(v) => s("scale")(v!)} />
      <CheckField label="Normalize" value={ops.normalize} onChange={s("normalize")} hint="Normalize the integral to the scale factor" />
    </Section>
  );
}

function HistogramForm({ pad, layer }: { pad: Pad; layer: HistogramLayer }) {
  const update = useStore((s) => s.update);
  const breakdown = useStore((s) => s.render?.systematics?.[layer.id]);
  const set = useSetter<HistogramLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  const errbar = layer.histtype === "errorbar";
  return (
    <>
      <Section title={`Histogram “${layer.id}”`}>
        <RefInfo refs={layer.ref} />
        <TextField label="Legend label" value={layer.label} onChange={set("label")} placeholder="(not in legend)" />
        <SelectField label="Draw as" value={layer.histtype}
          options={[{ value: "step", label: "line (step)" }, { value: "fill", label: "filled" }, { value: "errorbar", label: "points with errors" }, { value: "band", label: "band" }]}
          onChange={set("histtype")} />
        <ColorField label="Color" value={layer.color} onChange={set("color")} />
        <NumberField label={errbar ? "Error line width" : "Line width"} value={layer.linewidth} onChange={set("linewidth")} />
        {!errbar && <SelectField label="Line style" value={layer.linestyle} options={[...LINESTYLES]} onChange={set("linestyle")} />}
        {errbar && <SelectField label="Marker" value={layer.marker} options={[...MARKERS]} onChange={set("marker")} />}
        {errbar && <NumberField label="Marker size" value={layer.markersize} onChange={set("markersize")} />}
        <SelectField label="Hatch" value={layer.hatch} options={[...HATCHES]} onChange={set("hatch")} />
        <NumberField label="Opacity" value={layer.alpha} min={0} step={0.1} onChange={set("alpha")} />
        <SelectField label="Y errors" value={layer.yerr}
          options={[{ value: "auto", label: "auto (Poisson for data)" }, { value: "sumw2", label: "√sumw2" }, { value: "poisson", label: "Poisson" }, { value: "none", label: "none" }]}
          onChange={set("yerr")} />
        <CheckField label="X errors" value={layer.xerr} onChange={set("xerr")} />
        <NumberField label="Per bin width" value={layer.binwnorm} onChange={set("binwnorm")} hint="Divide by bin width × this (e.g. 1 for Events / GeV)" placeholder="off" />
        <CommonLayerFields layer={layer} set={set} />
      </Section>
      <OpsFields ops={layer} set={set} />
      <SystematicsEditor title="Systematics" items={layer.systematics}
        onChange={(items, key) => update((s) => { findLayer<HistogramLayer>(s, pad.id, layer.id).systematics = items; }, key && `${layer.id}.${key}`)}
        symmetrize={layer.symmetrize} onSymmetrize={set("symmetrize")} />
      {hasSystematics(layer) && <GroupsEditor layerId={layer.id} groups={layer.syst_groups} breakdown={breakdown}
        onChange={(g, key) => update((s) => { findLayer<HistogramLayer>(s, pad.id, layer.id).syst_groups = g; }, key && `${layer.id}.${key}`)} />}
      <Breakdown data={breakdown} />
      {hasSystematics(layer) && <BreakdownBands layerId={layer.id} padId={pad.id} />}
    </>
  );
}

function StackForm({ pad, layer }: { pad: Pad; layer: StackLayer }) {
  const spec = useStore((s) => s.spec)!;
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const breakdown = useStore((s) => s.render?.systematics?.[layer.id]);
  const set = useSetter<StackLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  const hasBand = dependents(spec, layer.id).some((l) => l.kind === "errorband");
  const move = (i: number, d: number) => update((s) => {
    const m = findLayer<StackLayer>(s, pad.id, layer.id).members;
    [m[i], m[i + d]] = [m[i + d], m[i]];
  });
  return (
    <>
    <Section title={`Stack “${layer.id}”`}>
      <div className="row">
        <span className="row-label">Members</span>
        <ol className="order">
          {layer.members.map((m, i) => (
            <li key={i}>
              <span className="swatch" style={{ background: m.color ?? "#ccc" }} />
              <button className="link" onClick={() => select({ type: "member", pad: pad.id, layer: layer.id, index: i })}>
                {m.label ?? (Array.isArray(m.ref) ? m.ref[0].path : m.ref.path)}
              </button>
              <button disabled={i === 0} onClick={() => move(i, -1)} title="Move down the stack">▲</button>
              <button disabled={i === layer.members.length - 1} onClick={() => move(i, 1)} title="Move up the stack">▼</button>
            </li>
          ))}
        </ol>
      </div>
      <p className="hint">First member is at the bottom. Add members by choosing “Add to stack” on a histogram in the browser.</p>
      <SelectField label="Draw as" value={layer.histtype} options={["fill", "step"]} onChange={set("histtype")} />
      <NumberField label="Line width" value={layer.linewidth} onChange={set("linewidth")} />
      <NumberField label="Opacity" value={layer.alpha} min={0} step={0.1} onChange={set("alpha")} />
      <NumberField label="Per bin width" value={layer.binwnorm} onChange={set("binwnorm")} placeholder="off" />
      <CommonLayerFields layer={layer} set={set} />
      {!hasBand && <button onClick={() => addErrorband(layer.id)}>Add uncertainty band</button>}
    </Section>
    <SystematicsEditor title="Systematics (all members)" items={layer.systematics}
      hint="Applied to every member. Sources only affecting one sample (e.g. its cross section) go on that member."
      onChange={(items, key) => update((s) => { findLayer<StackLayer>(s, pad.id, layer.id).systematics = items; }, key && `${layer.id}.${key}`)}
      symmetrize={layer.symmetrize} onSymmetrize={set("symmetrize")} />
    {layer.members.some((m) => m.systematics.length > 0) && (
      <p className="hint">Member-specific: {layer.members.map((m, i) => m.systematics.length
        ? `${m.label ?? `member ${i + 1}`} (${m.systematics.map((x) => x.kind === "shape" ? "shape" : x.source).join(", ")})` : null).filter(Boolean).join("; ")}</p>
    )}
    {hasSystematics(layer) && <GroupsEditor layerId={layer.id} groups={layer.syst_groups} breakdown={breakdown}
      onChange={(g, key) => update((s) => { findLayer<StackLayer>(s, pad.id, layer.id).syst_groups = g; }, key && `${layer.id}.${key}`)} />}
    <Breakdown data={breakdown} />
    {hasSystematics(layer) && <BreakdownBands layerId={layer.id} padId={pad.id} />}
    </>
  );
}

function MemberForm({ pad, layer, index }: { pad: Pad; layer: StackLayer; index: number }) {
  const m = layer.members[index];
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const set = useSetter<StackMember>((s) => findLayer<StackLayer>(s, pad.id, layer.id).members[index], `${layer.id}.${index}`);
  return (
    <>
      <Section title={`Stack member ${index + 1} of “${layer.id}”`}
        actions={<button className="link" onClick={() => select({ type: "layer", pad: pad.id, layer: layer.id })}>whole stack</button>}>
        <RefInfo refs={m.ref} />
        <TextField label="Legend label" value={m.label} onChange={set("label")} />
        <ColorField label="Fill color" value={m.color} onChange={set("color")} />
        <ColorField label="Edge color" value={m.edgecolor} onChange={set("edgecolor")} />
        <SelectField label="Hatch" value={m.hatch} options={[...HATCHES]} onChange={set("hatch")} />
      </Section>
      <OpsFields ops={m} set={set} />
      <SystematicsEditor title="Systematics (this member only)" items={m.systematics}
        onChange={(items, key) => update((s) => { findLayer<StackLayer>(s, pad.id, layer.id).members[index].systematics = items; }, key && `${layer.id}.${index}.${key}`)} />
    </>
  );
}

function ErrorbandForm({ pad, layer }: { pad: Pad; layer: ErrorBandLayer }) {
  const spec = useStore((s) => s.spec)!;
  const update = useStore((s) => s.update);
  const set = useSetter<ErrorBandLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  const lines = layer.style === "lines";
  return (
    <Section title={`Uncertainty band “${layer.id}”`}>
      <SelectField label="Around" value={layer.of} options={histLayers(spec).map((l) => l.id)} onChange={set("of")} />
      <ContentField value={layer.content} layerId={layer.of}
        onChange={(v) => update((s) => {
          const b = findLayer<ErrorBandLayer>(s, pad.id, layer.id);
          // Keep a default label in sync with what the band shows.
          if (b.label === null || Object.values(BAND_LABELS).includes(b.label)) b.label = defaultBandLabel(v) ?? b.label;
          b.content = v;
        })} />
      <CheckField label="Relative" value={layer.relative} onChange={set("relative")}
        hint="Draw 1 ± error / nominal, for a ratio pad" />
      <SelectField label="Draw as" value={layer.style}
        options={[{ value: "fill", label: "filled band" }, { value: "lines", label: "upper / lower lines" }]}
        onChange={set("style")} />
      <TextField label="Legend label" value={layer.label} onChange={set("label")} />
      {!lines && <SelectField label="Hatch" value={layer.hatch} options={[...HATCHES]} onChange={set("hatch")} />}
      <ColorField label={lines ? "Line color" : "Hatch color"} value={layer.color} nullable={false} onChange={(v) => set("color")(v ?? "gray")} />
      {!lines && <ColorField label="Fill" value={layer.facecolor === "none" ? null : layer.facecolor} onChange={(v) => set("facecolor")(v ?? "none")} />}
      {lines && <NumberField label="Line width" value={layer.linewidth} onChange={set("linewidth")} />}
      {lines && <SelectField label="Line style" value={layer.linestyle} options={[...LINESTYLES]} onChange={set("linestyle")} />}
      <NumberField label="Opacity" value={layer.alpha} min={0} step={0.1} onChange={set("alpha")} />
      <CommonLayerFields layer={layer} set={set} />
    </Section>
  );
}

function GraphForm({ pad, layer }: { pad: Pad; layer: GraphLayer }) {
  const set = useSetter<GraphLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  return (
    <Section title={`Graph “${layer.id}”`}>
      <RefInfo refs={layer.ref} />
      <TextField label="Legend label" value={layer.label} onChange={set("label")} />
      <ColorField label="Color" value={layer.color} onChange={set("color")} />
      <SelectField label="Marker" value={layer.marker} options={[...MARKERS]} onChange={set("marker")} />
      <NumberField label="Marker size" value={layer.markersize} onChange={set("markersize")} />
      <SelectField label="Line" value={layer.linestyle} options={["none", "-", "--", ":", "-."]} onChange={set("linestyle")} />
      <NumberField label="Line width" value={layer.linewidth} onChange={set("linewidth")} />
      <CheckField label="X errors" value={layer.xerr} onChange={set("xerr")} />
      <CheckField label="Y errors" value={layer.yerr} onChange={set("yerr")} />
      <NumberField label="Cap size" value={layer.capsize} onChange={set("capsize")} />
      <CommonLayerFields layer={layer} set={set} />
    </Section>
  );
}

function Hist2DForm({ pad, layer }: { pad: Pad; layer: Hist2DLayer }) {
  const set = useSetter<Hist2DLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  return (
    <Section title={`2D histogram “${layer.id}”`}>
      <RefInfo refs={layer.ref} />
      <SelectField label="Colormap" value={layer.cmap}
        options={[null, "viridis", "plasma", "inferno", "magma", "cividis", "Blues", "Reds", "coolwarm", "RdBu_r", "Greys"]}
        onChange={set("cmap")} />
      <CheckField label="Log z" value={layer.logz} onChange={set("logz")} />
      <RangeField label="Z range" value={layer.zrange} onChange={set("zrange")} />
      <NumberField label="Hide below" value={layer.cmin} onChange={set("cmin")} placeholder="off" />
      <CheckField label="Colorbar" value={layer.cbar} onChange={set("cbar")} />
      <TextField label="Colorbar title" value={layer.cbar_label} onChange={set("cbar_label")} />
      <CheckField label="Bin values" value={layer.bin_labels} onChange={set("bin_labels")} />
      {layer.bin_labels && <TextField label="Value format" value={layer.bin_labels_format} nullable={false} onChange={(v) => set("bin_labels_format")(v ?? "{:.2f}")} />}
      <NumberField label="Scale" value={layer.scale} nullable={false} onChange={(v) => set("scale")(v!)} />
      <CommonLayerFields layer={layer} set={set} />
    </Section>
  );
}

function RatioForm({ pad, layer }: { pad: Pad; layer: RatioLayer }) {
  const spec = useStore((s) => s.spec)!;
  const set = useSetter<RatioLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  const ids = histLayers(spec).map((l) => l.id);
  return (
    <Section title={`Ratio “${layer.id}”`}>
      <SelectField label="Numerator" value={layer.num} options={ids} onChange={set("num")} />
      <SelectField label="Denominator" value={layer.den} options={ids} onChange={set("den")} />
      <SelectField label="Draw as" value={layer.histtype} options={["errorbar", "step"]} onChange={set("histtype")} />
      <ColorField label="Color" value={layer.color} onChange={set("color")} />
      <SelectField label="Marker" value={layer.marker} options={[...MARKERS]} onChange={set("marker")} />
      <NumberField label="Marker size" value={layer.markersize} onChange={set("markersize")} />
      <TextField label="Legend label" value={layer.label} onChange={set("label")} />
      <CheckField label="Denominator band" value={layer.den_band} onChange={set("den_band")} />
      {layer.den_band && <ContentField value={layer.den_band_content} onChange={set("den_band_content")} layerId={layer.den} />}
      {layer.den_band && <SelectField label="Band hatch" value={layer.den_band_hatch} options={[...HATCHES]} onChange={set("den_band_hatch")} />}
      {layer.den_band && <ColorField label="Band color" value={layer.den_band_color} nullable={false} onChange={(v) => set("den_band_color")(v ?? "gray")} />}
      <CommonLayerFields layer={layer} set={set} />
    </Section>
  );
}

function PullForm({ pad, layer }: { pad: Pad; layer: PullLayer }) {
  const spec = useStore((s) => s.spec)!;
  const set = useSetter<PullLayer>((s) => findLayer(s, pad.id, layer.id), layer.id);
  const ids = histLayers(spec).map((l) => l.id);
  return (
    <Section title={`Pull “${layer.id}”`}>
      <SelectField label="Observed" value={layer.num} options={ids} onChange={set("num")} />
      <SelectField label="Expected" value={layer.den} options={ids} onChange={set("den")} />
      <ColorField label="Color" value={layer.color} onChange={set("color")} />
      <TextField label="Legend label" value={layer.label} onChange={set("label")} />
      <CommonLayerFields layer={layer} set={set} />
    </Section>
  );
}

// ------------------------------------------------------------- annotations

function AnnotationForm({ pad, index, ann }: { pad: Pad; index: number; ann: Annotation }) {
  const update = useStore((s) => s.update);
  const key = `${pad.id}.ann.${index}`;
  const setAny = (k: string) => (v: unknown) =>
    update((s) => { (findPad(s, pad.id).annotations[index] as unknown as Record<string, unknown>)[k] = v; }, `${key}.${k}`);
  if (ann.kind === "text") {
    return (
      <Section title="Text">
        <TextField label="Text" value={ann.text} nullable={false} autoFocus onChange={(v) => setAny("text")(v ?? "")} placeholder="LaTeX allowed: $\\geq$ 2 jets" />
        <NumberField label="Font size" value={ann.fontsize} onChange={setAny("fontsize")} />
        <ColorField label="Color" value={ann.color} onChange={setAny("color")} />
        <SelectField label="Weight" value={ann.fontweight} options={["normal", "bold"]} onChange={setAny("fontweight")} />
        <SelectField label="Style" value={ann.fontstyle} options={["normal", "italic"]} onChange={setAny("fontstyle")} />
        <NumberField label="Rotation" value={ann.rotation} nullable={false} onChange={setAny("rotation")} />
        <SelectField label="Align" value={ann.ha} options={["left", "center", "right"]} onChange={setAny("ha")} />
        <SelectField label="Vertical align" value={ann.va} options={["top", "center", "bottom", "baseline"]} onChange={setAny("va")} />
        <NumberField label="x" value={ann.xy[0]} nullable={false} onChange={(v) => setAny("xy")([v, ann.xy[1]])} />
        <NumberField label="y" value={ann.xy[1]} nullable={false} onChange={(v) => setAny("xy")([ann.xy[0], v])} />
        <SelectField label="Coordinates" value={ann.coords}
          options={[{ value: "axes", label: "axes fraction (0–1)" }, { value: "data", label: "data" }]}
          onChange={setAny("coords")} />
        <p className="hint">Drag the text on the canvas to move it.</p>
      </Section>
    );
  }
  return (
    <Section title={ann.kind === "hline" ? "Horizontal line" : "Vertical line"}>
      <NumberField label={ann.kind === "hline" ? "y" : "x"} value={ann.at} nullable={false} onChange={setAny("at")} />
      <ColorField label="Color" value={ann.color} nullable={false} onChange={(v) => setAny("color")(v ?? "black")} />
      <SelectField label="Style" value={ann.linestyle} options={["-", "--", ":", "-."]} onChange={setAny("linestyle")} />
      <NumberField label="Width" value={ann.linewidth} nullable={false} onChange={setAny("linewidth")} />
    </Section>
  );
}

/** What a band shows: any combination of stat, all syst, groups and single sources, in quadrature. */
function ContentField({ value, onChange, layerId }: {
  value: BandContent; onChange: (v: BandContent) => void; layerId: string;
}) {
  const spec = useStore((s) => s.spec)!;
  const breakdown = useStore((s) => s.render?.systematics?.[layerId]);
  const layer = histLayers(spec).find((l) => l.id === layerId);
  const hasSyst = layer ? hasSystematics(layer) : false;
  const items = contentItems(value);
  const groups = breakdown?.groups.map((g) => g.group) ?? Object.keys(layer && "syst_groups" in layer ? layer.syst_groups : {});
  const sources = breakdown?.sources.map((x) => x.source) ?? [];
  const toggle = (item: string) => {
    let next = items.includes(item) ? items.filter((x) => x !== item) : [...items, item];
    // "all syst" already covers groups and single sources.
    if (item === "syst" && !items.includes("syst")) next = next.filter((x) => x === "stat" || x === "syst");
    if (item !== "syst" && item !== "stat" && !items.includes(item)) next = next.filter((x) => x !== "syst");
    if (next.length) onChange(contentValue(next));
  };
  const chip = (item: string, text: string, title?: string) => (
    <button key={item} title={title} className={items.includes(item) ? "chip active" : "chip"} onClick={() => toggle(item)}>
      {text}
    </button>
  );
  const singles = items.filter((x) => sources.includes(x) && !groups.includes(x));
  return (
    <div className="row">
      <span className="row-label">Shows</span>
      <span className="row-control">
        <span className="chips">
          {chip("stat", "stat.", "MC statistical uncertainty")}
          {chip("syst", "all syst.", "Every systematic source")}
          {groups.map((g) => chip(g, g, `Group ${g}`))}
          {singles.map((x) => chip(x, x))}
        </span>
        {sources.length > 0 && (
          <select value="" onChange={(e) => e.target.value && toggle(e.target.value)}>
            <option value="">+ single source…</option>
            {sources.filter((x) => !items.includes(x)).map((x) => <option key={x}>{x}</option>)}
          </select>
        )}
        {!hasSyst && items.some((x) => x !== "stat") && (
          <span className="warning-text">No systematics are defined on “{layerId}” yet; add them in its properties.</span>
        )}
        <span className="muted small">Selected items are added in quadrature.</span>
      </span>
    </div>
  );
}
