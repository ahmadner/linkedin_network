import { parseMe, VOYAGER } from "./linkedin";
import { findPostsGraphqlUrl, graphqlPostsUrl, parsePosts, POSTS_PAGE, restPostsUrl, type PostsPage } from "./posts";
import type { PostsJob } from "./protocol";
import { clearPosts, count, loadPostsJob, putPosts, savePostsJob } from "./store";
import { closeTabs, FEED_URL, isFatal, linkedinTab, openTab, pageRequest, resourceUrls, sleep, StopError } from "./tab";

export const POSTS_ALARM = "lnt-posts";
const MAX_PAGES = 60;
const RESUME_WINDOW_MS = 30 * 60_000;
const EMPTY_PAGES_TO_STOP = 2;

let running = false;
let cancelRequested = false;

const now = (): string => new Date().toISOString();
const politeDelay = (): Promise<void> => sleep(1500 + Math.random() * 1500);

async function save(job: PostsJob): Promise<void> {
  job.updatedAt = now();
  await savePostsJob(job);
}

function note(job: PostsJob, text: string): void {
  if (!job.notes.includes(text)) job.notes.push(text);
}

function newJob(since: string): PostsJob {
  return {
    id: crypto.randomUUID(),
    state: "running",
    startedAt: now(),
    updatedAt: now(),
    finishedAt: "",
    since,
    owner: { name: "", slug: "", memberId: "" },
    source: "",
    counts: { posts: 0, pages: 0 },
    cursor: { start: 0, token: "" },
    notes: [],
    error: "",
  };
}

async function graphqlTemplate(job: PostsJob): Promise<string> {
  const stored = (await chrome.storage.local.get("postsQuery")).postsQuery as string | undefined;
  if (stored) return stored;
  const tabId = await openTab(`https://www.linkedin.com/in/${encodeURIComponent(job.owner.slug)}/recent-activity/all/`, "posts");
  await sleep(4000);
  const url = findPostsGraphqlUrl(await resourceUrls(tabId));
  if (url) await chrome.storage.local.set({ postsQuery: url });
  return url;
}

async function fetchPage(job: PostsJob, tabId: number): Promise<PostsPage> {
  const fetchUrl = (url: string): Promise<unknown> => pageRequest(tabId, url, { stop: () => cancelRequested });
  if (job.source !== "graphql") {
    try {
      const page = parsePosts(await fetchUrl(restPostsUrl(job.owner.memberId, job.cursor.start, job.cursor.token)), job.owner.memberId);
      if (page.updates > 0 || job.source === "rest") {
        job.source = "rest";
        return page;
      }
    } catch (error) {
      if (isFatal(error) || job.source === "rest") throw error;
    }
    job.source = "graphql";
    job.cursor = { start: 0, token: "" };
  }
  const template = await graphqlTemplate(job);
  if (!template) throw new Error("LinkedIn did not load your activity page, so posts could not be read. Open your profile's Activity page once in this browser, then try again.");
  try {
    return parsePosts(await fetchUrl(graphqlPostsUrl(template, job.cursor.start, job.cursor.token)), job.owner.memberId);
  } catch (error) {
    await chrome.storage.local.remove("postsQuery");
    throw error;
  }
}

async function collect(job: PostsJob, tabId: number): Promise<void> {
  const sinceMs = job.since ? Date.parse(job.since) : 0;
  let empty = 0;
  while (job.counts.pages < MAX_PAGES) {
    const page = await fetchPage(job, tabId);
    job.counts.pages += 1;
    if (page.posts.length > 0) await putPosts(page.posts);
    job.counts.posts = await count("posts");
    empty = page.updates === 0 ? empty + 1 : 0;
    job.cursor = { start: job.cursor.start + POSTS_PAGE, token: page.token };
    await save(job);
    if (empty >= EMPTY_PAGES_TO_STOP || (page.updates === 0 && !page.token)) return;
    const oldest = page.posts[page.posts.length - 1]?.at;
    if (sinceMs && oldest && Date.parse(oldest) < sinceMs) return;
    await politeDelay();
  }
  note(job, `Stopped after ${MAX_PAGES} pages (about ${MAX_PAGES * POSTS_PAGE} posts).`);
}

export async function runPostsJob(): Promise<void> {
  if (running) return;
  const job = await loadPostsJob();
  if (!job || job.state !== "running") return;
  running = true;
  cancelRequested = false;
  try {
    const tabId = await linkedinTab(FEED_URL, "posts");
    if (!job.owner.memberId) {
      job.owner = parseMe(await pageRequest(tabId, `${VOYAGER}/me`, { stop: () => cancelRequested }));
      if (!job.owner.memberId) throw new Error("Could not read your LinkedIn member id. Open linkedin.com once, then try again.");
      await save(job);
    }
    await collect(job, tabId);
    if (job.counts.posts === 0) note(job, "No posts were found on your profile activity.");
    job.state = "done";
    job.finishedAt = now();
  } catch (error) {
    job.state = error instanceof StopError ? "cancelled" : "error";
    job.error = error instanceof StopError ? "" : error instanceof Error ? error.message : String(error);
  } finally {
    running = false;
    await save(job);
    if (job.state !== "running") {
      await closeTabs("posts");
      await chrome.alarms.clear(POSTS_ALARM);
    }
  }
}

function resumable(previous: PostsJob | null, since: string): previous is PostsJob {
  if (!previous || previous.state === "done" || previous.since !== since) return false;
  return previous.state === "running" || Date.now() - Date.parse(previous.updatedAt) < RESUME_WINDOW_MS;
}

export async function startPosts(since: string): Promise<PostsJob> {
  const clean = /^\d{4}-\d{2}-\d{2}/.test(since) ? since.slice(0, 40) : "";
  const previous = await loadPostsJob();
  let job: PostsJob;
  if (resumable(previous, clean)) job = { ...previous, state: "running", error: "" };
  else {
    if (running) throw new Error("Posts are already being read");
    await clearPosts();
    job = newJob(clean);
  }
  await save(job);
  await chrome.alarms.create(POSTS_ALARM, { periodInMinutes: 0.5 });
  void runPostsJob();
  return job;
}

export async function cancelPosts(): Promise<PostsJob | null> {
  cancelRequested = true;
  const job = await loadPostsJob();
  if (job && job.state === "running" && !running) {
    job.state = "cancelled";
    await save(job);
    await chrome.alarms.clear(POSTS_ALARM);
  }
  return job;
}
