// src/content/history-research.ts
//
// A history book must stand on real sources, not on what a model remembers.
// Each book starts with live web research: one search-backed pass per topic,
// written up as a dossier of plain facts that every later prompt writes from.
// A pass that came back without sources is thrown away, and a subject without
// enough sources stops here instead of becoming a book.
import axios from 'axios';

export interface ResearchSource {
  title: string;
  url: string;
  domain: string;
}

export interface TopicResearch {
  dossier: string;
  sources: ResearchSource[];
  // Text of the pages that could be read, for the originality check
  pages: string[];
}

export const MIN_SOURCES = 6;
export const MIN_SOURCE_DOMAINS = 3;

// Prefix of errors that tell the book's owner why it stopped; other job errors
// can hold provider details and are never shown
export const BOOK_STOPPED_PREFIX = '[book stopped] ';

export function bookStoppedError(reason: string): Error {
  return new Error(`${BOOK_STOPPED_PREFIX}${reason}`);
}

// Where people repeat and speculate: useful as leads, never as evidence.
// Essay mills and quote collections are where misattributed "history" spreads.
const UNUSABLE_DOMAINS = [
  'reddit.com',
  'quora.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'youtube.com',
  'fandom.com',
  'brainyquote.com',
  'goodreads.com',
  'azquotes.com',
  'quotefancy.com',
  'ipl.org',
  'studymode.com',
  'bartleby.com',
  'gradesaver.com',
  'coursehero.com',
  'chegg.com',
  'scribd.com',
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isUsableSource(url: string): boolean {
  const domain = domainOf(url);
  return (
    !!domain &&
    !UNUSABLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

export interface ResearchPass {
  id: string;
  heading: string;
  ask: string;
  // The book can't go ahead if this pass finds nothing
  required?: boolean;
}

export const RESEARCH_PASSES: ResearchPass[] = [
  {
    id: 'overview',
    heading: 'THE SUBJECT',
    required: true,
    ask: 'Identify the subject: what it is, when and where it took place, and its correct names (including names in other languages or used by different sides). Give the main dates and the period it covers. If more than one subject could match, say which one matches and how to tell them apart.',
  },
  {
    id: 'background',
    heading: 'BACKGROUND AND CAUSES',
    ask: 'The world before: the political, economic, social, religious and geographic setting, and the causes historians give for what happened, with dates. Where historians disagree about causes, say who argues what in general terms.',
  },
  {
    id: 'chronology',
    heading: 'CHRONOLOGY',
    ask: 'The order of events, with dates as exact as the sources allow. Mark approximate or disputed dates (for example "c." or "accounts differ"), and note calendar differences (for example Julian and Gregorian) where they matter.',
  },
  {
    id: 'people',
    heading: 'PEOPLE AND GROUPS',
    ask: 'The main people and groups involved, with their roles, life dates where known, and what the sources say about them. Include ordinary people and groups who were affected, not only leaders. Note which details come from hostile or partisan sources, and any people who are still living.',
  },
  {
    id: 'sources',
    heading: 'PRIMARY SOURCES AND EVIDENCE',
    ask: 'What the evidence is: the main primary sources (chronicles, letters, records, inscriptions, archaeology, oral history), who produced them, when, and their known biases or gaps. Name only sources you actually found described. Note figures (army sizes, death tolls, populations) as ranges, with who estimated them.',
  },
  {
    id: 'disputed',
    heading: 'DEBATES, MYTHS AND CORRECTIONS',
    ask: 'What historians debate about this subject, popular myths and misconceptions, quotations that are misattributed or apocryphal, and claims that were later corrected, with what the evidence shows instead.',
  },
  {
    id: 'legacy',
    heading: 'CONSEQUENCES, MEMORY AND RECENT SCHOLARSHIP',
    ask: 'What followed: short- and long-term consequences, how the subject has been remembered and commemorated, and any recent discoveries, excavations or changes in historical understanding, with dates.',
  },
];

export function buildResearchPrompt(
  pass: ResearchPass,
  subject: string,
  today: string,
  notes?: string,
): string {
  return `Today is ${today}. You are researching a historical subject for a careful nonfiction history book. Search the web before you answer, and search more than once.

SUBJECT: ${subject}
${notes?.trim() ? `AUTHOR'S NOTES, to help identify the subject. They are not evidence: check them:\n${notes.trim().slice(0, 1000)}\n` : ''}
TOPIC: ${pass.ask}

SOURCES:
- Prefer academic and university sources, museums, national archives and libraries, heritage bodies, scholarly encyclopedias, and established news organizations reporting on new research.
- Do not treat forums, social media, fan wikis, quote collections, essay sites, or entertainment retellings (films, TV dramas, novels, games) as evidence.
- For anything disputed, say who claims what. Mark anything found in only one source as "single source". Mark quotations whose origin is doubtful as "apocryphal".

HOW TO WRITE IT:
- Write short, plain factual notes, one fact per line, with the date where you have one. This is a list of facts, not prose.
- Use your own words. Do not copy sentences, and do not include quotations longer than a few words.
- Report only what you found. Never fill a gap from memory or guesswork. If you found nothing on part of the topic, say "Not found".
- Keep the difference between evidence and interpretation clear: "the chronicle says" is not the same as "historians think".
- No graphic detail of violence or torture, no home addresses or contact details of living people.
- At most 700 words.

If you cannot find this subject at all, reply with only: SUBJECT_NOT_FOUND`;
}

export function subjectNotFound(text: string): boolean {
  return /^\W*SUBJECT_NOT_FOUND\W*$/.test(text.trim());
}

// Web search citations can point anywhere, so a request may never reach this
// machine's own network
export function isSafeToFetch(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return (
      protocol === 'https:' &&
      host.includes('.') &&
      !host.endsWith('.local') &&
      !host.endsWith('.internal') &&
      !/^[\d.]+$/.test(host) &&
      !host.includes(':') &&
      !host.startsWith('[')
    );
  } catch {
    return false;
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:#39|#x27|apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:quot|ldquo|rdquo);/g, '"')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_CHARS = 150000;

/**
 * Follows a citation to the real page. Search citations are often temporary
 * redirect links, so this is also what gives the book a lasting URL. Many news
 * sites refuse bots: that still proves the page exists, it just has no text.
 */
export async function readSourcePage(
  url: string,
): Promise<{ url: string; text: string } | null> {
  if (!isSafeToFetch(url)) return null;
  try {
    const response = await axios.get<string>(url, {
      timeout: 15000,
      maxContentLength: MAX_PAGE_BYTES,
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BookResearch/1.0)' },
      beforeRedirect: (options: Record<string, any>) => {
        if (!isSafeToFetch(options.href)) {
          throw new Error('Unsafe redirect');
        }
      },
    });
    const finalUrl: string =
      (response.request as any)?.res?.responseUrl || url;
    if (response.status === 404 || response.status === 410) return null;

    const isHtml = /html|text\/plain/i.test(
      String(response.headers['content-type'] || ''),
    );
    const readable = response.status < 400 && isHtml;
    return {
      url: finalUrl,
      text: readable
        ? htmlToText(String(response.data)).slice(0, MAX_PAGE_CHARS)
        : '',
    };
  } catch {
    return null;
  }
}

/** Keeps every source one entry, under the address readers will land on */
export function uniqueSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The book formatter strips markdown characters, which would break these URLs;
// percent-encoded they still lead to the same page
function printableUrl(url: string): string {
  const withoutFragment = url.replace(/#.*$/, '');
  const short =
    withoutFragment.length > 200
      ? withoutFragment.replace(/\?.*$/, '')
      : withoutFragment;
  return short.replace(
    /[_*~`[\]{}]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The list printed at the end of the book */
export function formatSourcesSection(
  sources: ResearchSource[],
  accessedOn: string,
): string {
  const entries = sources.map((source) => {
    const title = source.title.replace(/[_*~`[\]{}#]/g, ' ').trim();
    const label = title && title !== source.domain ? `${title} (${source.domain})` : source.domain;
    return `${label}: ${printableUrl(source.url)}`;
  });
  return [
    'Sources',
    `The research for this book drew on these public sources, accessed in ${accessedOn}. Pages can change or move after that date.`,
    ...entries,
  ].join('\n\n');
}
