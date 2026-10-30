import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { addRatio } from "../actions";
import { axis, histLayers, lineAnnotation, pad as newPad, uniqueId, uniqueLayerId } from "../spec";
import { useStore } from "../store";
import type { FsEntry } from "../types";

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

const RECENT_KEY = "hep-pad.recent-remote";

function recentRemote(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberRemote(url: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([url, ...recentRemote().filter((u) => u !== url)].slice(0, 8)));
  } catch {
    /* storage unavailable: recent list is a convenience only */
  }
}

const isUrl = (s: string) => s.includes("://");
const errorText = (e: unknown) => (e instanceof ApiError ? e.messages.join("; ") : String(e));

interface Listing {
  dir: string;
  parent: string | null;
  entries: FsEntry[];
}

/** File → Open ROOT file: pick a file on the machine running the editor, or by URL. */
export function OpenRootDialog() {
  const store = useStore();
  const [tab, setTab] = useState<"local" | "remote">("local");
  const [local, setLocal] = useState(store.baseDir || store.startDir);
  const [remote, setRemote] = useState(() => recentRemote()[0] ?? "");
  const [listing, setListing] = useState<Record<"local" | "remote", Listing | null>>({ local: null, remote: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const recent = recentRemote();
  const path = tab === "local" ? local : remote;
  const setPath = tab === "local" ? setLocal : setRemote;

  const browse = async (dir: string) => {
    setBusy("Listing…");
    setError(null);
    try {
      const r = await api.fs(dir);
      setListing((l) => ({ ...l, [tab]: r }));
      setPath(r.dir);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  // The local tab starts out showing the current folder.
  useEffect(() => {
    if (tab === "local" && !listing.local && local) browse(local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const open = async (file = path.trim()) => {
    if (!file) return;
    if (!file.endsWith(".root")) return browse(file);
    setBusy("Reading…");
    setError(null);
    try {
      const { objects } = await api.rootObjects(file);
      if (isUrl(file)) rememberRemote(file);
      store.addOpenFile(file, objects);
      store.setDialog(null);
      store.flash(`Opened ${file.split("/").pop()}: ${objects.filter((o) => o.kind !== "dir").length} objects`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const shown = listing[tab];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && store.setDialog(null)}>
      <div className="modal">
        <h2>Open ROOT file</h2>
        <div className="tabs">
          <button className={tab === "local" ? "chip active" : "chip"} onClick={() => { setTab("local"); setError(null); }}>This computer</button>
          <button className={tab === "remote" ? "chip active" : "chip"} onClick={() => { setTab("remote"); setError(null); }}>Remote (URL)</button>
        </div>
        <label className="row stacked">
          <span className="row-label">
            {tab === "local" ? "File or folder on the machine running the editor" : "URL of a .root file or a folder"}
          </span>
          <input value={path} autoFocus spellCheck={false}
            placeholder={tab === "local" ? "/path/to/file.root" : "ssh://user@host/path/to/file.root"}
            onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && open()} />
        </label>
        {tab === "remote" && (
          <p className="muted small">
            <code>ssh://user@host/abs/path</code> (SSH agent or default keys), <code>root://server//path</code> (XRootD),
            or <code>https://…</code>. A folder URL lists its .root files.
          </p>
        )}
        {tab === "remote" && recent.length > 0 && !shown && (
          <>
            <h3>Recent</h3>
            <div className="file-list">
              {recent.map((u) => (
                <div key={u} className="entry" title={u} onClick={() => setRemote(u)} onDoubleClick={() => open(u)}>
                  <span className="icon root">R</span><span className="name">{u}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {shown && (
          <div className="file-list">
            <div className="entry" title={shown.dir}>
              <button className="small" disabled={!shown.parent || !!busy} title="Parent folder"
                onClick={() => shown.parent && browse(shown.parent)}>↑</button>
              <span className="name muted">{shown.dir}</span>
            </div>
            {shown.entries.filter((e) => e.kind !== "spec").map((e) => (
              <div key={e.path} className={`entry ${e.kind} ${e.path === path ? "active" : ""}`} title={e.path}
                onClick={() => (e.kind === "dir" ? browse(e.path) : setPath(e.path))}
                onDoubleClick={() => e.kind === "root" && open(e.path)}>
                <span className={`icon ${e.kind}`}>{e.kind === "dir" ? "▤" : "R"}</span>
                <span className="name">{e.name}</span>
              </div>
            ))}
            {shown.entries.every((e) => e.kind === "spec") && <p className="muted pad">No folders or .root files here.</p>}
          </div>
        )}
        {error && <div className="banner error small">{error}</div>}
        <div className="modal-actions">
          {busy && <span className="muted small busy">{busy}</span>}
          {tab === "remote" && (
            <button disabled={!!busy || !remote.trim()} onClick={() => browse(remote.endsWith(".root") ? remote.slice(0, remote.lastIndexOf("/") + 1) : remote)}>
              Browse folder
            </button>
          )}
          <button onClick={() => store.setDialog(null)}>Cancel</button>
          <button className="primary" disabled={!!busy || !path.endsWith(".root")} onClick={() => open()}>Open</button>
        </div>
      </div>
    </div>
  );
}
