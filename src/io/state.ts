import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parse, stringify } from "yaml";
import { DEFAULT_MODEL } from "../ai/openai";
import { emptyDataset } from "../core/dataset";
import { asNumber, asRecord, asString, asStringList, defaultProfile, DEFAULT_COMPANY_OVERRIDES, sanitizeOverrides, sanitizeProfile } from "../core/profile";
import type {
  AiClassification, AiMessage, Dataset, LogEntry, OutreachMode, Party, Profile, RawConnection, SourceOrigin,
  StoredInvitation, StoredMessage, Tracking,
} from "../core/types";

export const STATE_FORMAT = "linkedin-network-tool";
export const STATE_VERSION = 1;

export interface AiState {
  model: string;
  messages: Record<string, AiMessage>;
  classifications: Record<string, AiClassification>;
}

export interface AppState {
  profile: Profile;
  overrides: Record<string, string>;
  dataset: Dataset;
  tracking: Record<string, Tracking>;
  log: LogEntry[];
  ai: AiState;
}

export function emptyState(): AppState {
  return {
    profile: defaultProfile(),
    overrides: { ...DEFAULT_COMPANY_OVERRIDES },
    dataset: emptyDataset(),
    tracking: {},
    log: [],
    ai: { model: DEFAULT_MODEL, messages: {}, classifications: {} },
  };
}

const FILES = {
  meta: "meta.yaml",
  profile: "profile.yaml",
  connections: "connections.yaml",
  messages: "messages.yaml",
  invitations: "invitations.yaml",
  tracking: "tracking.yaml",
  ai: "ai.yaml",
} as const;

const YAML_OPTIONS = { lineWidth: 0, minContentWidth: 0 } as const;

function yaml(value: unknown): Uint8Array {
  return strToU8(stringify(value, YAML_OPTIONS));
}

export function exportStateZip(state: AppState): Uint8Array {
  const d = state.dataset;
  const meta = {
    format: STATE_FORMAT,
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    owner: d.owner,
    sync: d.sync,
    importMeta: d.importMeta,
    counts: { connections: d.connections.length, messages: d.messages.length, invitations: d.invitations.length },
  };
  return zipSync(
    {
      [FILES.meta]: yaml(meta),
      [FILES.profile]: yaml({ profile: state.profile, companyOverrides: state.overrides }),
      [FILES.connections]: yaml(d.connections),
      [FILES.messages]: yaml(d.messages),
      [FILES.invitations]: yaml(d.invitations),
      [FILES.tracking]: yaml({ tracking: state.tracking, log: state.log }),
      [FILES.ai]: yaml(state.ai),
    },
    { level: 6 },
  );
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const origin = (v: unknown): SourceOrigin => (v === "linkedin" ? "linkedin" : "export");
const MODES: OutreachMode[] = ["cold", "reconnect", "nudge"];

function party(v: unknown): Party {
  const r = asRecord(v);
  return { name: asString(r.name, 300), slug: asString(r.slug, 200).toLowerCase() };
}

function connection(v: unknown): RawConnection {
  const r = asRecord(v);
  return {
    firstName: asString(r.firstName, 300),
    lastName: asString(r.lastName, 300),
    profileUrl: asString(r.profileUrl, 500),
    email: asString(r.email, 300),
    company: asString(r.company, 300),
    position: asString(r.position, 500),
    connectedOn: asString(r.connectedOn, 40),
    origin: origin(r.origin),
    sourceRow: asNumber(r.sourceRow, 0),
    issues: asStringList(r.issues, 20),
  };
}

function message(v: unknown): StoredMessage {
  const r = asRecord(v);
  return {
    id: asString(r.id, 200),
    conversationId: asString(r.conversationId, 300),
    at: asString(r.at, 40),
    outgoing: r.outgoing === true,
    from: party(r.from),
    to: list(r.to).map(party).slice(0, 50),
    content: asString(r.content, 4000),
    origin: origin(r.origin),
  };
}

function invitation(v: unknown): StoredInvitation {
  const r = asRecord(v);
  return {
    id: asString(r.id, 200),
    at: asString(r.at, 40),
    outgoing: r.outgoing === true,
    counterpart: party(r.counterpart),
    note: asString(r.note, 500),
    origin: origin(r.origin),
  };
}

export function sanitizeTracking(v: unknown): Tracking {
  const r = asRecord(v);
  return {
    status: asString(r.status, 60) || "Not started",
    dateSent: asString(r.dateSent, 10),
    replied: asString(r.replied, 20),
    nextStep: asString(r.nextStep, 300),
    notes: asString(r.notes, 4000),
  };
}

export function sanitizeLog(v: unknown): LogEntry {
  const r = asRecord(v);
  return {
    profileUrl: asString(r.profileUrl, 500),
    fullName: asString(r.fullName, 300),
    channel: asString(r.channel, 60),
    outgoing: r.outgoing !== false,
    sentAt: asString(r.sentAt, 10),
    note: asString(r.note, 1000),
  };
}

function aiMessage(v: unknown): AiMessage | null {
  const r = asRecord(v);
  const mode = asString(r.mode) as OutreachMode;
  if (!MODES.includes(mode)) return null;
  const text = (k: string): string => asString(r[k], 6000);
  return {
    mode,
    model: asString(r.model, 100),
    generatedAt: asString(r.generatedAt, 40),
    note_ar: text("note_ar"),
    note_en: text("note_en"),
    message_ar: text("message_ar"),
    message_en: text("message_en"),
    followup_ar: text("followup_ar"),
    followup_en: text("followup_en"),
  };
}

function aiClassification(v: unknown): AiClassification {
  const r = asRecord(v);
  const out: AiClassification = { model: asString(r.model, 100) };
  for (const k of ["seniority", "function", "industry"] as const) {
    const value = asString(r[k], 100);
    if (value) out[k] = value;
  }
  return out;
}

function recordOf<T>(v: unknown, fn: (x: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(asRecord(v))) {
    const value = fn(x);
    if (value !== null) out[k.slice(0, 300)] = value;
  }
  return out;
}

function readYaml(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name];
  if (!bytes) return undefined;
  return parse(strFromU8(bytes), { maxAliasCount: 50, uniqueKeys: false });
}

