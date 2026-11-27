import { FUNCTION_LABELS, INDUSTRY_LABELS, SENIORITY_LABELS } from "../core/classify";
import { clip } from "../core/messages";
import { asRecord, asString, asStringList } from "../core/profile";
import { TEMPLATE_PURPOSE, type TemplateExtra, type TemplateId } from "../core/templates";
import type { Gap } from "../core/opportunities";
import type { AiClassification, AiMessage, AiSuggestions, AiTemplate, CompanyRow, Contact, MessageSet, Profile, StoredMessage } from "../core/types";
import { chatJson, type AiConfig } from "./openai";

const MESSAGE_SYSTEM = [
  "You write LinkedIn outreach messages for the user described in the input.",
  "Write natural, warm, professional messages that are specific to the recipient's role, company and industry.",
  "Arabic text must be natural Levantine (Jordanian) Arabic as people write on LinkedIn, not formal MSA, and not a literal translation of the English.",
  "Use only facts given in the input. Never invent achievements, mutual friends, past conversations, numbers or job openings.",
  "Respect the outreach mode: cold = first contact with a short introduction; reconnect = they spoke before, pick the thread up and do not introduce the user from scratch; nudge = the user wrote before and got no reply, write one short polite reminder and do not repeat the pitch.",
  "The note fields are connection-request notes and must stay under the given character limit. The message fields are full direct messages under the message limit. The followup fields are one short polite second touch.",
  "Include the CV link only in the message fields, and only if it is given.",
  "Return a JSON object with exactly these string keys: note_ar, note_en, message_ar, message_en, followup_ar, followup_en.",
].join(" ");

function myFacts(profile: Profile): Record<string, unknown> {
  const me = profile.me;
  return {
    name: me.full_name,
    first_name: me.first_name,
    headline: me.headline,
    current_role: me.current_role,
    current_company: me.current_company,
    years_experience: me.years_experience,
    target_roles: me.target_roles,
    top_skills: me.top_skills,
    achievement_ar: me.highlight_ar,
    achievement_en: me.highlight_en,
    cv_link: me.cv_link,
    portfolio_link: me.portfolio_link,
    goal: profile.targeting.goal,
    signature_ar: profile.messaging.signature_ar || me.first_name,
    signature_en: profile.messaging.signature_en || me.first_name,
  };
}

function conversationExcerpt(history: StoredMessage[]): Array<Record<string, string>> {
  return history.slice(-6).map((m) => ({ from: m.outgoing ? "me" : "them", date: m.at.slice(0, 10), text: m.content.slice(0, 400) }));
}

