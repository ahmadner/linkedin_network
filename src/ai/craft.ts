export const LANGUAGE_RULE = [
  "Arabic text must be natural, clear Arabic the way Jordanian and Palestinian professionals write on LinkedIn: light Levantine flavor, confident and warm, never stiff MSA and never a literal translation of English.",
  "Keep technical terms (framework names, tools, concepts like queue, cache, API) in English inside Arabic text, the way developers really write.",
  "English text must be natural, plain, professional English with short sentences.",
].join(" ");

export const FACTS_RULE = [
  "Personal facts about the user (employers, clients, projects, numbers, results, awards, stories) must come only from the input. Never invent them.",
  "General professional and technical knowledge is not invented: explain real concepts, real trade-offs, real tools, real mistakes people make and real step-by-step methods in depth, with correct specifics.",
  "Build concrete scenes and examples from the user's real projects, skills and role in the input before anything else.",
  "Only when a personal number or detail is truly needed and not given, use one short placeholder in square brackets such as [رقم] or [number]. Use at most two placeholders in a post, never a placeholder for something you can say honestly without it.",
].join(" ");

export const BANNED_PHRASES = [
  "في عالم اليوم", "في ظل التطور", "لا يخفى على أحد", "يسعدني أن أعلن", "رحلة ملهمة", "غيّر قواعد اللعبة", "شاركوني آراءكم", "ما رأيكم؟",
  "In today's fast-paced world", "I'm thrilled to announce", "I'm excited to share", "game-changer", "Let's dive in", "unlock your potential", "In conclusion", "What do you think?", "Agree?",
];

export const POST_PLAYBOOK = [
  "LinkedIn post craft playbook. Follow every rule.",
  "HOOK: line 1 is at most 12 words and makes a specific promise, tension or surprise tied to this exact topic. Line 2 deepens the curiosity gap. Together they fit in about 200 characters, because LinkedIn folds the post there. No greeting, no throat-clearing, no hashtags, no question that can be answered with yes or no.",
  "SPECIFICITY: every paragraph carries at least one concrete element: a named tool or technique, a real situation, a decision and its reason, a mistake and its fix, a before and after, a short example, or a number from the input. Show, do not tell. Replace every vague word (many, things, better, important) with the specific thing.",
  "DEPTH: teach something the reader can use today. Name the steps, the trade-off, the why behind it and the common trap. A senior reader in the field must learn something; a junior reader must still follow it.",
  "STRUCTURE: pick one proven framework that fits the angle (story to lesson, problem to agitation to solution, mistake to fix, contrarian claim with proof, numbered how-to, before and after) and make the flow obvious.",
  "FORMATTING: short paragraphs of 1 to 3 lines with a blank line between them. Use a numbered or arrow list only for real steps or items, each item a full useful line. No markdown symbols such as ** or #. Emojis are optional, at most three, only as list markers or for one emphasis.",
  "VOICE: first person, the user's real voice, confident and humble, like a smart colleague talking, not a press release. Vary sentence length. Write for one specific reader from the target audience.",
  "ENDING: a one-line takeaway, then a specific call to action: a focused question that is easy to answer from experience, or a clear next step. The question must be about this topic, never generic.",
  `NEVER use these or similar clichés: ${BANNED_PHRASES.join(" | ")}. Never use engagement bait, never ask for likes, never overuse exclamation marks.`,
  "Hashtags go only in the hashtags field (3 to 5: one or two broad, the rest niche), never in the text.",
].join("\n");

export const FORMAT_RULES = [
  "text = a strong standalone post.",
  "image = a full post that also works next to one image; the image supports the post, so the text must still stand on its own.",
  "carousel = a post that sells the document and makes people swipe, plus 6 to 9 slides: slide 1 a strong cover promise, middle slides one idea each with a short title and at most 30 words of concrete body, last slide a recap and call to action.",
  "poll = a short post with context and why the answer matters, plus a poll question and 2 to 4 options of at most 30 characters each.",
  "video = a post that introduces the video with what the viewer will learn.",
  "article = a longer, structured post with a clear title and sections.",
].join(" ");

export const EDITOR_RUBRIC = [
  "Score the draft from 0 to 10 on each: hook (line 1 stops the scroll and is specific), specificity (concrete details in every paragraph, no vague filler), depth (the reader learns something real), structure (clear flow, easy to scan on a phone), voice (sounds like a real person in the user's role, natural language, no clichés), ending (clear takeaway and a specific call to action).",
  "List the concrete problems, then fix every one of them in a rewritten post. Keep all true facts, the language, the format and the angle. Do not add personal facts that are not in the input.",
].join(" ");

export const VISUAL_RULES = [
  "The image must be about this exact post. A viewer who reads only the first two lines of the post must instantly see the link between the post and the image.",
  "Build the image from the post's real, concrete elements: the actual objects, devices, places, systems, people's roles, actions and outcomes the post talks about. Prefer showing the real situation over an abstract symbol.",
  "Use a visual metaphor only when it is built from objects that belong to the topic and is understood in one second.",
  "Never use generic clichés that could fit any post: handshakes, light bulbs, puzzle pieces, rockets, chess pieces, mountain summits, random laptops, stock-photo smiles, glowing brains, floating abstract lines.",
  "Never include real or famous people, company logos, trademarks, watermarks or screenshots of real products. People, if any, are anonymous, natural and diverse, and fit the region and the role in the post.",
].join(" ");