interface Sections {
  meta: unknown;
  profile: unknown;
  connections: unknown;
  messages: unknown;
  invitations: unknown;
  tracking: unknown;
  ai: unknown;
}

export function importStateZip(bytes: Uint8Array): AppState {
  const names = new Set<string>(Object.values(FILES));
  const entries = unzipSync(bytes, { filter: (f) => names.has(f.name.split("/").pop() ?? "") });
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) files[path.split("/").pop() ?? path] = data;
  return sanitizeState({
    meta: readYaml(files, FILES.meta),
    profile: readYaml(files, FILES.profile),
    connections: readYaml(files, FILES.connections),
    messages: readYaml(files, FILES.messages),
    invitations: readYaml(files, FILES.invitations),
    tracking: readYaml(files, FILES.tracking),
    ai: readYaml(files, FILES.ai),
  });
}

export function reviveState(raw: unknown): AppState | null {
  const r = asRecord(raw);
  const dataset = asRecord(r.dataset);
  if (!("profile" in r) || !("dataset" in r)) return null;
  return sanitizeState({
    meta: { format: STATE_FORMAT, version: STATE_VERSION, owner: dataset.owner, sync: dataset.sync, importMeta: dataset.importMeta },
    profile: { profile: r.profile, companyOverrides: r.overrides },
    connections: dataset.connections,
    messages: dataset.messages,
    invitations: dataset.invitations,
    tracking: { tracking: r.tracking, log: r.log },
    ai: r.ai,
  });
}

function sanitizeState(sections: Sections): AppState {
  const meta = asRecord(sections.meta);
  if (meta.format !== STATE_FORMAT) throw new Error("This zip is not a saved state of this tool (meta.yaml is missing or has another format).");
  if (asNumber(meta.version, 0) > STATE_VERSION) throw new Error("This state file was saved by a newer version of the tool.");

  const state = emptyState();
  const profileFile = asRecord(sections.profile);
  state.profile = sanitizeProfile(profileFile.profile);
  if ("companyOverrides" in profileFile) state.overrides = sanitizeOverrides(profileFile.companyOverrides);

  const owner = asRecord(meta.owner);
  const sync = asRecord(meta.sync);
  const im = asRecord(meta.importMeta);
  state.dataset = {
    owner: { name: asString(owner.name, 300), slug: asString(owner.slug, 200), identityMethod: asString(owner.identityMethod, 100) || "not determined" },
    connections: list(sections.connections).map(connection),
    messages: list(sections.messages).map(message).filter((m) => m.id),
    invitations: list(sections.invitations).map(invitation).filter((i) => i.id),
    importMeta: {
      exportImportedAt: asString(im.exportImportedAt, 40),
      exportLabel: asString(im.exportLabel, 300),
      headerFound: asStringList(im.headerFound, 30),
      skippedRows: asNumber(im.skippedRows, 0),
      filesFound: asStringList(im.filesFound, 20),
      filesMissing: asStringList(im.filesMissing, 20),
      warnings: asStringList(im.warnings, 50),
    },
    sync: {
      lastSyncAt: asString(sync.lastSyncAt, 40),
      newestConnectionAt: asString(sync.newestConnectionAt, 40),
      newestMessageAt: asString(sync.newestMessageAt, 40),
    },
  };

  const tracking = asRecord(sections.tracking);
  state.tracking = recordOf(tracking.tracking, sanitizeTracking);
  state.log = list(tracking.log).map(sanitizeLog);

  const ai = asRecord(sections.ai);
  state.ai = {
    model: asString(ai.model, 100) || DEFAULT_MODEL,
    messages: recordOf(ai.messages, aiMessage),
    classifications: recordOf(ai.classifications, aiClassification),
  };
  return state;
}

export function stateFileName(): string {
  return `linkedin-network-state-${new Date().toISOString().slice(0, 10)}.zip`;
}