export async function generateMessages(contact: Contact, profile: Profile, history: StoredMessage[], cfg: AiConfig): Promise<AiMessage> {
  const noteLimit = profile.messaging.note_char_limit;
  const messageLimit = profile.messaging.message_char_limit;
  const input = {
    me: myFacts(profile),
    recipient: {
      first_name: contact.greetingName,
      role: contact.positionPrimary || contact.positionClean,
      headline: contact.positionClean,
      company: contact.companyClean,
      industry: contact.industry,
      function: contact.function,
      seniority: contact.seniority,
      archetype: contact.archetypeLabel,
    },
    outreach: {
      mode: contact.mode,
      days_since_last_contact: contact.daysSinceContact,
      messages_i_sent: contact.history.sentByMe,
      messages_they_sent: contact.history.received,
      last_direction: contact.history.lastDirection,
      recent_conversation: conversationExcerpt(history),
    },
    limits: { note_chars: noteLimit, message_chars: messageLimit },
  };
  const { data, model } = await chatJson(cfg, MESSAGE_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const pick = (k: keyof MessageSet, limit: number): string => clip(asString(raw[k], 8000).trim(), limit);
  const result: AiMessage = {
    mode: contact.mode,
    model,
    generatedAt: new Date().toISOString(),
    note_ar: pick("note_ar", noteLimit),
    note_en: pick("note_en", noteLimit),
    message_ar: pick("message_ar", messageLimit),
    message_en: pick("message_en", messageLimit),
    followup_ar: pick("followup_ar", messageLimit),
    followup_en: pick("followup_en", messageLimit),
  };
  if (!result.message_ar && !result.message_en) throw new Error("The model returned empty messages");
  return result;
}

const TEMPLATE_SYSTEM = [
  "You write one LinkedIn direct message for the user described in the input, for the purpose given in the input.",
  "Make it specific to the recipient's role, company and industry, warm, confident and short enough to read on a phone.",
  "Arabic text must be natural Levantine (Jordanian) Arabic as people write on LinkedIn, not formal MSA, and not a literal translation of the English.",
  "Use only facts given in the input. Never invent achievements, mutual friends, past conversations, numbers or job openings. Mention the job title or link only if given.",
  "If the conversation history shows they spoke before, continue naturally from it instead of introducing the user from scratch.",
  "Include the CV link only if it is given and the purpose is a referral or a job question.",
  "Return a JSON object with exactly these string keys: ar, en.",
].join(" ");

export function templateKey(contactId: string, id: TemplateId): string {
  return `${contactId}|${id}`;
}

export async function generateTemplate(contact: Contact, profile: Profile, history: StoredMessage[], id: TemplateId, extra: TemplateExtra, cfg: AiConfig): Promise<AiTemplate> {
  const limit = profile.messaging.message_char_limit;
  const input = {
    purpose: TEMPLATE_PURPOSE[id],
    me: myFacts(profile),
    job: { title: extra.jobTitle.trim(), link: extra.jobLink.trim() },
    recipient: {
      first_name: contact.greetingName,
      role: contact.positionPrimary || contact.positionClean,
      company: contact.companyClean,
      industry: contact.industry,
      function: contact.function,
      seniority: contact.seniority,
    },
    history: {
      spoke_before: contact.contactedBefore,
      days_since_last_contact: contact.daysSinceContact,
      recent_conversation: conversationExcerpt(history),
    },
    limits: { message_chars: limit },
  };
  const { data, model } = await chatJson(cfg, TEMPLATE_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const ar = clip(asString(raw.ar, 8000).trim(), limit);
  const en = clip(asString(raw.en, 8000).trim(), limit);
  if (!ar && !en) throw new Error("The model returned an empty message");
  return { template: id, ar, en, model, generatedAt: new Date().toISOString() };
}

const SUGGEST_SYSTEM = [
  "You are a career networking advisor. The input describes the user, their goals, and a summary of their current LinkedIn network and its gaps.",
  "Suggest real, well-known employers that fit the user's target roles, industries and location (or that hire remotely in their region), favouring ones where the network is thin or empty. Never invent companies; if unsure, suggest fewer.",
  "Also suggest the types of people (job titles) the user should connect with, and a short list of concrete actions for this week.",
  "Write every 'why' and every action in natural Levantine (Jordanian) Arabic, one short sentence each. Keep company names and job titles in English.",
  "Return a JSON object: {\"companies\": [{\"name\": string, \"why\": string, \"roles\": [string]}], \"people\": [{\"title\": string, \"why\": string}], \"actions\": [string]} with at most 12 companies, 8 people types and 6 actions.",
].join(" ");

export async function suggestNetworkMoves(profile: Profile, contacts: Contact[], companies: CompanyRow[], gaps: Gap[], cfg: AiConfig): Promise<AiSuggestions> {
  const industries = new Map<string, number>();
  for (const c of contacts) industries.set(c.industry, (industries.get(c.industry) ?? 0) + 1);
  const input = {
    me: { ...myFacts(profile), location: profile.me.location },
    goals: { target_industries: profile.targeting.target_industries, target_functions: profile.targeting.target_functions, target_companies: profile.targeting.target_companies },
    network: {
      size: contacts.length,
      industries: [...industries].sort((a, b) => b[1] - a[1]).slice(0, 12),
      top_companies: companies.slice(0, 40).map((r) => ({ name: r.name, contacts: r.count, has_recruiter: r.hasRecruiter })),
      gaps: gaps.map((g) => ({ kind: g.kind, target: g.target, level: g.level, contacts: g.contacts })),
    },
  };
  const { data, model } = await chatJson(cfg, SUGGEST_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const result: AiSuggestions = {
    model,
    generatedAt: new Date().toISOString(),
    companies: list(raw.companies).map((x) => {
      const r = asRecord(x);
      return { name: asString(r.name, 120).trim(), why: asString(r.why, 400).trim(), roles: asStringList(r.roles, 6) };
    }).filter((x) => x.name).slice(0, 12),
    people: list(raw.people).map((x) => {
      const r = asRecord(x);
      return { title: asString(r.title, 120).trim(), why: asString(r.why, 400).trim() };
    }).filter((x) => x.title).slice(0, 8),
    actions: asStringList(raw.actions, 6),
  };
  if (result.companies.length === 0 && result.people.length === 0) throw new Error("The model returned no suggestions");
  return result;
}

const CLASSIFY_SYSTEM = [
  "You classify LinkedIn contacts from their job title and employer name.",
  "For every item choose seniority, function and industry strictly from the allowed lists in the input.",
  "Use \"Unknown\" when the title and company do not support a confident answer. Do not guess from the person's name.",
  "Return a JSON object {\"items\": [{\"id\": string, \"seniority\": string, \"function\": string, \"industry\": string}]} with one entry per input id.",
].join(" ");

export const CLASSIFY_BATCH = 40;

export async function classifyBatch(contacts: Contact[], cfg: AiConfig): Promise<Record<string, AiClassification>> {
  const input = {
    allowed: { seniority: SENIORITY_LABELS, function: FUNCTION_LABELS, industry: INDUSTRY_LABELS },
    items: contacts.map((c, i) => ({ id: String(i), title: c.positionClean, company: c.companyRaw })),
  };
  const { data, model } = await chatJson(cfg, CLASSIFY_SYSTEM, JSON.stringify(input));
  const raw = asRecord(data);
  const items = Array.isArray(raw.items) ? raw.items : [];
  const out: Record<string, AiClassification> = {};
  const allowedSeniority = new Set<string>(SENIORITY_LABELS);
  const allowedFunction = new Set(FUNCTION_LABELS);
  const allowedIndustry = new Set(INDUSTRY_LABELS);
  for (const item of items) {
    const r = asRecord(item);
    const contact = contacts[Number(asString(r.id))];
    if (!contact) continue;
    const entry: AiClassification = { model };
    const s = asString(r.seniority);
    const f = asString(r.function);
    const ind = asString(r.industry);
    if (contact.seniority === "Unknown" && allowedSeniority.has(s) && s !== "Unknown") entry.seniority = s;
    if (contact.function === "Unknown" && allowedFunction.has(f) && f !== "Unknown") entry.function = f;
    if (contact.industry === "Unknown" && allowedIndustry.has(ind) && ind !== "Unknown") entry.industry = ind;
    out[contact.id] = entry;
  }
  return out;
}

export function needsClassification(c: Contact, done: Record<string, AiClassification>): boolean {
  return !(c.id in done) && (c.seniority === "Unknown" || c.function === "Unknown" || c.industry === "Unknown") && Boolean(c.positionClean || c.companyRaw);
}
