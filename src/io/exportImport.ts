import { unzipSync } from "fflate";
import { postKey, safeUrl, type Post } from "../core/content";
import { parseDate } from "../core/dates";
import { nameKey, slugOf } from "../core/text";
import type { ExportImport, MeProfile, Owner, Party, RawConnection, StoredInvitation, StoredMessage } from "../core/types";
import { cell, decodeBytes, tableFrom, type Table } from "./csv";

export interface NamedFile {
  name: string;
  bytes: Uint8Array;
}

const WANTED = ["connections.csv", "messages.csv", "invitations.csv", "profile.csv", "positions.csv", "skills.csv", "education.csv", "shares.csv"];

export function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).toLowerCase();
}

function isWanted(path: string): boolean {
  const base = baseName(path);
  return WANTED.includes(base) || (base.startsWith("connections") && base.endsWith(".csv"));
}

export function expandFiles(files: NamedFile[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(f.bytes, { filter: (entry) => isWanted(entry.name) });
      for (const [path, bytes] of Object.entries(entries)) out.set(baseName(path), bytes);
    } else if (isWanted(f.name)) {
      out.set(baseName(f.name), f.bytes);
    }
  }
  if (!out.has("connections.csv")) {
    for (const [name, bytes] of out) {
      if (name.startsWith("connections")) {
        out.set("connections.csv", bytes);
        break;
      }
    }
  }
  return out;
}

const CONNECTION_HEADERS: Record<string, keyof RawConnection> = {
  "first name": "firstName", firstname: "firstName",
  "last name": "lastName", lastname: "lastName",
  url: "profileUrl", "profile url": "profileUrl", "public profile url": "profileUrl",
  "email address": "email", email: "email", emailaddress: "email",
  company: "company", "company name": "company",
  position: "position", title: "position",
  "connected on": "connectedOn", connectedon: "connectedOn",
};

export function readConnections(text: string): { records: RawConnection[]; header: string[]; skipped: number } {
  const table = tableFrom(text, (cells) => cells.includes("first name") && cells.includes("last name"));
  if (!table) throw new Error("This does not look like a LinkedIn Connections.csv (no First Name / Last Name header).");
  const mapping = table.header.map((h) => CONNECTION_HEADERS[h]);
  const width = table.header.length;
  const records: RawConnection[] = [];
  let skipped = 0;

  table.rows.forEach((raw, i) => {
    let values = raw;
    const issues: string[] = [];
    if (raw.length > width) {
      const surplus = raw.length - width;
      const merged = raw.slice(1, 2 + surplus).map((v) => v.trim()).filter(Boolean).join(", ");
      values = [raw[0] ?? "", merged, ...raw.slice(2 + surplus)];
      issues.push("repaired_shifted_row");
    }
    const rec: RawConnection = {
      firstName: "", lastName: "", profileUrl: "", email: "", company: "", position: "", connectedOn: "",
      origin: "export", sourceRow: i + 2, issues,
    };
    mapping.forEach((field, idx) => {
      if (field && field !== "origin" && field !== "sourceRow" && field !== "issues") rec[field] = (values[idx] ?? "").trim();
    });
    if (!`${rec.firstName} ${rec.lastName}`.trim() && !rec.profileUrl) {
      skipped += 1;
      return;
    }
    if (rec.connectedOn && !parseDate(rec.connectedOn)) issues.push("unparsable_connected_on");
    if (!rec.company) issues.push("missing_company");
    if (!rec.position) issues.push("missing_position");
    if (!rec.profileUrl) issues.push("missing_profile_url");
    records.push(rec);
  });
  return { records, header: table.header, skipped };
}

function readOwner(table: Table | null): string {
  if (!table) return "";
  const row = table.rows[0];
  if (!row) return "";
  return `${cell(row, table.column("first name"))} ${cell(row, table.column("last name"))}`.trim();
}

function parties(names: string, urls: string): Party[] {
  const urlList = urls.split(/[;,\s]+/).map(slugOf).filter(Boolean);
  const nameList = names.split(/,\s*/).map((n) => n.trim()).filter(Boolean);
  if (urlList.length === 0) return names.trim() ? [{ name: names.trim(), slug: "" }] : [];
  return urlList.map((slug, i) => ({ slug, name: urlList.length === nameList.length ? nameList[i] ?? "" : urlList.length === 1 ? names.trim() : "" }));
}

async function digest(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash).slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function messageTimestamp(value: string): string {
  const v = value.trim().replace(/\s*(UTC|GMT|Z)$/i, "");
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(v);
  if (iso) return `${iso[1]}T${iso[2]!.length === 5 ? `${iso[2]}:00` : iso[2]}Z`;
  return parseDate(v, false) ?? "";
}

