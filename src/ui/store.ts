import { todayIso } from "../core/dates";
import { analyze } from "../core/pipeline";
import type { Analysis } from "../core/types";
import { saveStoredState } from "../io/db";
import { emptyState, type AppState } from "../io/state";
import { debounce } from "./dom";

type Listener = () => void;

export class Store {
  private current: AppState;
  private cached: Analysis | null = null;
  private readonly listeners = new Set<Listener>();
  saveError = "";
  savedAt = "";

  constructor(initial: AppState = emptyState()) {
    this.current = initial;
  }

  get state(): AppState {
    return this.current;
  }

  get analysis(): Analysis {
    this.cached ??= analyze({
      dataset: this.current.dataset,
      profile: this.current.profile,
      overrides: this.current.overrides,
      tracking: this.current.tracking,
      log: this.current.log,
      aiMessages: this.current.ai.messages,
      aiClassifications: this.current.ai.classifications,
      today: todayIso(),
    });
    return this.cached;
  }

  get hasData(): boolean {
    return this.current.dataset.connections.length > 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(mutate: (state: AppState) => void, options: { recompute?: boolean; emit?: boolean } = {}): void {
    mutate(this.current);
    if (options.recompute !== false) this.cached = null;
    this.persist();
    if (options.emit !== false) this.emit();
  }

  replace(next: AppState): void {
    this.current = next;
    this.cached = null;
    this.persist();
    this.emit();
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  private readonly persist = debounce(() => {
    saveStoredState(this.current)
      .then(() => {
        this.saveError = "";
        this.savedAt = new Date().toLocaleTimeString();
      })
      .catch((error: unknown) => {
        this.saveError = error instanceof Error ? error.message : String(error);
      });
  }, 600);
}
