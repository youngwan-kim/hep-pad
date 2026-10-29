import { create } from "zustand";
import { ApiError, api } from "./api";
import { sameSelection, type Selection } from "./spec";
import type { EffectiveLayout, PlotSpec, RenderResponse } from "./types";

export type Dialog = null | "new" | "layout" | "save" | "ratio";

interface State {
  ready: boolean;
  startDir: string;
  /** null until the user has created or opened a canvas. */
  spec: PlotSpec | null;
  docPath: string | null;
  /** Directory relative input paths resolve against. */
  baseDir: string;
  dirty: boolean;
  past: PlotSpec[];
  future: PlotSpec[];
  selection: Selection | null;
  render: RenderResponse | null;
  renderErrors: string[] | null;
  rendering: boolean;
  dialog: Dialog;
  status: string | null;
  defaults: Record<string, EffectiveLayout>;
  /** ROOT file the browser should expand on start (from `hep-pad serve file.root`). */
  openRoot: string | null;

  init(): Promise<void>;
  openDocument(spec: PlotSpec, docPath: string | null, baseDir: string): void;
  /** Apply a mutation to a copy of the spec, recording undo history.
   *  Consecutive updates with the same ``key`` (e.g. typing in one field) merge into one step. */
  update(mutate: (spec: PlotSpec) => void, key?: string): void;
  undo(): void;
  redo(): void;
  select(sel: Selection | null): void;
  setDialog(d: Dialog): void;
  flash(msg: string): void;
  getDefaults(style: string): Promise<EffectiveLayout>;
  markSaved(spec: PlotSpec, docPath: string, baseDir: string): void;
}

const HISTORY = 200;
const COALESCE_MS = 1000;
let lastKey: string | undefined;
let lastTime = 0;
let renderTimer: number | undefined;
let renderAbort: AbortController | undefined;
let statusTimer: number | undefined;

export const useStore = create<State>((set, get) => {
  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(async () => {
      const { spec, baseDir } = get();
      if (!spec) return;
      renderAbort?.abort();
      renderAbort = new AbortController();
      set({ rendering: true });
      try {
        const render = await api.render(spec, baseDir, renderAbort.signal);
        set({ render, renderErrors: null, rendering: false });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // Keep showing the last good render; show why the new one failed.
        set({
          renderErrors: e instanceof ApiError ? e.messages : [String(e)],
          rendering: false,
        });
      }
    }, 120);
  }

  return {
    ready: false,
    startDir: "",
    spec: null,
    docPath: null,
    baseDir: "",
    dirty: false,
    past: [],
    future: [],
    selection: null,
    render: null,
    renderErrors: null,
    rendering: false,
    dialog: null,
    status: null,
    defaults: {},
    openRoot: null,

    async init() {
      const s = await api.session();
      set({ ready: true, startDir: s.start_dir, baseDir: s.start_dir, openRoot: s.open_root });
      if (s.initial) get().openDocument(s.initial.spec, s.initial.path, s.initial.base_dir);
      else set({ dialog: "new" });
    },

    openDocument(spec, docPath, baseDir) {
      lastKey = undefined;
      set({ spec, docPath, baseDir, dirty: false, past: [], future: [], selection: null,
            render: null, renderErrors: null, dialog: null });
      scheduleRender();
    },

    update(mutate, key) {
      const { spec, past } = get();
      if (!spec) return;
      const next = structuredClone(spec);
      mutate(next);
      const now = Date.now();
      const merge = key !== undefined && key === lastKey && now - lastTime < COALESCE_MS;
      lastKey = key;
      lastTime = now;
      set({
        spec: next,
        past: merge ? past : [...past.slice(-HISTORY + 1), spec],
        future: [],
        dirty: true,
      });
      scheduleRender();
    },

    undo() {
      const { past, spec, future } = get();
      if (!past.length || !spec) return;
      lastKey = undefined;
      set({ spec: past[past.length - 1], past: past.slice(0, -1), future: [spec, ...future], dirty: true });
      get().select(validSelection(get().selection, get().spec!));
      scheduleRender();
    },

    redo() {
      const { past, spec, future } = get();
      if (!future.length || !spec) return;
      lastKey = undefined;
      set({ spec: future[0], past: [...past, spec], future: future.slice(1), dirty: true });
      get().select(validSelection(get().selection, get().spec!));
      scheduleRender();
    },

    select(selection) {
      if (!sameSelection(selection, get().selection)) set({ selection });
    },

    setDialog(dialog) {
      set({ dialog });
    },

    flash(status) {
      window.clearTimeout(statusTimer);
      set({ status });
      statusTimer = window.setTimeout(() => set({ status: null }), 4000);
    },

    async getDefaults(style) {
      const cached = get().defaults[style];
      if (cached) return cached;
      const d = await api.defaults(style);
      set({ defaults: { ...get().defaults, [style]: d } });
      return d;
    },

    markSaved(spec, docPath, baseDir) {
      // The server rewrote input paths relative to the new location; that is not an undoable edit.
      set({ spec, docPath, baseDir, dirty: false });
      scheduleRender();
    },
  };
});

/** Drop a selection that no longer points at anything (after undo/delete). */
export function validSelection(sel: Selection | null, spec: PlotSpec): Selection | null {
  if (!sel || sel.type === "canvas") return sel;
  const p = spec.pads.find((x) => x.id === sel.pad);
  if (!p) return null;
  if (sel.type === "layer" || sel.type === "member") {
    const l = p.layers.find((x) => x.id === sel.layer);
    if (!l) return { type: "pad", pad: p.id };
    if (sel.type === "member" && (l.kind !== "stack" || !l.members[sel.index]))
      return { type: "layer", pad: p.id, layer: l.id };
  }
  if (sel.type === "annotation" && !p.annotations[sel.index]) return { type: "pad", pad: p.id };
  if (sel.type === "label" && !p.label) return { type: "pad", pad: p.id };
  return sel;
}
