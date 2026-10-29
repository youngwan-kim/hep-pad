import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import { addObject, targetPad, type AddMode } from "../actions";
import { useStore } from "../store";
import type { FsEntry, Preview, RootObject } from "../types";
import { DRAG_MIME, type DragPayload } from "./CanvasView";

interface TreeNode {
  name: string;
  path: string;
  obj?: RootObject;
  children: TreeNode[];
}

function buildTree(objects: RootObject[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const obj of objects) {
    if (obj.kind === "dir") continue;
    let node = root;
    const parts = obj.path.split("/");
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part && !c.obj);
      if (i === parts.length - 1) {
        node.children.push({ name: part, path, obj, children: [] });
        return;
      }
      if (!child) {
        child = { name: part, path, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(!!a.obj) - Number(!!b.obj) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

const KIND_ICON: Record<string, string> = { h1: "H1", h2: "H2", graph: "Gr", other: "··" };

export function Browser() {
  const startDir = useStore((s) => s.startDir);
  const openRoot = useStore((s) => s.openRoot);
  const [dir, setDir] = useState<string>("");
  const [dirInput, setDirInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, RootObject[] | "loading">>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<{ file: string; obj: RootObject } | null>(null);

  const go = async (d?: string) => {
    try {
      const r = await api.fs(d);
      setDir(r.dir);
      setDirInput(r.dir);
      setEntries(r.entries);
      setParent(r.parent);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.messages.join(", ") : String(e));
    }
  };

  useEffect(() => {
    if (startDir) go(startDir);
  }, [startDir]);

  const toggleFile = async (file: string) => {
    if (open[file]) {
      const { [file]: _, ...rest } = open;
      setOpen(rest);
      return;
    }
    setOpen((o) => ({ ...o, [file]: "loading" }));
    try {
      const { objects } = await api.rootObjects(file);
      setOpen((o) => ({ ...o, [file]: objects }));
      // Expand directories down to the first few objects so something is visible.
      setExpanded((x) => new Set([...x, ...objects.filter((o) => o.kind === "dir").slice(0, 6).map((o) => `${file}:${o.path}`)]));
    } catch (e) {
      useStore.getState().flash(e instanceof ApiError ? e.messages.join(", ") : String(e));
      setOpen((o) => {
        const { [file]: _, ...rest } = o;
        return rest;
      });
    }
  };

  useEffect(() => {
    if (openRoot && !open[openRoot]) toggleFile(openRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRoot]);

  const openSpec = async (path: string) => {
    const s = useStore.getState();
    if (s.dirty && !window.confirm("Discard unsaved changes?")) return;
    try {
      const doc = await api.loadSpec(path);
      s.openDocument(doc.spec, doc.path, doc.base_dir);
    } catch (e) {
      s.flash(e instanceof ApiError ? e.messages.join("; ") : String(e));
    }
  };

  return (
    <div className="browser">
      <div className="browser-path">
        <button title="Parent directory" disabled={!parent} onClick={() => parent && go(parent)}>↑</button>
        <input value={dirInput} onChange={(e) => setDirInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go(dirInput)} spellCheck={false} title={dir} />
      </div>
      {error && <div className="banner error small">{error}</div>}
      <div className="browser-list">
        {entries.length === 0 && !error && <p className="muted pad">No folders, .root or .yaml files here.</p>}
        {entries.map((e) => (
          <div key={e.path}>
            <div className={`entry ${e.kind}`}
              onClick={() => e.kind === "root" ? toggleFile(e.path) : e.kind === "dir" ? go(e.path) : undefined}
              onDoubleClick={() => e.kind === "spec" && openSpec(e.path)}
              title={e.kind === "spec" ? "Double-click to open" : e.path}>
              <span className="twisty">{e.kind === "root" ? (open[e.path] ? "▾" : "▸") : ""}</span>
              <span className={`icon ${e.kind}`}>{e.kind === "dir" ? "▤" : e.kind === "root" ? "R" : "Y"}</span>
              <span className="name">{e.name}</span>
            </div>
            {e.kind === "root" && open[e.path] === "loading" && <div className="muted pad">Reading…</div>}
            {e.kind === "root" && Array.isArray(open[e.path]) && (
              <RootTree file={e.path} objects={open[e.path] as RootObject[]} expanded={expanded}
                setExpanded={setExpanded} picked={picked} onPick={setPicked} />
            )}
          </div>
        ))}
      </div>
      {picked && <ObjectPanel file={picked.file} obj={picked.obj} />}
    </div>
  );
}

function RootTree(props: {
  file: string;
  objects: RootObject[];
  expanded: Set<string>;
  setExpanded: (f: (s: Set<string>) => Set<string>) => void;
  picked: { file: string; obj: RootObject } | null;
  onPick: (p: { file: string; obj: RootObject }) => void;
}) {
  const { file, objects, expanded, setExpanded, picked, onPick } = props;
  const tree = useMemo(() => buildTree(objects), [objects]);
  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const renderNode = (n: TreeNode, depth: number): JSX.Element => {
    const key = `${file}:${n.path}`;
    if (!n.obj) {
      const isOpen = expanded.has(key);
      return (
        <div key={key}>
          <div className="entry tdir" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => toggle(key)}>
            <span className="twisty">{isOpen ? "▾" : "▸"}</span>
            <span className="icon dir">▤</span>
            <span className="name">{n.name}</span>
          </div>
          {isOpen && n.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    const obj = n.obj;
    const drawable = obj.kind === "h1" || obj.kind === "h2" || obj.kind === "graph";
    const active = picked?.file === file && picked.obj.path === obj.path;
    return (
      <div key={key}
        className={`entry obj ${active ? "active" : ""} ${drawable ? "" : "disabled"}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable={drawable}
        onDragStart={(e) => {
          const payload: DragPayload = { file, obj, mode: "auto" };
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onPick({ file, obj })}
        onDoubleClick={() => drawable && drawObject(file, obj, "auto")}
        title={`${obj.classname}${drawable ? " · drag onto a pad or double-click to draw" : ""}`}>
        <span className="twisty" />
        <span className={`icon ${obj.kind}`}>{KIND_ICON[obj.kind] ?? "··"}</span>
        <span className="name">{n.name}</span>
        <span className="cls">{obj.classname}</span>
      </div>
    );
  };

  return <div className="tree">{tree.map((n) => renderNode(n, 1))}</div>;
}

function drawObject(file: string, obj: RootObject, mode: AddMode, padId?: string) {
  const s = useStore.getState();
  if (!s.spec) {
    s.flash("Create a canvas first (File → New canvas)");
    s.setDialog("new");
    return;
  }
  addObject(file, obj, mode, padId);
}

function ObjectPanel({ file, obj }: { file: string; obj: RootObject }) {
  const spec = useStore((s) => s.spec);
  const selection = useStore((s) => s.selection);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pad, setPad] = useState<string | undefined>(undefined);

  useEffect(() => {
    setPreview(null);
    if (obj.kind === "h1" || obj.kind === "h2" || obj.kind === "graph")
      api.preview(file, obj.path).then(setPreview).catch(() => setPreview(null));
  }, [file, obj.path]);

  const padIds = spec?.pads.map((p) => p.id) ?? [];
  const current = spec ? targetPad(spec, pad && padIds.includes(pad) ? pad : undefined).id : undefined;
  useEffect(() => setPad(undefined), [selection]);

  const btn = (label: string, mode: AddMode, title?: string) => (
    <button title={title} onClick={() => drawObject(file, obj, mode, current)}>{label}</button>
  );

  return (
    <div className="object-panel">
      <div className="object-title">
        <b>{obj.path.split("/").pop()}</b>
        <span className="muted">{obj.classname}</span>
      </div>
      {preview && <Sparkline preview={preview} />}
      {preview && (
        <div className="muted small">
          {preview.kind === "graph" ? `${preview.npoints} points` : `${Array.isArray(preview.nbins) ? preview.nbins.join("×") : preview.nbins} bins`}
          {" · "}x ∈ [{fmt(preview.xmin)}, {fmt(preview.xmax)}]
          {preview.integral !== undefined && ` · ∫ = ${fmt(preview.integral)}`}
        </div>
      )}
      {spec && padIds.length > 1 && (
        <label className="row">
          <span className="row-label">Into pad</span>
          <select value={current} onChange={(e) => setPad(e.target.value)}>
            {padIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      )}
      <div className="object-actions">
        {obj.kind === "h1" && (
          <>
            {btn("Line", "step", "Draw as a step line")}
            {btn("Filled", "fill", "Draw as a filled histogram")}
            {btn("Data points", "data", "Draw as black points with Poisson errors")}
            {btn("Add to stack", "stack", "Add to the pad's stacked histogram (created if needed)")}
          </>
        )}
        {obj.kind === "h2" && btn("Draw 2D map", "auto")}
        {obj.kind === "graph" && btn("Draw graph", "auto")}
        {obj.kind === "other" && <span className="muted">This object type cannot be drawn.</span>}
      </div>
    </div>
  );
}

const fmt = (n: number) => (Math.abs(n) >= 1e5 || (n !== 0 && Math.abs(n) < 1e-2) ? n.toExponential(2) : Number(n.toPrecision(4)).toString());

function Sparkline({ preview }: { preview: Preview }) {
  const v = preview.values;
  if (!v || v.length === 0) return null;
  const max = Math.max(...v, 0) || 1;
  const min = Math.min(...v, 0);
  const w = 240, h = 56;
  const y = (x: number) => h - 2 - ((x - min) / (max - min || 1)) * (h - 4);
  let d: string;
  if (preview.kind === "graph") {
    d = v.map((p, i) => `${i ? "L" : "M"}${(i / Math.max(1, v.length - 1)) * w},${y(p)}`).join(" ");
  } else {
    const bw = w / v.length;
    d = `M0,${y(0)} ` + v.map((p, i) => `L${i * bw},${y(p)} L${(i + 1) * bw},${y(p)}`).join(" ") + ` L${w},${y(0)}`;
  }
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} />
    </svg>
  );
}
