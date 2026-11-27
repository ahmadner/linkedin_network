export type Goal = "job_search" | "sales" | "partnership" | "networking";
export type Bucket = "A" | "B" | "C" | "D" | "X";
export type OutreachMode = "cold" | "reconnect" | "nudge";
export type Lang = "ar" | "en";
export type SourceOrigin = "linkedin" | "export";

export interface MeProfile {
  full_name: string;
  first_name: string;
  headline: string;
  current_role: string;
  current_company: string;
  years_experience: number;
  location: string;
  target_roles: string[];
  top_skills: string[];
  highlight_ar: string;
  highlight_en: string;
  cv_link: string;
  portfolio_link: string;
  github: string;
  email: string;
  phone: string;
  education: string;
}

export interface Targeting {
  goal: Goal;
  target_functions: string[];
  target_industries: string[];
  target_companies: string[];
  excluded_companies: string[];
  weights: Record<string, number>;
  buckets: { A: number; B: number; C: number };
}

export interface Messaging {
  signature_ar: string;
  signature_en: string;
  note_char_limit: number;
  message_char_limit: number;
}

export interface Profile {
  me: MeProfile;
  targeting: Targeting;
  messaging: Messaging;
}

export interface RawConnection {
  firstName: string;
  lastName: string;
  profileUrl: string;
  email: string;
  company: string;
  position: string;
  connectedOn: string;
  origin: SourceOrigin;
  sourceRow: number;
  issues: string[];
}

export interface Party {
  name: string;
  slug: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  at: string;
  outgoing: boolean;
  from: Party;
  to: Party[];
  content: string;
  origin: SourceOrigin;
}

export interface StoredInvitation {
  id: string;
  at: string;
  outgoing: boolean;
  counterpart: Party;
  note: string;
  origin: SourceOrigin;
}

export interface HistoryEvent {
  slug: string;
  name: string;
  at: string | null;
  outgoing: boolean;
  kind: "message" | "invitation" | "log";
  source: string;
  channel: string;
}

export interface Owner {
  name: string;
  slug: string;
  identityMethod: string;
}

export interface SyncState {
  lastSyncAt: string;
  newestConnectionAt: string;
  newestMessageAt: string;
}

export interface ImportMeta {
  exportImportedAt: string;
  exportLabel: string;
  headerFound: string[];
  skippedRows: number;
  filesFound: string[];
  filesMissing: string[];
  warnings: string[];
}

export interface ExportImport {
  owner: Owner;
  connections: RawConnection[];
  messages: StoredMessage[];
  invitations: StoredInvitation[];
  meta: ImportMeta;
  suggestedProfile: Partial<MeProfile>;
}

export interface Dataset {
  owner: Owner;
  connections: RawConnection[];
  messages: StoredMessage[];
  invitations: StoredInvitation[];
  importMeta: ImportMeta;
  sync: SyncState;
}

export interface LogEntry {
  profileUrl: string;
  fullName: string;
  channel: string;
  outgoing: boolean;
  sentAt: string;
  note: string;
}

export interface Tracking {
  status: string;
  dateSent: string;
  replied: string;
  nextStep: string;
  notes: string;
  tags: string[];
}

export interface MessageSet {
  note_ar: string;
  note_en: string;
  message_ar: string;
  message_en: string;
  followup_ar: string;
  followup_en: string;
}

export interface AiMessage extends MessageSet {
  mode: OutreachMode;
  model: string;
  generatedAt: string;
}

export interface AiTemplate {
  template: string;
  ar: string;
  en: string;
  model: string;
  generatedAt: string;
}

export type ConversationStage = "intro" | "in_progress" | "opportunity" | "waiting_them" | "waiting_me" | "gone_cold" | "closed";
export type ConversationTone = "positive" | "neutral" | "negative";

export interface ConversationAnalysis {
  model: string;
  generatedAt: string;
  messageCount: number;
  lastMessageAt: string;
  stage: ConversationStage;
  tone: ConversationTone;
  summary_ar: string;
  next_step_ar: string;
  reply_ar: string;
  reply_en: string;
}

export interface SuggestedCompany {
  name: string;
  why: string;
  roles: string[];
}

export interface SuggestedPeopleType {
  title: string;
  why: string;
}

export interface AiSuggestions {
  model: string;
  generatedAt: string;
  companies: SuggestedCompany[];
  people: SuggestedPeopleType[];
  actions: string[];
}

export interface AiClassification {
  seniority?: string;
  function?: string;
  industry?: string;
  model: string;
}

export interface ContactHistory {
  sentByMe: number;
  received: number;
  invitationSent: boolean;
  invitationReceived: boolean;
  firstContact: string | null;
  lastContact: string | null;
  lastDirection: string;
  channels: string[];
  sources: string[];
}

export interface Contact extends MessageSet {
  id: string;
  idx: number;
  firstName: string;
  lastName: string;
  fullName: string;
  greetingName: string;
  profileUrl: string;
  slug: string;
  email: string;
  emailValid: boolean;
  companyClean: string;
  companyRaw: string;
  companyKey: string;
  industry: string;
  positionClean: string;
  positionPrimary: string;
  seniority: string;
  seniorityRank: number;
  function: string;
  isRecruiter: boolean;
  isDecisionMaker: boolean;
  connectedDate: string | null;
  yearsConnected: number | null;
  country: string;
  evidence: string;
  issues: string[];
  companyContactCount: number;
  history: ContactHistory;
  contactedBefore: boolean;
  contactedBeforeText: string;
  historyMatch: string;
  daysSinceContact: number | null;
  outreachAdvice: string;
  mode: OutreachMode;
  modeLabel: string;
  archetype: string;
  archetypeLabel: string;
  score: number;
  bucket: Bucket;
  scoreBreakdown: string;
  tracking: Tracking;
  ai: AiMessage | null;
  aiClassified: boolean;
}

export interface CompanyRow {
  key: string;
  name: string;
  industry: string;
  count: number;
  bestScore: number;
  avgScore: number;
  topSeniority: string;
  topContact: string;
  topRole: string;
  hasRecruiter: boolean;
  decisionMakers: number;
  functions: string;
  emails: number;
}

export interface QualityReport {
  sources: string[];
  headerFound: string[];
  warnings: string[];
  rowsInFile: number;
  skippedRows: number;
  duplicatesRemoved: number;
  historyFound: string[];
  historyMissing: string[];
  ownerName: string;
  identityMethod: string;
  messagesTotal: number;
  invitationsTotal: number;
  logTotal: number;
  trackedTotal: number;
}

export interface Analysis {
  contacts: Contact[];
  companies: CompanyRow[];
  quality: QualityReport;
  profileGaps: string[];
}
