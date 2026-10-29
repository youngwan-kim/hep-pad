import type {
  EffectiveLayout,
  FsEntry,
  LoadedSpec,
  PlotSpec,
  Preview,
  RenderResponse,
  RootObject,
} from "./types";

export class ApiError extends Error {
  constructor(public messages: string[]) {
    super(messages.join("\n"));
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let messages = [`${res.status} ${res.statusText}`];
    try {
      const body = await res.json();
      messages = Array.isArray(body.detail) ? body.detail.map(String) : [String(body.detail)];
    } catch {
      /* not JSON */
    }
    throw new ApiError(messages);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  session: () =>
    request<{ start_dir: string; open_root: string | null; initial: LoadedSpec | null; styles: string[] }>(
      "/api/session",
    ),
  defaults: (style: string) => request<EffectiveLayout>(`/api/defaults?${q({ style })}`),
  fs: (dir?: string) =>
    request<{ dir: string; parent: string | null; entries: FsEntry[] }>(
      `/api/fs${dir ? `?${q({ dir })}` : ""}`,
    ),
  rootObjects: (file: string) => request<{ objects: RootObject[] }>(`/api/root?${q({ file })}`),
  preview: (file: string, path: string) => request<Preview>(`/api/root/preview?${q({ file, path })}`),
  render: (spec: PlotSpec, base_dir: string, signal?: AbortSignal) =>
    request<RenderResponse>("/api/render", post({ spec, base_dir }, signal)),
  loadSpec: (path: string) => request<LoadedSpec>(`/api/spec?${q({ path })}`),
  saveSpec: (spec: PlotSpec, base_dir: string, path: string, script: boolean, images: string[]) =>
    request<LoadedSpec & { written: string[] }>(
      "/api/spec/save",
      post({ spec, base_dir, path, script, images }),
    ),
  async exportFile(spec: PlotSpec, base_dir: string, format: string, name: string) {
    const res = await fetch("/api/export", post({ spec, base_dir, format, name }));
    if (!res.ok) throw new ApiError([`export failed: ${res.status}`]);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
