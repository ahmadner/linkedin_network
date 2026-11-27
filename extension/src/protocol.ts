export interface Party {
  name: string;
  slug: string;
}

export interface Owner extends Party {
  memberId: string;
}

export interface CollectedConnection {
  slug: string;
  firstName: string;
  lastName: string;
  headline: string;
  connectedAt: string;
  photo: string;
}

export interface CollectedMessage {
  id: string;
  conversationId: string;
  at: string;
  from: Party;
  to: Party[];
  content: string;
}

export interface SyncSince {
  newestConnectionAt: string;
  newestMessageAt: string;
}

export interface SyncOptions {
  messages: boolean;
  photos: boolean;
  maxConversations: number;
}

export type JobState = "running" | "done" | "error" | "cancelled";
export type JobPhase = "starting" | "profile" | "connections" | "discovery" | "conversations" | "messages" | "finished";

export interface JobStatus {
  id: string;
  state: JobState;
  phase: JobPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  since: SyncSince;
  options: SyncOptions;
  owner: Owner;
  counts: { connections: number; conversations: number; messages: number };
  cursor: { connectionsStart: number; conversationsBefore: number; conversationIndex: number };
  notes: string[];
  error: string;
}

export type Request =
  | { type: "hello" }
  | { type: "start"; since: SyncSince; options: SyncOptions }
  | { type: "status" }
  | { type: "cancel" }
  | { type: "fetch"; part: "connections" | "messages"; offset: number; limit: number }
  | { type: "clear" };

export interface HelloResponse {
  ok: true;
  version: string;
  job: JobStatus | null;
}

export interface JobResponse {
  ok: true;
  job: JobStatus | null;
}

export interface FetchResponse<T> {
  ok: true;
  items: T[];
  total: number;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}