async function readMessages(table: Table, owner: Owner): Promise<StoredMessage[]> {
  const col = {
    conv: table.column("conversation id"),
    from: table.column("from"),
    fromUrl: table.column("sender profile url"),
    to: table.column("to"),
    toUrl: table.column("recipient profile urls"),
    date: table.column("date"),
    content: table.column("content"),
  };
  const senders = new Map<string, number>();
  if (!owner.name) {
    const conversationsPerSender = new Map<string, Set<string>>();
    for (const row of table.rows) {
      const from = cell(row, col.from);
      if (!from) continue;
      const set = conversationsPerSender.get(from) ?? new Set<string>();
      set.add(cell(row, col.conv) || String(set.size));
      conversationsPerSender.set(from, set);
    }
    for (const [name, set] of conversationsPerSender) senders.set(name, set.size);
    const top = [...senders.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      owner.name = top[0];
      owner.identityMethod = "most frequent sender in messages.csv";
    }
  }
  const ownerKey = nameKey(owner.name);
  if (!owner.slug) {
    for (const row of table.rows) {
      if (nameKey(cell(row, col.from)) === ownerKey) {
        const slug = slugOf(cell(row, col.fromUrl));
        if (slug) {
          owner.slug = slug;
          break;
        }
      }
    }
  }

  const out: StoredMessage[] = [];
  for (const row of table.rows) {
    const fromName = cell(row, col.from);
    const fromSlug = slugOf(cell(row, col.fromUrl));
    const outgoing = owner.slug && fromSlug ? fromSlug === owner.slug : ownerKey !== "" && nameKey(fromName) === ownerKey;
    const to = parties(cell(row, col.to), cell(row, col.toUrl));
    if (!fromName && !fromSlug && to.length === 0) continue;
    const at = messageTimestamp(cell(row, col.date));
    const conversationId = cell(row, col.conv);
    const content = cell(row, col.content).slice(0, 4000);
    out.push({
      id: `x-${await digest(`${conversationId}|${at}|${fromSlug || fromName}|${content.slice(0, 200)}`)}`,
      conversationId,
      at,
      outgoing,
      from: { name: fromName, slug: fromSlug },
      to,
      content,
      origin: "export",
    });
  }
  return out;
}

async function readInvitations(table: Table, owner: Owner): Promise<StoredInvitation[]> {
  const col = {
    from: table.column("from"),
    to: table.column("to"),
    sentAt: table.column("sent at"),
    message: table.column("message"),
    direction: table.column("direction"),
    inviter: table.column("inviterprofileurl"),
    invitee: table.column("inviteeprofileurl"),
    url: table.column("profile url"),
  };
  const ownerKey = nameKey(owner.name);
  const out: StoredInvitation[] = [];
  for (const row of table.rows) {
    const from = cell(row, col.from);
    const to = cell(row, col.to);
    const direction = cell(row, col.direction).toUpperCase();
    const outgoing = direction === "OUTGOING" || direction === "SENT" ? true
      : direction === "INCOMING" || direction === "RECEIVED" ? false
      : ownerKey !== "" && nameKey(from) === ownerKey;
    const name = outgoing ? to : from;
    if (!name) continue;
    let slug = slugOf((outgoing ? cell(row, col.invitee) : cell(row, col.inviter)) || cell(row, col.url));
    if (slug && slug === owner.slug) slug = "";
    const at = parseDate(cell(row, col.sentAt), false) ?? "";
    out.push({
      id: `x-${await digest(`${name}|${slug}|${at}|${outgoing}`)}`,
      at,
      outgoing,
      counterpart: { name, slug },
      note: cell(row, col.message).slice(0, 500),
      origin: "export",
    });
  }
  return out;
}

function shareText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).replace(/""/g, '"').trim();
  return text.slice(0, 6000);
}

