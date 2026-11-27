import { importExport, type NamedFile } from "./exportImport";
import { exportStateZip, importStateZip, type AppState } from "./state";

export type WorkerRequest =
  | { id: number; kind: "export"; files: NamedFile[]; label: string }
  | { id: number; kind: "loadState"; bytes: Uint8Array }
  | { id: number; kind: "saveState"; state: AppState };

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

scope.onmessage = (event) => {
  const req = event.data;
  const work = async (): Promise<unknown> => {
    if (req.kind === "export") return importExport(req.files, req.label);
    if (req.kind === "loadState") return importStateZip(req.bytes);
    return exportStateZip(req.state);
  };
  work()
    .then((result) => scope.postMessage({ id: req.id, ok: true, result }, result instanceof Uint8Array ? [result.buffer] : []))
    .catch((error: unknown) => scope.postMessage({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
};
