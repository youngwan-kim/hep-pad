import { useEffect } from "react";
import { addText, deleteSelection } from "./actions";
import { Browser } from "./components/Browser";
import { CanvasDialog } from "./components/CanvasDialog";
import { CanvasView } from "./components/CanvasView";
import { RatioDialog, SaveDialog } from "./components/Dialogs";
import { Inspector } from "./components/Inspector";
import { MenuBar } from "./components/MenuBar";
import { Outline } from "./components/Outline";
import { useStore } from "./store";

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
};

/** Nudge the selected text or dragged legend with the arrow keys (axes fraction). */
function nudge(dx: number, dy: number) {
  const { selection: sel, spec, update } = useStore.getState();
  if (!sel || !spec || (sel.type !== "annotation" && sel.type !== "legend")) return false;
  const pad = spec.pads.find((p) => p.id === sel.pad);
  if (!pad) return false;
  if (sel.type === "annotation") {
    const a = pad.annotations[sel.index];
    if (a?.kind !== "text" || a.coords !== "axes") return false;
    update((s) => {
      const t = s.pads.find((p) => p.id === sel.pad)!.annotations[sel.index];
      if (t.kind === "text") t.xy = [+(t.xy[0] + dx).toFixed(4), +(t.xy[1] + dy).toFixed(4)];
    }, `nudge.${sel.pad}.${sel.index}`);
    return true;
  }
  if (!pad.legend.bbox) return false;
  update((s) => {
    const lg = s.pads.find((p) => p.id === sel.pad)!.legend;
    lg.bbox = [+(lg.bbox![0] + dx).toFixed(4), +(lg.bbox![1] + dy).toFixed(4)];
  }, `nudge.${sel.pad}.legend`);
  return true;
}

export function App() {
  const ready = useStore((s) => s.ready);
  const spec = useStore((s) => s.spec);
  const dialog = useStore((s) => s.dialog);
  const status = useStore((s) => s.status);

  useEffect(() => {
    useStore.getState().init().catch((e) => useStore.getState().flash(`Cannot reach the server: ${e}`));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (s.spec) s.setDialog("save");
        return;
      }
      if (typing(e) || s.dialog) return;
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        s.select(null);
      } else if (e.key === "t" && !cmd && s.spec) {
        e.preventDefault();
        addText();
      } else if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 0.05 : 0.005;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]!;
        if (nudge(d[0], d[1])) e.preventDefault();
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  if (!ready) return <div className="loading">{status ?? "Connecting…"}</div>;

  return (
    <div className="app">
      <MenuBar />
      <div className="main">
        <aside className="left">
          <div className="panel-title">Browser</div>
          <Browser />
        </aside>
        <main className="center">
          {spec ? <CanvasView /> : (
            <div className="welcome">
              <h1>hep-pad</h1>
              <p>Start with a blank canvas, then drag histograms in from the browser.</p>
              <button className="primary" onClick={() => useStore.getState().setDialog("new")}>New canvas…</button>
              <p className="muted">Or double-click a <code>.yaml</code> plot file on the left to open it.</p>
            </div>
          )}
        </main>
        <aside className="right">
          {spec && (
            <>
              <div className="panel-title">Objects</div>
              <Outline />
              <div className="panel-title">Properties</div>
              <div className="inspector"><Inspector /></div>
            </>
          )}
        </aside>
      </div>
      {status && <div className="toast">{status}</div>}
      {dialog === "new" && <CanvasDialog mode="new" />}
      {dialog === "layout" && <CanvasDialog mode="layout" />}
      {dialog === "save" && <SaveDialog />}
      {dialog === "ratio" && <RatioDialog />}
    </div>
  );
}