export async function readShares(table: Table): Promise<Post[]> {
  const col = {
    date: table.column("date"),
    link: table.column("sharelink", "share link"),
    text: table.column("sharecommentary", "share commentary", "commentary"),
    shared: table.column("sharedurl", "shared url"),
    media: table.column("mediaurl", "media url"),
  };
  const out = new Map<string, Post>();
  for (const row of table.rows) {
    const link = cell(row, col.link).trim();
    const text = shareText(cell(row, col.text));
    if (!text && !link) continue;
    const at = messageTimestamp(cell(row, col.date));
    const id = postKey(link) || `x-${await digest(`${at}|${link}|${text.slice(0, 200)}`)}`;
    out.set(id, { id, at, text, url: safeUrl(link), sharedUrl: safeUrl(cell(row, col.shared)), media: cell(row, col.media).trim(), origin: "export", metrics: null });
  }
  return [...out.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function suggestProfile(files: Map<string, Uint8Array>): Partial<MeProfile> {
  const read = (name: string, required: string): Table | null => {
    const bytes = files.get(name);
    return bytes ? tableFrom(decodeBytes(bytes), (cells) => cells.includes(required)) : null;
  };
  const out: Partial<MeProfile> = {};
  const profile = read("profile.csv", "first name");
  const p = profile?.rows[0];
  if (profile && p) {
    const first = cell(p, profile.column("first name"));
    out.first_name = first;
    out.full_name = `${first} ${cell(p, profile.column("last name"))}`.trim();
    out.headline = cell(p, profile.column("headline"));
    out.location = cell(p, profile.column("geo location", "location"));
  }
  const positions = read("positions.csv", "title");
  const current = positions?.rows[0];
  if (positions && current) {
    out.current_role = cell(current, positions.column("title"));
    out.current_company = cell(current, positions.column("company name"));
    const years = positions.rows
      .flatMap((r) => [cell(r, positions.column("started on")), cell(r, positions.column("finished on"))])
      .map((v) => /(?:19|20)\d{2}/.exec(v)?.[0])
      .filter((v): v is string => Boolean(v))
      .map(Number);
    if (years.length > 0) out.years_experience = Math.max(0, new Date().getFullYear() - Math.min(...years));
  }
  const skills = read("skills.csv", "name");
  if (skills) out.top_skills = skills.rows.map((r) => cell(r, skills.column("name"))).filter(Boolean).slice(0, 8);
  const education = read("education.csv", "school name");
  const e = education?.rows[0];
  if (education && e) out.education = [cell(e, education.column("degree name")), cell(e, education.column("school name"))].filter(Boolean).join(", ");
  return out;
}

export async function importExport(files: NamedFile[], label: string): Promise<ExportImport> {
  const expanded = expandFiles(files);
  const connectionsBytes = expanded.get("connections.csv");
  if (!connectionsBytes) throw new Error("No Connections.csv found. Upload the export .zip or the Connections.csv file.");

  const { records, header, skipped } = readConnections(decodeBytes(connectionsBytes));
  const owner: Owner = { name: "", slug: "", identityMethod: "not determined" };
  const found: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const profileBytes = expanded.get("profile.csv");
  if (profileBytes) {
    owner.name = readOwner(tableFrom(decodeBytes(profileBytes), (c) => c.includes("first name") && c.includes("last name")));
    if (owner.name) {
      owner.identityMethod = "Profile.csv";
      found.push("Profile.csv");
    }
  }

  let messages: StoredMessage[] = [];
  const messagesBytes = expanded.get("messages.csv");
  const messagesTable = messagesBytes ? tableFrom(decodeBytes(messagesBytes), (c) => c.includes("from") && c.includes("to")) : null;
  if (messagesTable) {
    found.push("messages.csv");
    messages = await readMessages(messagesTable, owner);
  } else {
    missing.push("messages.csv");
    warnings.push("messages.csv was not in the export, so DM history is unknown until the extension syncs messages");
  }

  let invitations: StoredInvitation[] = [];
  const invitationsBytes = expanded.get("invitations.csv");
  const invitationsTable = invitationsBytes ? tableFrom(decodeBytes(invitationsBytes), (c) => c.includes("from") && c.includes("to")) : null;
  if (invitationsTable) {
    found.push("Invitations.csv");
    invitations = await readInvitations(invitationsTable, owner);
  } else {
    missing.push("Invitations.csv");
  }

  let posts: Post[] = [];
  const sharesBytes = expanded.get("shares.csv");
  const sharesTable = sharesBytes ? tableFrom(decodeBytes(sharesBytes), (c) => c.includes("date") && (c.includes("sharecommentary") || c.includes("sharelink"))) : null;
  if (sharesTable) {
    found.push("Shares.csv");
    posts = await readShares(sharesTable);
  } else {
    missing.push("Shares.csv");
  }

  return {
    owner,
    connections: records,
    messages,
    invitations,
    posts,
    suggestedProfile: suggestProfile(expanded),
    meta: {
      exportImportedAt: new Date().toISOString(),
      exportLabel: label,
      headerFound: header,
      skippedRows: skipped,
      filesFound: found,
      filesMissing: missing,
      warnings,
    },
  };
}
