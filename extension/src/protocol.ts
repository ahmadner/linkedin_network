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

export interface CollectedPost {
  id: string;
  urns: string[];
  at: string;
  text: string;
  url: string;
  media: string;
  reactions: number;
  comments: number;
  reposts: number;
  impressions: number;
}

export type PostsSource = "" | "rest" | "graphql";

export interface PostsJob {
  id: string;
  state: JobState;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  since: string;
  owner: Owner;
  source: PostsSource;
  counts: { posts: number; pages: number };
  cursor: { start: number; token: string };
  notes: string[];
  error: string;
}

export type OutboxKind = "message" | "invite";

export interface OutboxDraft {
  key: string;
  kind: OutboxKind;
  slug: string;
  memberId: string;
  name: string;
  text: string;
}

export type OutboxItemState = "pending" | "sent" | "failed";

export interface OutboxItem extends OutboxDraft {
  state: OutboxItemState;
  error: string;
  at: string;
}

export type OutboxState = "running" | "done" | "stopped";

export interface OutboxJob {
  id: string;
  kind: OutboxKind;
  state: OutboxState;
  items: OutboxItem[];
  startedAt: string;
  updatedAt: string;
  nextAt: number;
  error: string;
}

export interface OutboxLimits {
  day: number;
  week: number;
}

export interface OutboxUsage {
  day: number;
  week: number;
  limits: OutboxLimits;
}

export interface Candidate {
  slug: string;
  memberId: string;
  name: string;
  headline: string;
  degree: string;
}

export type Request =
  | { type: "hello" }
  | { type: "outbox-start"; kind: OutboxKind; items: OutboxDraft[] }
  | { type: "outbox-status" }
  | { type: "outbox-cancel" }
  | { type: "candidates" }
  | { type: "start"; since: SyncSince; options: SyncOptions }
  | { type: "status" }
  | { type: "cancel" }
  | { type: "fetch"; part: "connections" | "messages" | "posts"; offset: number; limit: number }
  | { type: "posts-start"; since: string }
  | { type: "posts-status" }
  | { type: "posts-cancel" }
  | { type: "clear" };

export interface HelloResponse {
  ok: true;
  version: string;
  job: JobStatus | null;
  features?: string[];
  postsJob?: PostsJob | null;
}

export interface PostsJobResponse {
  ok: true;
  job: PostsJob | null;
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

export interface OutboxResponse {
  ok: true;
  job: OutboxJob | null;
  usage: Record<OutboxKind, OutboxUsage>;
}

export interface CandidatesResponse {
  ok: true;
  url: string;
  candidates: Candidate[];
}

export interface ErrorResponse {
  ok: false;
  error: string;
}
