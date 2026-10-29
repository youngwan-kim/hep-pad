import { useState } from "react";
import { ApiError, api } from "../api";
import { addRatio } from "../actions";
import { axis, histLayers, lineAnnotation, pad as newPad, uniqueId, uniqueLayerId } from "../spec";
import { useStore } from "../store";

export function SaveDialog() {
  const store = useStore();
  const [path, setPath] = useState(store.docPath ?? `${store.startDir}/plot.yaml`);
  const [script, setScript] = useState(true);
  const [pdf, setPdf] = useState(true);
  const [png, setPng] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!store.spec) return;
    setBusy(true);
    try {
      const images = [pdf && "pdf", png && "png"].filter(Boolean) as string[];
      const r = await api.saveSpec(store.spec, store.baseDir, path, script, images);
      store.markSaved(r.spec, r.path, r.base_dir);
      store.setDialog(null);
      store.flash(`Saved ${r.written.map((p) => p.split("/").pop()).join(", ")}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.messages.join("; ") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stem = path.replace(/\.ya?ml$/, "");
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && store.setDialog(null)}>
      <div className="modal">
        <h2>Save</h2>
        <label className="row stacked">
          <span className="row-label">Plot file (on the machine running the editor)</span>
          <input value={path} autoFocus spellCheck={false} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
        <p className="muted small">Input files are stored relative to this location, so the folder can be moved as a whole.</p>
        <h3>Also write next to it</h3>
        <label className="check"><input type="checkbox" checked={script} onChange={(e) => setScript(e.target.checked)} />
          <span><code>{stem.split("/").pop()}.py</code>: a standalone mplhep script that draws exactly this plot</span></label>
        <label className="check"><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} />
          <span><code>{stem.split("/").pop()}.pdf</code></span></label>
        <label className="check"><input type="checkbox" checked={png} onChange={(e) => setPng(e.target.checked)} />
          <span><code>{stem.split("/").pop()}.png</code></span></label>
        {error && <div className="banner error small">{error}</div>}
        <div className="modal-actions">
          <button onClick={() => store.setDialog(null)}>Cancel</button>
          <button className="primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function RatioDialog() {
  const store = useStore();
  const spec = store.spec!;
  const hists = histLayers(spec);
  const guessNum = hists.find((l) => l.kind === "histogram" && l.histtype === "errorbar") ?? hists[0];
  const guessDen = hists.find((l) => l.kind === "stack") ?? hists.find((l) => l !== guessNum) ?? hists[0];
  const [num, setNum] = useState(guessNum?.id ?? "");
  const [den, setDen] = useState(guessDen?.id ?? "");
  const [kind, setKind] = useState<"ratio" | "pull">("ratio");
  const ratioPad = spec.pads.find((p) => p.sharex && p.layers.length === 0) ?? spec.pads.find((p) => p.id !== spec.pads[0].id);
  const [pad, setPad] = useState(ratioPad?.id ?? "__new__");

  const apply = () => {
    let target = pad;
    if (pad === "__new__") {
      // Add a full-width pad below everything; it shares x with the first pad and
      // takes over its x-axis title (the upper pad hides its x tick labels).
      store.update((s) => {
        const main = s.pads[0];
        const rows = s.layout.rows;
        const ratios = s.layout.height_ratios ?? Array(rows).fill(rows === 1 ? 3 : 1);
        s.layout.height_ratios = [...ratios, rows === 1 ? 1 : Math.min(...ratios)];
        s.layout.rows = rows + 1;
        s.layout.hspace = s.layout.hspace ?? 0.07;
        target = uniqueId(s.pads.map((p) => p.id), kind);
        s.pads.push(newPad(target, {
          row: rows, colspan: s.layout.cols, sharex: main.id,
          xaxis: axis({ label: main.xaxis.label }),
          yaxis: axis(kind === "ratio" ? { label: "Data / MC", range: [0.5, 1.5] } : { label: "Pull", range: [-3, 3] }),
        }));
        main.xaxis.label = null;
        main.xaxis.ticklabels = false;
      });
    }
    if (kind === "ratio") addRatio(num, den, target);
    else
      store.update((s) => {
        const p = s.pads.find((x) => x.id === target)!;
        p.layers.push({ id: uniqueLayerId(s, `pull_${num}`), visible: true, zorder: null, kind: "pull", num, den, color: "gray", label: null });
        if (!p.annotations.some((a) => a.kind === "hline" && a.at === 0)) p.annotations.push(lineAnnotation("hline", 0));
      });
    store.setDialog(null);
  };

  if (hists.length < 1) {
    return (
      <div className="modal-backdrop" onMouseDown={() => store.setDialog(null)}>
        <div className="modal"><h2>Ratio / pull</h2><p>Draw at least two histograms first.</p></div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && store.setDialog(null)}>
      <div className="modal">
        <h2>Add ratio or pull</h2>
        <label className="row"><span className="row-label">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as "ratio" | "pull")}>
            <option value="ratio">Ratio  num / den</option>
            <option value="pull">Pull  (num − den) / σ</option>
          </select></label>
        <label className="row"><span className="row-label">Numerator</span>
          <select value={num} onChange={(e) => setNum(e.target.value)}>{hists.map((l) => <option key={l.id}>{l.id}</option>)}</select></label>
        <label className="row"><span className="row-label">Denominator</span>
          <select value={den} onChange={(e) => setDen(e.target.value)}>{hists.map((l) => <option key={l.id}>{l.id}</option>)}</select></label>
        <label className="row"><span className="row-label">Draw in</span>
          <select value={pad} onChange={(e) => setPad(e.target.value)}>
            {spec.pads.map((p) => <option key={p.id} value={p.id}>pad {p.id}</option>)}
            <option value="__new__">new pad below</option>
          </select></label>
        <div className="modal-actions">
          <button onClick={() => store.setDialog(null)}>Cancel</button>
          <button className="primary" disabled={!num || !den || num === den} onClick={apply}>Add</button>
        </div>
      </div>
    </div>
  );
}
