// src/content/gemini.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { BookOutlineDto, ChapterOutline } from './dto/generate-history.dto';
import {
  bookStoppedError,
  buildResearchPrompt,
  domainOf,
  isUsableSource,
  MIN_SOURCE_DOMAINS,
  MIN_SOURCES,
  readSourcePage,
  RESEARCH_PASSES,
  ResearchSource,
  subjectNotFound,
  TopicResearch,
  uniqueSources,
} from './history-research';
import {
  buildStyleProfile,
  formatForChapter,
  StyleProfile,
} from './history-style';

interface APIProvider {
  type: 'gemini' | 'openai';
  client: GoogleGenerativeAI | OpenAI;
  model: string;

  lastUsedAt: number; // timestamp of last API call
  rateLimitedUntil: number; // when rate limit expires (0 = not limited)

  // ── NEW: Track consecutive errors per provider ──
  consecutiveErrors: number;
  lastErrorAt: number;
  lastErrorType: string | null;
}

interface GenerationOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'application/json' | 'text/plain';
  // Search the live web, and report what was cited
  webSearch?: boolean;
  onSources?: (sources: ResearchSource[]) => void;
}

// ═══════════════════════════════════════════════════════════════
// BOOK BRIEF — the historical subject the book covers, plus optional facts
// the author supplies. The research dossier wins over author notes and
// over model memory.
// ═══════════════════════════════════════════════════════════════
export interface BookBrief {
  // The event, era, place, people or movement the book covers
  subject: string;
  notes?: string;
  // Unique per book (the project id): picks this book's writing style, so
  // books with the same title still read differently
  seed?: string;
  // The facts every prompt writes from (see history-research.ts)
  dossier?: string;
  // Chapter titles of other books on this subject, which this one must not reuse
  avoidTitles?: string[];
}

// Keeps very long notes from crowding out the actual instructions
const MAX_AUTHOR_NOTES_CHARS = 4000;

const PLAIN_LANGUAGE_RULES = `PLAIN LANGUAGE REQUIREMENT:
- Write every generated section in plain English.
- Use common words and short, clear sentences.
- Tell the story the way a good storyteller would tell it out loud.
- Avoid jargon, academic wording, fancy phrasing, and long tangled sentences.
- If a historical term, title, office or institution needs explaining, explain it right away in simple words.`;

// ═══════════════════════════════════════════════════════════════
// FACTUAL ACCURACY — popular history is full of invented quotes, inflated
// numbers and myths repeated as fact. Every prompt carries these rules.
// ═══════════════════════════════════════════════════════════════
const HISTORY_FACT_RULES = `FACTUAL ACCURACY — THIS BOOK IS NONFICTION ABOUT REAL HISTORY:
- The RESEARCH DOSSIER in this prompt is your source for specific facts about this subject: names, dates, numbers, events, places, sources and quotations. It comes from live web research. Do not add specific facts from memory, however sure you feel: memory of history is often a blend of myth, film and half-remembered books.
- Broad, uncontroversial background (how a guild worked, what a sailing ship needed, how a harvest year ran) may come from general knowledge, presented as general context and not as facts about the specific people or events in this book.
- The dossier is notes, not prose. Never copy its sentences into the book: choose what matters and tell it in fresh words.
- Keep evidence and interpretation apart. "A chronicle records", "the tax rolls show", "historians generally agree" and "some historians argue" are different claims; use the one the dossier supports.
- Anything the dossier marks as "single source" must be attributed in the text ("one chronicler wrote"), or left out. Follow its DEBATES, MYTHS AND CORRECTIONS section, and never repeat a myth or disproven claim except to correct it.
- Numbers from the past — army sizes, death tolls, populations, sums of money — are often uncertain. Give them as the dossier gives them, as ranges where it does, with who estimated them. Never invent or sharpen a figure.
- Dates: use exact dates only when the dossier gives them. Mark approximate dates with "about" or "c.", and keep one era style (BCE/CE or BC/AD) throughout.
- Never invent anything: no dialogue, scenes, people, speeches, letters, documents, archive references, dates, numbers or sources.
- Quotations: only use a quotation if it is in the dossier and not marked apocryphal; keep it to a short phrase and attribute it. If the dossier says a famous line is doubtful, say it is "later attributed to" the person, or leave it out.
- Never narrate what anyone thought or felt unless their own letter, diary, memoir or recorded words say so; then attribute it ("he wrote that he feared..."). Nobody can report the inner life of people who left no record.
- Do not recreate events hour by hour unless the sources really do establish them. Where the sequence is unknown, say so.
- When sources disagree or are silent, say so plainly ("accounts differ", "the record is silent") or leave the point out. Never fill a gap with something plausible.
- Do not present "what if" speculation as history. A brief counterfactual is allowed only when clearly labeled as one and grounded in what historians have discussed.
- For recent discoveries and debates, use the dossier's latest developments and write "as of this writing".
- If AUTHOR NOTES are provided, use them for direction and for extra facts. Where they conflict with the dossier, follow the dossier.
- Where the dossier says "Not found" or is thin, say plainly that less is known, and widen the lens to general context. Never fill the gap.`;

// ═══════════════════════════════════════════════════════════════
// FAIRNESS — history is about real peoples, faiths and nations, some of
// whose descendants will read the book; recent history also involves
// living people. Accuracy and respect are both the standard.
// ═══════════════════════════════════════════════════════════════
const HISTORY_FAIRNESS_RULES = `FAIRNESS, PERSPECTIVE AND RESPECT — NON-NEGOTIABLE:
- Give every side its own reasons, in its own terms, as the sources record them. No pure heroes or villains: judge actions by the evidence, not by which side won.
- Explain the beliefs and assumptions of the time so readers understand them, but do not excuse or soften atrocities, slavery, conquest, persecution or other mass harm. Name them plainly, as historians do.
- Never deny, minimize, or cast doubt on well-documented atrocities, genocides or mass crimes. Follow the established scholarly consensus. Do not present pseudohistory, conspiracy theories or fringe claims as credible; mention one only if it is a well-known myth the dossier corrects, and say plainly that it is false.
- Call peoples, nations and faiths by the names they use for themselves. If an older term is needed to understand a source, explain it once in context. Never repeat slurs. Never describe any people as "savage", "primitive", "barbaric" or "uncivilized".
- Do not stereotype any people, faith, nation, class or gender, past or present, and do not draw lessons about modern groups from the past.
- Do not reproduce propaganda, extremist slogans, manifestos or hate speech beyond the briefest paraphrase the story needs, and never in a way that admires it.
- Do not glorify war, conquest or violent leaders. Describe military skill or political cunning factually, alongside its human cost.
- Do not diagnose historical figures with illnesses or psychological conditions. If historians debate a diagnosis, attribute it as their debate.
- Living people and the recent past: only say that a living or recently living person committed a crime or wrongdoing if a court or official inquiry found it; otherwise attribute it as an allegation. Keep private people private and never include home addresses or contact details.
- Violence: state what happened plainly and once. No gore, no torture or execution detail beyond what the story strictly needs, no lingering on suffering, and never use death for suspense.
- Sexual violence: name it in general terms only. Never describe the acts. Never include any sexual detail about a person under 18.
- No instructions: never give details that would help someone build a weapon, make a poison or explosive, or cause harm. Describe historical weapons and methods in general terms only.
- Mention race, religion, nationality, sexuality or disability only where it is relevant and documented.`;

// ═══════════════════════════════════════════════════════════════
// COPYRIGHT — historical facts are free to use; historians' words,
// interpretations, translations and storytelling choices are not
// ═══════════════════════════════════════════════════════════════
const HISTORY_COPYRIGHT_RULES = `COPYRIGHT AND PLAGIARISM — NON-NEGOTIABLE:
- Facts belong to no one: dates, places, names, events and what the evidence shows are free to use. The way anyone else told those facts is not.
- Other works about this subject are off limits as a source of expression. That covers history books (popular and academic), textbooks, articles, encyclopedias including Wikipedia, museum and exhibition texts, websites, documentaries, podcasts, films, TV dramas and novels. Never reproduce, closely paraphrase, or summarize them passage by passage.
- A historian's original argument, distinctive interpretation, coined phrase, and selection and arrangement of material are their creative work. You may report that historians hold a view, briefly and in your own words, as theirs ("some historians argue that..."). Never present another writer's distinctive thesis as this book's own conclusion, and never build the book around one.
- Name a specific historian or book only if the dossier names them and you are certain of the attribution.
- Do not copy another work's storytelling choices: its chapter titles, order of chapters, opening scene, framing device, recurring image or memorable phrases. Build this book's selection and order from the evidence and this book's own plan.
- Scenes and dialogue in historical films, TV dramas, novels and games are fiction owned by their makers. Never use them, even reworded, and never mistake them for history.
- Primary sources: an old text may be in the public domain, but modern translations, editions and transcriptions usually are not. Quote at most one short, well-known phrase at a time, only when the dossier provides it; paraphrase everything else in your own sentence structure. Never reproduce a translated passage, a full speech, a letter or an inscription.
- Never quote from any modern book, article, documentary, show, podcast, museum text or historian.
- Never quote song lyrics, poems, hymns or anthems, not even a single line. Titles are fine.
- Do not write in the style of any named author, documentary or show, and do not use their signature phrases.
- Use the standard names for events, eras and people. Do not use a label coined by one specific book, show or podcast as your own framing.
- You may mention that a famous book, film or show about the subject exists only if that fact matters to how the subject is remembered, as something that happened in public. Do not describe its contents in detail.`;

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT — narrative history writer, styled per book
// ═══════════════════════════════════════════════════════════════
function buildHistorySystemPrompt(style: StyleProfile): string {
  const { persona } = style;
  return `You are ${persona.name}, ${persona.background}. You write narrative history for general readers: carefully grounded in the evidence, honest about what is and isn't known, fair to the people of the past, and told so that history reads like a story rather than a textbook. ${persona.focus}. As a writer, you ${persona.writingHabit}. This habit should show up naturally across the chapter, not just once.

Your personality as a writer: by temperament you are ${persona.temperament}. You admire ${persona.admires}. You distrust ${persona.distrusts}. You can't help noticing ${persona.notices}, but you bring in such details only when the sources support them. Let this personality show in what you emphasize and how you weigh things — never in invented facts, and never as opinions dressed up as facts.

This persona only sets your voice. It is not a fact about the book. Never mention this name or background in the text. Never claim to have visited an archive, handled an object, traveled to a site, interviewed anyone, or made a discovery yourself.

Tone for this book: ${style.tone}

Your writing voice:
- Third person. Keep yourself out of the story.
- Humane but clear-eyed: sympathy for the people who lived through events, fairness to every side, no contempt and no glorification
- Concrete: names, places, dates, documents, objects, prices, distances, decisions and their consequences — not adjectives
- Short sentences mixed with longer ones — never uniform
- Tension comes from the order of events and what people did not know at the time, never from exaggeration or fake cliffhangers
- Show how we know things: the chronicle, the letter, the record, the excavation, the later scholarship
- Connect big events to ordinary lives: what they did to a family, a town, a trade or a way of life
- Let the evidence speak; never moralize, and never pretend the past was simpler than it was

${HISTORY_FACT_RULES}

${HISTORY_FAIRNESS_RULES}

${HISTORY_COPYRIGHT_RULES}

ORIGINALITY — THIS IS NON-NEGOTIABLE:
Every sentence you write must be entirely original wording in your own voice, generated fresh for this book. Never reproduce, closely paraphrase, structurally mirror, or echo the phrasing of any published or online source, in any language.
- Do not recall a telling of this history and restate it. Start from the bare facts and find your own words, sentence shapes and order of ideas.
- Do not open the book or any chapter the way popular history usually opens: not on "Throughout history...", not on "Since the dawn of time...", not on a birth date, not on a dramatic battle scene invented for effect. Find a better way in.
- Do not organize every chapter the same way. Let each chapter's shape come from the part of the story it covers.
- Treat every section as if you are drafting it for the first time, not recalling a version of it you've read before.

ABSOLUTELY NEVER use these words/phrases — they are dead giveaways of AI writing or lazy popular history:
"delve", "tapestry", "vibrant", "myriad", "plethora", "embark on a journey", "a testament to", "it's worth noting",
"in terms of", "when it comes to", "at the end of the day", "seamlessly", "effortlessly", "game-changer",
"indelible mark", "iconic", "legendary", "unparalleled", "pivotal moment", "against all odds",
"the rest is history", "little did (he/she/they) know", "navigate the complexities", "multifaceted", "enigmatic", "resonate",
"throughout history", "since the dawn of time", "in the annals of history", "changed the course of history", "forever changed",
"the world would never be the same", "shaped the world we live in today", "stood the test of time", "a bygone era", "days of yore",
"steeped in history", "rich history", "storied", "bustling", "nestled", "epic", "glorious", "savage", "barbaric", "primitive"

Instead use plain, specific language. Show why something mattered with facts instead of announcing that it was important.

${PLAIN_LANGUAGE_RULES}`;
}
// ═══════════════════════════════════════════════════════════════
// Post-processing patterns — shared + domain-specific
// ═══════════════════════════════════════════════════════════════

const SHARED_AI_TELL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> =
  [
    { pattern: /\bdelve(?:s|d)?\b/gi, replacement: 'dig' },
    { pattern: /\btapestry\b/gi, replacement: 'mix' },
    { pattern: /\bmyriad\b/gi, replacement: 'many' },
    { pattern: /\bplethora\b/gi, replacement: 'plenty' },
    { pattern: /\bseamlessly\b/gi, replacement: 'smoothly' },
    { pattern: /\beffortlessly\b/gi, replacement: 'easily' },
    { pattern: /\bembark on a journey\b/gi, replacement: 'get started' },
    { pattern: /\ba testament to\b/gi, replacement: 'proof of' },
    { pattern: /\bit(?:'s| is) worth noting\b/gi, replacement: '' },
    { pattern: /\baforementioned\b/gi, replacement: 'that' },
    { pattern: /\bfurthermore\b/gi, replacement: 'also' },
    { pattern: /\bmoreover\b/gi, replacement: 'and' },
    { pattern: /\bin conclusion\b/gi, replacement: '' },
    { pattern: /\bIn summary\b/gi, replacement: '' },
    { pattern: /\bgame-changer\b/gi, replacement: 'big deal' },
    { pattern: /\butilize(?:s|d)?\b/gi, replacement: 'use' },
    { pattern: /\bleverag(?:e|es|ed|ing)\b/gi, replacement: 'use' },
    { pattern: /\bfacilitat(?:e|es|ed|ing)\b/gi, replacement: 'help' },
    { pattern: /\bnevertheless\b/gi, replacement: 'still' },
    { pattern: /\bnonetheless\b/gi, replacement: 'still' },
    { pattern: /\bin addition(?:ally)?\b/gi, replacement: 'also' },
    { pattern: /\bsubsequently\b/gi, replacement: 'then' },
    { pattern: /\bconsequently\b/gi, replacement: 'so' },
    { pattern: /\bultimately\b/gi, replacement: 'in the end' },
    { pattern: /\bsignificantly\b/gi, replacement: 'a lot' },
    { pattern: /\bsubstantially\b/gi, replacement: 'a lot' },
    { pattern: /\bnotably\b/gi, replacement: '' },
    { pattern: /\bindeed\b/gi, replacement: '' },
    { pattern: /\bcertainly\b/gi, replacement: '' },
    { pattern: /\bof course\b/gi, replacement: '' },
    { pattern: /\brich history\b/gi, replacement: 'long history' },
    { pattern: /\bdiverse culture\b/gi, replacement: 'mixed culture' },
    { pattern: /\blocal flavor\b/gi, replacement: 'local character' },
    { pattern: /\bmust-visit\b/gi, replacement: 'worth visiting' },
    { pattern: /\bmust-see\b/gi, replacement: 'worth seeing' },
    { pattern: /\boff the beaten path\b/gi, replacement: 'out of the way' },
    { pattern: /\boff-the-beaten-path\b/gi, replacement: 'out of the way' },
    { pattern: /\bunique experience\b/gi, replacement: 'experience' },
    { pattern: /\bmemorable experience\b/gi, replacement: 'good experience' },
    { pattern: /\bit is important to note\b/gi, replacement: '' },
    { pattern: /\bplease note that\b/gi, replacement: '' },
    { pattern: /\bkeep in mind that\b/gi, replacement: '' },
  ];

const HISTORY_AI_TELL_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  // Article-aware forms first, so "a pivotal" doesn't become "a important"
  { pattern: /\ba pivotal\b/g, replacement: 'an important' },
  { pattern: /\bA pivotal\b/g, replacement: 'An important' },
  { pattern: /\ban (?:iconic|legendary)\b/g, replacement: 'a famous' },
  { pattern: /\bAn (?:iconic|legendary)\b/g, replacement: 'A famous' },
  { pattern: /\ban unparalleled\b/g, replacement: 'a rare' },
  { pattern: /\bAn unparalleled\b/g, replacement: 'A rare' },
  { pattern: /\ban epic\b/g, replacement: 'a long' },
  { pattern: /\bAn epic\b/g, replacement: 'A long' },
  { pattern: /\bleft an indelible mark\b/gi, replacement: 'left a lasting mark' },
  { pattern: /\ban indelible\b/g, replacement: 'a lasting' },
  { pattern: /\bindelible\b/gi, replacement: 'lasting' },
  { pattern: /\biconic\b/gi, replacement: 'famous' },
  { pattern: /\blegendary\b/gi, replacement: 'famous' },
  { pattern: /\bpivotal\b/gi, replacement: 'important' },
  { pattern: /\bagainst all odds\b/gi, replacement: 'against long odds' },
  { pattern: /\bmultifaceted\b/gi, replacement: 'complicated' },
  { pattern: /\bunparalleled\b/gi, replacement: 'rare' },
  { pattern: /\bvibrant\b/gi, replacement: 'lively' },
  { pattern: /\bnavigat(?:e|ed|ing) the complexities of\b/gi, replacement: 'dealing with' },
  // Stock popular-history wording; anything that needs real rewriting is
  // left to the authenticity audit
  { pattern: /\bsteeped in history\b/gi, replacement: 'old' },
  { pattern: /\ba bygone era\b/gi, replacement: 'an earlier age' },
  { pattern: /\bbygone\b/gi, replacement: 'earlier' },
  { pattern: /\bdays of yore\b/gi, replacement: 'earlier times' },
  { pattern: /\bbustling\b/gi, replacement: 'busy' },
  { pattern: /\bnestled\b/gi, replacement: 'set' },
  { pattern: /\bstoried\b/gi, replacement: 'long' },
];

const SENTENCE_UNIFORMITY_PATTERNS = [
  /(?:^|\. )The (?:\w+ ){2,}/g,
  /(?:^|\. )You (?:can|will|should|might) /g,
];

interface RefinementContext {
  bookTitle?: string;
  bookSubtitle?: string;
  chapterTitle?: string;
  chapterOutline?: ChapterOutline;
  isMainChapter?: boolean;
  brief?: BookBrief;
}

interface AuthenticityIssue {
  issue: string;
  instruction: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private apiProviders: APIProvider[] = [];
  private currentProviderIndex: number = 0;
  private openaiResearchModel = 'gpt-4.1-mini';
  private readonly MAX_RETRIES = 5;
  private readonly INITIAL_RETRY_DELAY = 6000;

  // ── Per-provider cooldown settings ──────────────────────────
  private readonly PROVIDER_COOLDOWN_MS = 5000; // Min 5s between calls to same key
  private readonly RATE_LIMIT_LOCKOUT_MS = 60000; // Lock out for 60s after 429

  private readonly REQUEST_TIMEOUT_MS = 95000; // 95s timeout per request
  private readonly PROVIDER_SWITCH_DELAY_MS = 4000; // 4s delay when switching after failure
  private readonly MAX_CONSECUTIVE_ERRORS = 5; // Max errors before extended lockout
  private readonly EXTENDED_LOCKOUT_MS = 300000; // 5 min lockout after too many errors

  constructor(private configService: ConfigService) {
    this.initializeProviders();

    if (this.apiProviders.length === 0) {
      throw new Error(
        'At least one API key (GEMINI or OPENAI) must be configured',
      );
    }

    this.logger.log(
      `Service initialized with ${this.apiProviders.length} API provider(s)`,
    );
    this.apiProviders.forEach((provider, idx) => {
      this.logger.log(
        `Provider ${idx + 1}: ${provider.type} (${provider.model})`,
      );
    });
  }

  private initializeProviders(): void {
    const geminiPrimary = this.configService.get<string>('GEMINI_API_KEY');
    const geminiSecondary = this.configService.get<string>('GEMINI_API_KEYS');

    const geminiKeys: string[] = [];
    if (geminiPrimary) geminiKeys.push(geminiPrimary);
    if (geminiSecondary) {
      const keys = geminiSecondary
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k);
      geminiKeys.push(...keys);
    }

    // Override with GEMINI_MODEL / OPENAI_MODEL when a model is retired
    const geminiModel =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
    const openaiModel =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4.1-nano';

    const uniqueGeminiKeys = [...new Set(geminiKeys)];
    uniqueGeminiKeys.forEach((key) => {
      this.apiProviders.push({
        type: 'gemini',
        client: new GoogleGenerativeAI(key),
        model: geminiModel,
        lastUsedAt: 0,
        rateLimitedUntil: 0,
        consecutiveErrors: 0,
        lastErrorAt: 0,
        lastErrorType: null,
      });
    });

    // Cheap writing models such as gpt-4.1-nano can't search the web
    this.openaiResearchModel =
      this.configService.get<string>('OPENAI_RESEARCH_MODEL') || 'gpt-4.1-mini';

    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (openaiKey) {
      this.apiProviders.push({
        type: 'openai',
        client: new OpenAI({ apiKey: openaiKey }),
        model: openaiModel,
        lastUsedAt: 0,
        rateLimitedUntil: 0,
        consecutiveErrors: 0,
        lastErrorAt: 0,
        lastErrorType: null,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FIXED: Improved provider selection with error tracking
  // ══════════════════════════════════════════════════════════════
  private getNextProvider(): APIProvider | null {
    const now = Date.now();

    // Filter out rate-limited and error-locked providers
    const available = this.apiProviders.filter((p) => {
      if (now < p.rateLimitedUntil) return false;
      // Skip providers with too many consecutive errors (extended lockout)
      if (p.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        const timeSinceError = now - p.lastErrorAt;
        if (timeSinceError < this.EXTENDED_LOCKOUT_MS) {
          return false;
        }
        // Reset if lockout period passed
        p.consecutiveErrors = 0;
      }
      return true;
    });
    if (available.length === 0) return null;
    // Prefer providers with fewer errors, then pick the one idle longest
    available.sort((a, b) => {
      if (a.consecutiveErrors !== b.consecutiveErrors) {
        return a.consecutiveErrors - b.consecutiveErrors;
      }
      return a.lastUsedAt - b.lastUsedAt;
    });
    return available[0];
  }
  private async waitForProviderCooldown(provider: APIProvider): Promise<void> {
    const now = Date.now();
    const timeSinceLastUse = now - provider.lastUsedAt;
    if (
      timeSinceLastUse < this.PROVIDER_COOLDOWN_MS &&
      provider.lastUsedAt > 0
    ) {
      const waitTime = this.PROVIDER_COOLDOWN_MS - timeSinceLastUse;
      this.logger.debug(
        `Provider ${provider.type} cooling down ${waitTime}ms...`,
      );
      await this.sleep(waitTime);
    }
  }

  private isAccessDeniedError(error: any): boolean {
    return (
      error?.status === 403 ||
      error?.message?.includes('403') ||
      error?.message?.includes('Forbidden') ||
      error?.message?.includes('denied access') ||
      error?.message?.includes('API key not valid') ||
      error?.message?.includes('API_KEY_INVALID') ||
      error?.message?.includes('permission') ||
      error?.message?.includes('disabled')
    );
  }

  /** 404: this provider's model was retired or isn't offered to this key */
  private isModelUnavailableError(error: any): boolean {
    return (
      error?.status === 404 ||
      error?.message?.includes('404 Not Found') ||
      error?.message?.includes('no longer available')
    );
  }
  /**
   * The model blocked or refused this text. War, atrocity and persecution
   * trip safety filters more often, and Gemini's RECITATION block means the
   * draft was repeating existing text (a copyright risk), so neither should
   * ever be kept: try the next provider.
   */
  private isContentBlockedError(error: any): boolean {
    return (
      error?.name === 'ContentBlockedError' ||
      /\b(?:blocked due to|SAFETY|RECITATION|PROHIBITED_CONTENT)\b/.test(
        error?.message || '',
      ) ||
      error?.code === 'content_policy_violation' ||
      error?.code === 'content_filter'
    );
  }

  private contentBlockedError(reason: string): Error {
    const error = new Error(`Model output blocked: ${reason}`);
    error.name = 'ContentBlockedError';
    return error;
  }

  /** A short reply that opens by declining, instead of the requested text */
  private looksLikeRefusal(text: string): boolean {
    const trimmed = text.trim();
    return (
      trimmed.length < 800 &&
      /^(?:i['’]m sorry|i am sorry|sorry,|i can(?:['’]t|not)|i won['’]t|i['’]m unable|i am unable|i['’]m not able)\b/i.test(
        trimmed,
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // NEW: Network error detection
  // ══════════════════════════════════════════════════════════════
  private getNestedErrorValues(error: any): string {
    const values: string[] = [];
    const seen = new Set<any>();
    let current = error;

    while (current && !seen.has(current)) {
      seen.add(current);
      values.push(
        current?.message,
        current?.code,
        current?.errno,
        current?.syscall,
        current?.hostname,
        current?.name,
        current?.type,
      );
      current = current?.cause;
    }

    return values.filter(Boolean).join(' ').toLowerCase();
  }

  private isNetworkError(error: any): boolean {
    const errorText = this.getNestedErrorValues(error);

    return (
      errorText.includes('connection error') ||
      errorText.includes('connectiontimeouterror') ||
      errorText.includes('fetch failed') ||
      errorText.includes('eai_again') ||
      errorText.includes('econnreset') ||
      errorText.includes('etimedout') ||
      errorText.includes('timed out') ||
      errorText.includes('timeout') ||
      errorText.includes('econnrefused') ||
      errorText.includes('socket hang up') ||
      errorText.includes('network') ||
      errorText.includes('dns') ||
      errorText.includes('getaddrinfo') ||
      errorText.includes('enotfound') ||
      errorText.includes('enetunreach') ||
      errorText.includes('ehostunreach') ||
      error?.name === 'AbortError' ||
      error?.name === 'TimeoutError' ||
      error?.name === 'APIConnectionTimeoutError'
    );
  }
  private isRateLimitError(error: any): boolean {
    return (
      error?.status === 429 ||
      error?.message?.includes('rate limit') ||
      error?.message?.includes('quota') ||
      error?.message?.includes('too many requests') ||
      error?.message?.includes('Resource has been exhausted')
    );
  }
  private isOverloadError(error: any): boolean {
    return (
      error?.status === 503 ||
      error?.status === 502 ||
      error?.status === 500 ||
      error?.message?.includes('overloaded') ||
      error?.message?.includes('unavailable') ||
      error?.message?.includes('capacity')
    );
  }
  private isRetryableError(error: any): boolean {
    return (
      this.isNetworkError(error) ||
      this.isRateLimitError(error) ||
      this.isOverloadError(error) ||
      this.isContentBlockedError(error) || // blocked text = try the next provider
      this.isAccessDeniedError(error) || // 403 = skip this key, try next
      this.isModelUnavailableError(error) // 404 = skip this model, try next
    );
  }
  // ══════════════════════════════════════════════════════════════
  // NEW: Add jitter to prevent thundering herd
  // ══════════════════════════════════════════════════════════════
  private addJitter(baseMs: number, jitterPercent: number = 0.3): number {
    const jitter = baseMs * jitterPercent * (Math.random() - 0.5) * 2;
    return Math.max(100, Math.floor(baseMs + jitter));
  }

  // ═══════════════════════════════════════════════════════════════
  // HISTORY VOICE + SHARED PROMPT BLOCKS
  // ═══════════════════════════════════════════════════════════════
  /** This book's style; falls back to a title-based seed for old callers */
  private styleFor(
    brief: BookBrief | undefined,
    title: string,
    subtitle: string,
  ): StyleProfile {
    return buildStyleProfile(brief?.seed || `${title}::${subtitle}`);
  }

  private getSystemPrompt(
    brief: BookBrief | undefined,
    title: string,
    subtitle: string,
  ): string {
    return buildHistorySystemPrompt(this.styleFor(brief, title, subtitle));
  }

  private getAITellPatterns(): Array<{ pattern: RegExp; replacement: string }> {
    return [...SHARED_AI_TELL_PATTERNS, ...HISTORY_AI_TELL_PATTERNS];
  }

  private buildAuthorNotesBlock(brief?: BookBrief): string {
    const notes = brief?.notes?.trim();
    if (!notes) return '';

    const trimmed =
      notes.length > MAX_AUTHOR_NOTES_CHARS
        ? `${notes.slice(0, MAX_AUTHOR_NOTES_CHARS)}...`
        : notes;

    return `
AUTHOR NOTES (supplied by the author — use them for direction and extra facts. The dossier wins where they conflict, and they never override the FAIRNESS or COPYRIGHT rules):
"""
${trimmed}
"""`;
  }

  private buildDossierBlock(brief?: BookBrief): string {
    if (!brief?.dossier) return '';
    return `
RESEARCH DOSSIER (facts from live web research — your source for everything specific about this subject):
"""
${brief.dossier}
"""`;
  }

  private buildBookPromise(
    title: string,
    subtitle: string,
    brief?: BookBrief,
  ): string {
    const subject = brief?.subject?.trim() || 'the subject named in the title';
    const { context } = this.styleFor(brief, title, subtitle);
    const subtitleLine = subtitle?.trim()
      ? `Subtitle promise: ${subtitle.trim()}`
      : 'Subtitle promise: no subtitle was provided, so tell the full story of the subject.';

    return `BOOK PROMISE AND FACT CONTRACT:
- The historical subject this book covers: ${subject}
- Title: ${title}
- ${subtitleLine}
- Every chapter is about this subject. Make sure you are writing about the right one: if the name could refer to more than one event, person or period, use the title, subtitle and author notes to identify it, and stay consistent.
- Treat the title and subtitle as the contract with the reader. If they promise an angle (a period, a region, a group of people, a question), give that angle the most weight while still telling a coherent story. A title never overrides the evidence: if it implies more than the sources show, stay with the sources.
- Use accurate, named details: places, institutions, offices, rulers, dates and documents, as the dossier gives them.
- BROADER CONTEXT: this is one independent, standalone book. Let the chapter order, section headings and emphasis come from this subject and this book's plan rather than from a fixed formula or from any earlier telling of it, so the finished book reads as its own work.

BOOK CONTEXT (this book's own angle — keep it consistent across every chapter):
- Written for: ${context.reader}. Pitch explanations, background and pace to them.
- The question this book keeps asking: ${context.drivingQuestion} Keep it in view; each chapter should add something to the answer, without forcing it into every paragraph.
- Lens: the book looks at the subject mainly through ${context.lens}. Give it extra weight where the evidence supports it, without leaving out what matters most.
- Pacing: ${context.pacing}
${this.buildDossierBlock(brief)}
${this.buildAuthorNotesBlock(brief)}`;
  }

  private buildHistoryQualityRules(): string {
    return `REAL HISTORY STANDARD:
- Write like a finished chapter of a serious published narrative history book, not notes, a textbook summary, an encyclopedia entry, a blog post or a documentary script.
- Use the section headings from the outline, then write polished narrative paragraphs under them.
- Keep the timeline clear: anchor sections with dates where the sources support them, and make time jumps obvious.
- Each section should answer what happened, when, where, who was involved, how we know, and what it led to.
- Keep evidence and interpretation apart, and say when historians disagree.
- Link causes and effects only when the evidence or historians support the link — don't invent motives or psychology.
- No placeholder phrases, no TODO-style notes, no filler transitions, no fake cliffhangers.

${PLAIN_LANGUAGE_RULES}`;
  }

  private buildMainChapterDepthRules(): string {
    return `MAIN CHAPTER LENGTH AND DEPTH REQUIREMENTS:
- This is a main chapter, so make it long, full and satisfying. Do not write a short overview.
- Write 35-45 substantial paragraphs covering every section and subsection in the outline.
- Each paragraph should usually have 3-5 clear sentences. Short paragraphs are fine for emphasis, but most need real detail.
- Introduce people, places, offices, institutions and unfamiliar terms the first time they appear, for a reader who is new to this subject.
- Depth comes from documented detail, context and consequence: how people lived and worked, how power was organized, what the land and the distances were like, what the sources can and cannot tell us. Never from invented scenes, dialogue, quotes or numbers, and never from more violent detail.
- If the evidence for this stage is thin, cover the context honestly and say plainly that less is known. Do not pad, and do not invent.`;
  }

  // ══════════════════════════════════════════════════════════════
  // FIXED: Provider calls with timeout using AbortController
  // ══════════════════════════════════════════════════════════════
  private async generateWithProvider(
    provider: APIProvider,
    prompt: string,
    systemPrompt: string = buildHistorySystemPrompt(buildStyleProfile('default')),
    options: GenerationOptions = {},
  ): Promise<string> {
    await this.waitForProviderCooldown(provider);
    provider.lastUsedAt = Date.now();
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.REQUEST_TIMEOUT_MS);
    try {
      if (provider.type === 'gemini') {
        const model = (
          provider.client as GoogleGenerativeAI
        ).getGenerativeModel({
          model: provider.model,
          // Fix 1: In generateWithProvider, increase maxOutputTokens for Gemini
         generationConfig: {
            temperature: options.temperature ?? (0.95 + (Math.random() * 0.15)),
            topP: options.topP ?? (0.88 + (Math.random() * 0.08)),
            topK: options.topK ?? (40 + Math.floor(Math.random() * 20)),
            maxOutputTokens: options.maxOutputTokens ?? 16384,
            responseMimeType: options.responseMimeType,
          },
          systemInstruction: systemPrompt,
          // Newer than this SDK's types, which only know the retired retrieval tool
          ...(options.webSearch ? { tools: [{ googleSearch: {} } as any] } : {}),
        });
        // Pass abort signal to the request
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        clearTimeout(timeoutId);
        const response = await result.response;

        // Reset error count on success
        provider.consecutiveErrors = 0;

        const text = response.text();
        // Gemini can finish normally with no text at all
        if (!text.trim() || this.looksLikeRefusal(text)) {
          throw this.contentBlockedError('the model declined');
        }
        options.onSources?.(
          (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
            .filter((chunk) => chunk.web?.uri)
            .map((chunk) => ({
              title: chunk.web?.title || '',
              url: chunk.web?.uri as string,
              domain: '',
            })),
        );
        return text;
      } else if (options.webSearch) {
        const response = await (provider.client as OpenAI).responses.create(
          {
            model: this.openaiResearchModel,
            instructions: systemPrompt,
            input: prompt,
            tools: [{ type: 'web_search' }],
          },
          { signal: controller.signal },
        );
        clearTimeout(timeoutId);
        provider.consecutiveErrors = 0;

        const text = response.output_text || '';
        if (!text.trim() || this.looksLikeRefusal(text)) {
          throw this.contentBlockedError('the model declined');
        }
        const sources: ResearchSource[] = [];
        for (const item of response.output) {
          if (item.type !== 'message') continue;
          for (const part of item.content) {
            if (part.type !== 'output_text') continue;
            for (const note of part.annotations) {
              if (note.type === 'url_citation') {
                sources.push({ title: note.title, url: note.url, domain: '' });
              }
            }
          }
        }
        options.onSources?.(sources);
        return text;
      } else {
        const completion = await (
          provider.client as OpenAI
        ).chat.completions.create(
          {
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: options.temperature ?? 0.9,
            frequency_penalty: options.frequencyPenalty ?? 0.4,
            presence_penalty: options.presencePenalty ?? 0.3,
            response_format:
              options.responseMimeType === 'application/json'
                ? { type: 'json_object' }
                : undefined,
          },
          {
            signal: controller.signal,
          },
        );
        clearTimeout(timeoutId);

        // Reset error count on success
        provider.consecutiveErrors = 0;

        const message = completion.choices[0]?.message;
        const text = message?.content || '';
        if (message?.refusal || !text.trim() || this.looksLikeRefusal(text)) {
          throw this.contentBlockedError('the model declined');
        }
        return text;
      }
    } catch (error: any) {
      clearTimeout(timeoutId);

      // Track the error. A blocked text says nothing about this key's health,
      // so it must not count toward locking the key out.
      if (!this.isContentBlockedError(error)) {
        provider.consecutiveErrors++;
        provider.lastErrorAt = Date.now();
        provider.lastErrorType = error?.name || error?.code || 'unknown';
      }

      // Convert abort to timeout error for clearer logging
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(
          `Request timeout after ${this.REQUEST_TIMEOUT_MS}ms`,
        );
        (timeoutError as any).name = 'TimeoutError';
        (timeoutError as any).originalError = error;
        throw timeoutError;
      }

      throw error;
    }
  }
  // ══════════════════════════════════════════════════════════════
  // FIXED: Provider rotation with network error handling and delays
  // ══════════════════════════════════════════════════════════════
  private async generateWithProviderRotation(
    prompt: string,
    systemPrompt?: string,
    options: GenerationOptions = {},
  ): Promise<string> {
    const maxAttempts = this.apiProviders.length * 2;
    let lastError: any;
    let attemptCount = 0;

    while (attemptCount < maxAttempts) {
      attemptCount++;

      const provider = this.getNextProvider();

      if (!provider) {
        const now = Date.now();
        let soonest: APIProvider | null = null;
        let shortestWait = Infinity;

        for (const p of this.apiProviders) {
          let waitTime = 0;

          if (p.rateLimitedUntil > now) {
            waitTime = p.rateLimitedUntil - now;
          } else if (p.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
            const timeSinceError = now - p.lastErrorAt;
            waitTime = Math.max(0, this.EXTENDED_LOCKOUT_MS - timeSinceError);
          }
          if (waitTime < shortestWait) {
            shortestWait = waitTime;
            soonest = p;
          }
        }

        if (soonest && shortestWait > 0) {
          const cappedWait = Math.min(shortestWait, 60000);
          this.logger.warn(
            `All providers locked out. Waiting ${Math.round(cappedWait / 1000)}s for ${soonest.type} provider...`,
          );
          await this.sleep(cappedWait);

          soonest.rateLimitedUntil = 0;
          if (soonest.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
            soonest.consecutiveErrors = Math.floor(
              this.MAX_CONSECUTIVE_ERRORS / 2,
            );
          }
        }

        continue;
      }

      const providerIdx = this.apiProviders.indexOf(provider) + 1;

      try {
        this.logger.log(
          `Attempting with ${provider.type} provider #${providerIdx} (attempt ${attemptCount}/${maxAttempts})...`,
        );

        const result = await this.generateWithProvider(
          provider,
          prompt,
          systemPrompt,
          options,
        );
        return result;
      } catch (error: any) {
        lastError = error;

        const errorType = this.isContentBlockedError(error)
          ? 'content_blocked'
          : this.isAccessDeniedError(error)
          ? 'access_denied' // ← NEW
          : this.isModelUnavailableError(error)
            ? 'model_unavailable'
          : this.isRateLimitError(error)
            ? 'rate_limit'
            : this.isNetworkError(error)
              ? 'network'
              : this.isOverloadError(error)
                ? 'overload'
                : 'other';

        this.logger.warn(
          `${provider.type} provider #${providerIdx} failed (${errorType}): ${error?.message?.substring(0, 100)}`,
        );

        // ══════════════════════════════════════════════════════════
        // 403 ACCESS DENIED — Lock out permanently, skip to next
        // ══════════════════════════════════════════════════════════
        if (this.isAccessDeniedError(error)) {
          // Lock this key out for 24 hours — it's denied, not just busy
          provider.rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000;
          provider.consecutiveErrors = this.MAX_CONSECUTIVE_ERRORS; // Mark as bad
          this.logger.error(
            `Provider #${providerIdx} (${provider.type}) ACCESS DENIED (403) — permanently skipping this key. Try the next provider immediately.`,
          );
          // NO DELAY — immediately try next provider, no point waiting
          continue;
        }

        // 404 MODEL UNAVAILABLE — same model on every key of this type, so
        // lock this provider out and move on (e.g. to OpenAI) right away
        if (this.isModelUnavailableError(error)) {
          provider.rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000;
          provider.consecutiveErrors = this.MAX_CONSECUTIVE_ERRORS;
          this.logger.error(
            `Provider #${providerIdx} (${provider.type}) model "${provider.model}" is unavailable (404) — skipping it. Set GEMINI_MODEL / OPENAI_MODEL to a current model.`,
          );
          continue;
        }

        if (this.isRateLimitError(error)) {
          provider.rateLimitedUntil = Date.now() + this.RATE_LIMIT_LOCKOUT_MS;
          this.logger.warn(
            `Provider #${providerIdx} rate limited, locked out for ${this.RATE_LIMIT_LOCKOUT_MS / 1000}s`,
          );
        } else if (this.isNetworkError(error)) {
          const lockoutMs = this.addJitter(5000);
          provider.rateLimitedUntil = Date.now() + lockoutMs;
          this.logger.warn(
            `Provider #${providerIdx} network error, brief lockout for ${Math.round(lockoutMs / 1000)}s`,
          );
        } else if (this.isOverloadError(error)) {
          const lockoutMs = this.addJitter(30000);
          provider.rateLimitedUntil = Date.now() + lockoutMs;
          this.logger.warn(
            `Provider #${providerIdx} overloaded, locked out for ${Math.round(lockoutMs / 1000)}s`,
          );
        }

        if (this.isRetryableError(error) && attemptCount < maxAttempts) {
          const switchDelay = this.addJitter(this.PROVIDER_SWITCH_DELAY_MS);
          this.logger.debug(
            `Waiting ${switchDelay}ms before trying next provider...`,
          );
          await this.sleep(switchDelay);
          continue;
        }

        if (!this.isRetryableError(error)) {
          this.logger.error(
            `Non-retryable error from provider #${providerIdx}:`,
            error,
          );
          throw error;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // Check if ALL providers are access-denied before giving up
    // ══════════════════════════════════════════════════════════════
    const allDenied = this.apiProviders.every(
      (p) => p.rateLimitedUntil > Date.now() + 23 * 60 * 60 * 1000,
    );

    if (allDenied) {
      this.logger.error(
        'ALL providers have been access-denied (403). Check your API keys — they may be revoked or billing has lapsed.',
      );
      throw new Error(
        'All API keys are access-denied (403 Forbidden). Please check your API key configuration.',
      );
    }

    this.logger.error(`All ${maxAttempts} provider attempts failed`);
    throw lastError || new Error('All providers failed');
  }

  private async generateOutlineJson(
    prompt: string,
    systemPrompt: string,
  ): Promise<string> {
    return await this.generateWithProviderRotation(prompt, systemPrompt, {
      temperature: 0.2,
      topP: 0.8,
      topK: 20,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RESEARCH — live web search, one pass per topic
  // ═══════════════════════════════════════════════════════════════
  async researchSubject(brief: BookBrief): Promise<TopicResearch> {
    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt =
      'You are a careful historical researcher. You report only what your searches find, in your own words, you keep evidence and interpretation apart, and you never guess.';
    const sections: string[] = [];
    const cited: ResearchSource[] = [];

    for (const pass of RESEARCH_PASSES) {
      this.logger.log(`Researching "${brief.subject}": ${pass.id}`);
      let passSources: ResearchSource[] = [];
      let text = '';

      try {
        text = await this.generateWithProviderRotation(
          buildResearchPrompt(pass, brief.subject, today, brief.notes),
          systemPrompt,
          {
            temperature: 0.2,
            maxOutputTokens: 4096,
            webSearch: true,
            onSources: (sources) => (passSources = sources),
          },
        );
      } catch (error: any) {
        this.logger.error(`Research pass ${pass.id} failed: ${error?.message}`);
        if (pass.required) {
          throw bookStoppedError(
            'Web research is not available right now, so this book was not written. Check that billing is enabled for web search on your Gemini or OpenAI account, then try again.',
          );
        }
        continue;
      }

      if (subjectNotFound(text)) {
        if (pass.required) {
          throw bookStoppedError(
            `No reliable public sources could be found for "${brief.subject}", so this book was not written. Check the spelling, or add the place and period.`,
          );
        }
        continue;
      }

      // Without citations this is the model's memory, not research
      if (!passSources.length) {
        this.logger.warn(`Research pass ${pass.id} cited nothing; discarded`);
        continue;
      }

      sections.push(`${pass.heading}\n${text.trim()}`);
      cited.push(...passSources);
    }

    // Citations are often temporary redirects: follow them to the real page
    const candidates = uniqueSources(cited);
    const sources: ResearchSource[] = [];
    const pages: string[] = [];
    for (let i = 0; i < candidates.length; i += 5) {
      const batch = candidates.slice(i, i + 5);
      const results = await Promise.all(
        batch.map((source) => readSourcePage(source.url)),
      );
      results.forEach((page, index) => {
        if (!page || !isUsableSource(page.url)) return;
        sources.push({
          ...batch[index],
          url: page.url,
          domain: domainOf(page.url),
        });
        if (page.text) pages.push(page.text);
      });
    }
    const usable = uniqueSources(sources);

    const hasOverview = sections.some((s) =>
      s.startsWith(RESEARCH_PASSES[0].heading),
    );
    const domains = new Set(usable.map((s) => s.domain));
    this.logger.log(
      `Research on "${brief.subject}": ${sections.length}/${RESEARCH_PASSES.length} passes, ${usable.length} sources from ${domains.size} sites, ${pages.length} pages read`,
    );
    if (
      !hasOverview ||
      usable.length < MIN_SOURCES ||
      domains.size < MIN_SOURCE_DOMAINS
    ) {
      throw bookStoppedError(
        `Too few reliable public sources were found for "${brief.subject}" (${usable.length} from ${domains.size} sites), so this book was not written. Check the subject name, or choose a better documented subject.`,
      );
    }

    return { dossier: sections.join('\n\n'), sources: usable, pages };
  }

  /** Rewrites only the passages the originality check flagged */
  async rewriteCopiedPassages(
    text: string,
    passages: string[],
    title: string,
    subtitle: string,
    brief: BookBrief,
  ): Promise<string> {
    const prompt = `The passages below from this history chapter match the wording of an existing source word for word. Rewrite each one completely, with new wording and new sentence structure, keeping the facts accurate. If a passage is a quotation, replace it with attributed paraphrase. Leave the rest of the chapter exactly as it is. Do not shorten the chapter or add new facts.

MATCHING PASSAGES:
${passages.map((passage, i) => `${i + 1}. ${passage}`).join('\n')}

CHAPTER:
${text}

Return ONLY the full chapter text. No commentary.`;

    return await this.generateText(prompt, {
      systemPrompt: this.getSystemPrompt(brief, title, subtitle),
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════
  // Strip leaked conversational wrapper text (e.g. "Here's a polished
  // version of your chapter..." / "Let me know if you'd like changes!")
  // Models sometimes answer the prompt like a chat reply instead of
  // returning only the requested document body. This detects and
  // removes that wrapper without touching the actual content.
  // ═══════════════════════════════════════════════════════════════
  private stripConversationalWrapper(text: string): string {
    let result = text.trim();

    // Only ever consider the first paragraph as a candidate preamble —
    // never strip anything past the first blank line, so real content
    // that happens to start with "Here's" (rare) survives untouched
    // beyond the first paragraph.
    const paragraphs = result.split(/\n{2,}/);

    if (paragraphs.length > 1) {
      const firstParagraph = paragraphs[0].trim();
      const looksLikePreamble =
        firstParagraph.length < 400 &&
        /^(here'?s?|here is|below is|sure[,!]?|certainly[,!]?|absolutely[,!]?|okay[,!]?|i'?ve|i have|great[,!]?|of course[,!]?|this is)\b/i.test(
          firstParagraph,
        ) &&
        /\b(polish|refine|revis|rewrit|version|draft|chapter|section|edit|updated|final|book)\w*\b/i.test(
          firstParagraph,
        );

      if (looksLikePreamble) {
        result = paragraphs.slice(1).join('\n\n').trim();
      }
    }

    // Strip a leaked sign-off / trailing chat commentary, e.g.
    // "Let me know if you'd like any adjustments!" or
    // "I hope this helps with your book!"
    const lines = result.split('\n');
    while (lines.length > 1) {
      const lastLine = lines[lines.length - 1].trim();
      const looksLikeSignOff =
        lastLine.length > 0 &&
        lastLine.length < 300 &&
        /\b(let me know|i hope this helps|feel free to|happy to (?:adjust|revise|tweak)|want me to|would you like)\b/i.test(
          lastLine,
        );

      if (looksLikeSignOff) {
        lines.pop();
        while (lines.length && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }
      } else {
        break;
      }
    }

    return lines.join('\n').trim();
  }

  // ═══════════════════════════════════════════════════════════════
  // Post-processing — strips AI-tell phrasing
  // ═══════════════════════════════════════════════════════════════
  private humanizeText(text: string): string {
    let result = this.stripConversationalWrapper(text);

    const patterns = this.getAITellPatterns();
    for (const { pattern, replacement } of patterns) {
      result = result.replace(pattern, replacement);
    }

    result = result.replace(/ {2,}/g, ' ');
    result = result.replace(/\n{3,}/g, '\n\n');

    for (const uniformPattern of SENTENCE_UNIFORMITY_PATTERNS) {
      const matches = result.match(uniformPattern);
      if (matches && matches.length > 3) {
        this.logger.warn(
          `Detected ${matches.length} repetitive sentence patterns: "${matches[0].substring(0, 40)}..."`,
        );
      }
    }

    return result.trim();
  }

  private countMatches(text: string, pattern: RegExp): number {
    return text.match(pattern)?.length || 0;
  }

  private getRepeatedParagraphStarts(text: string): string[] {
    const starts = text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim().match(/^["']?([A-Za-z]{3,})\b/)?.[1])
      .filter((word): word is string => Boolean(word))
      .map((word) => word.toLowerCase());

    const counts = new Map<string, number>();
    for (const start of starts) {
      counts.set(start, (counts.get(start) || 0) + 1);
    }

    return [...counts.entries()]
      .filter(([, count]) => count >= 4)
      .map(([word]) => word);
  }

  private getAuthenticityIssues(text: string): AuthenticityIssue[] {
    const issues: AuthenticityIssue[] = [];
    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    const lower = text.toLowerCase();
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const headingCount = this.countMatches(text, /^[A-Z][^\n]{3,80}$/gm);
    // History spans every era: four-digit years, BCE/CE dates and centuries
    // all anchor the reader in time
    const timeAnchorCount =
      this.countMatches(
        text,
        /\b(?:\d{1,4}\s?(?:BCE|BC|CE|AD)|(?:AD|CE)\s?\d{1,4}|1\d{3}s?|20\d\ds?)\b/g,
      ) +
      this.countMatches(
        lower,
        /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|\d{1,2}(?:st|nd|rd|th))[- ]century\b/g,
      );
    // Long quoted passages are where invented words and copied text
    // (including copyrighted translations) both show up
    const longQuoteCount = this.countMatches(text, /["“][^"”\n]{25,}["”]/g);
    // Paragraphs that open on a quotation are usually invented dialogue
    const dialogueCount = this.countMatches(text, /^\s*["“][^"”\n]{3,}["”]/gm);
    const privateThoughtCount = this.countMatches(
      lower,
      /\b(?:he|she|they|the (?:king|queen|emperor|empress|general|commander|soldiers?|sultan|pope|governor))\s+(?:thought|wondered|felt|knew|realized|realised|sensed|feared|hoped)\s+(?:to\s+(?:him|her|them)sel(?:f|ves)|that|deep down)\b|\b(?:couldn't help but|in (?:his|her|their) heart|deep down,? (?:he|she|they))\b/g,
    );
    const noteLikeCount = this.countMatches(
      text,
      /^\s*(?:[-*•]|\d+[.)]|#{1,6}\s)/gm,
    );
    const genericPhraseCount = this.countMatches(
      lower,
      /\b(little did (?:he|she|they) know|the rest is history|throughout history|since the dawn of time|in the annals of history|(?:changed|altered) the course of (?:history|the world)|forever changed|would never be the same|shaped the world we (?:live in|know) today|stood the test of time|a bygone era|days of yore|in this chapter|this section|as mentioned earlier)\b/g,
    );
    const loadedLabelCount = this.countMatches(
      lower,
      /\b(savages?|savagery|barbaric|uncivili[sz]ed|primitive (?:people|peoples|tribes?|natives|races?)|backward (?:people|peoples|natives)|bloodthirsty|heathen hordes|evil incarnate|pure evil)\b/g,
    );
    const grandiloquentCount = this.countMatches(
      lower,
      /\b(glorious|epic|legendary|mighty empire|destined|destiny|greatest (?:ever|of all time)|unrivall?ed)\b/g,
    );
    const graphicCount = this.countMatches(
      lower,
      /\b(pools? of blood|blood-soaked|blood-spattered|covered in blood|dismember\w*|mutilat\w*|decapitat\w*|disembowel\w*|entrails|gore|gaping wounds?|flayed|impaled)\b/g,
    );
    const clicheOpener =
      /^[^\n.]{0,80}(?:\bthroughout (?:human )?history\b|\bsince the dawn of\b|\bin the annals of\b|\bwas born (?:on|in)\b|\bit was a (?:dark|cold|quiet|cool|warm|rainy|stormy|typical|normal|ordinary)\b|\bon what (?:seemed|began|started)\b|\bimagine\b)/i.test(
        text.trim(),
      );
    const repeatedStarts = this.getRepeatedParagraphStarts(text);

    if (wordCount > 700 && headingCount < 2) {
      issues.push({
        issue: 'few section headings',
        instruction:
          'Add the section headings from the outline so the chapter feels edited and easy to follow.',
      });
    }

    if (paragraphs.length > 10 && timeAnchorCount < 4) {
      issues.push({
        issue: 'weak timeline anchors',
        instruction:
          'Anchor the narrative in time: add years, dates or centuries wherever the sources support them, so readers always know when events happen. Use "about" or "c." for approximate dates. Do not invent dates — leave a year out if you are not confident of it.',
      });
    }

    if (longQuoteCount >= 2) {
      issues.push({
        issue: 'long direct quotations (fabrication and copyright risk)',
        instruction:
          'Turn every long quotation into attributed paraphrase in your own sentence structure ("a chronicler wrote that..."). Keep at most a short, well-known phrase that the research supports, and nothing from any modern book, translation, article, show or historian.',
      });
    }

    if (dialogueCount >= 3) {
      issues.push({
        issue: 'reads like invented dialogue',
        instruction:
          'Remove dialogue nobody recorded. Where a source records what someone said or wrote, give it as attributed paraphrase.',
      });
    }

    if (privateThoughtCount >= 3) {
      issues.push({
        issue: 'narrates private thoughts and feelings',
        instruction:
          'Remove inner thoughts and feelings nobody recorded, or attribute them to the person\'s own letter, diary or memoir ("she later wrote that she feared...").',
      });
    }

    if (noteLikeCount >= 5) {
      issues.push({
        issue: 'content looks like notes or an outline',
        instruction:
          'Convert note-like bullets and fragments into finished narrative prose, keeping only polished headings.',
      });
    }

    if (genericPhraseCount >= 2) {
      issues.push({
        issue: 'stock popular-history phrasing',
        instruction:
          'Replace stock phrases with specific evidence: a document, a decision, a price, a result, a consequence.',
      });
    }

    if (loadedLabelCount >= 1) {
      issues.push({
        issue: 'loaded or demeaning labels for people',
        instruction:
          'Remove labels that demean peoples or turn people into monsters. Describe what they did, and what their contemporaries said about them, in plain, attributed language.',
      });
    }

    if (grandiloquentCount >= 3) {
      issues.push({
        issue: 'grand, glorifying wording',
        instruction:
          'Replace grand words about glory, destiny and greatness with specific, documented facts and their human cost.',
      });
    }

    if (graphicCount >= 2) {
      issues.push({
        issue: 'graphic detail',
        instruction:
          'State what happened once, plainly, and remove injury and violent description the story does not strictly need.',
      });
    }

    if (clicheOpener) {
      issues.push({
        issue: 'opens on a stock line',
        instruction:
          'Open on a specific, documented moment, place, object or detail instead of "Throughout history", a birth-date sentence or an imagined scene.',
      });
    }

    if (repeatedStarts.length > 0) {
      issues.push({
        issue: `repeated paragraph starts: ${repeatedStarts.join(', ')}`,
        instruction:
          'Rewrite paragraph openings so the chapter sounds edited by a human, not generated from a template.',
      });
    }

    return issues;
  }

  private buildRefinementContextBlock(
    heading: string,
    refinementContext?: RefinementContext,
  ): string {
    if (!refinementContext?.bookTitle && !refinementContext?.bookSubtitle) {
      return '';
    }

    return `
${heading}
${refinementContext.bookTitle ? `Title: "${refinementContext.bookTitle}"` : ''}
${refinementContext.bookSubtitle ? `Subtitle: "${refinementContext.bookSubtitle}"` : ''}
${refinementContext.chapterTitle ? `Chapter: "${refinementContext.chapterTitle}"` : ''}
${refinementContext.chapterOutline ? `Chapter outline: ${JSON.stringify(refinementContext.chapterOutline, null, 2)}` : ''}

${this.buildBookPromise(refinementContext.bookTitle || '', refinementContext.bookSubtitle || '', refinementContext.brief)}
${this.buildHistoryQualityRules()}
`;
  }

  private getAuthenticityRewritePrompt(
    text: string,
    issues: AuthenticityIssue[],
    refinementContext?: RefinementContext,
  ): string {
    const issueList = issues
      .map(
        (issue, index) => `${index + 1}. ${issue.issue}: ${issue.instruction}`,
      )
      .join('\n');

    const mainChapterDepthInstruction = refinementContext?.isMainChapter
      ? `
MAIN CHAPTER DEPTH TO PRESERVE:
${this.buildMainChapterDepthRules()}
- Do not shorten the chapter during this final pass, except to remove invented or unsupported material.
`
      : '';

    return `You are doing the final editor, fact-check and copyright pass on a history chapter before publication.

The chapter still has these problems:
${issueList}

${this.buildRefinementContextBlock('BOOK CONTEXT:', refinementContext)}
${mainChapterDepthInstruction}

Apply the FACTUAL ACCURACY, FAIRNESS and COPYRIGHT rules from your instructions in full.

EDITORIAL REQUIREMENTS:
- Make it read like a chapter of a careful, published narrative history book.
- Keep the documented facts already present, but remove filler, repetition, note-like fragments, stock phrases, loaded wording and anything that reads as invented.
- Do not add new facts in this pass unless you are confident they are part of the documented record.
- Use clear headings where helpful, but do not turn the chapter into bullet notes.
- Keep the final chapter in plain English: common words, clear sentences, no jargon, no fancy phrasing.
- Return only the finished chapter text.

CHAPTER TO FIX:
${text}`;
  }

  private async enforceAuthenticity(
    text: string,
    systemPrompt?: string,
    refinementContext?: RefinementContext,
  ): Promise<string> {
    const issues = this.getAuthenticityIssues(text);

    if (issues.length === 0) {
      return text;
    }

    this.logger.warn(
      `Book authenticity audit found ${issues.length} issue(s): ${issues
        .map((issue) => issue.issue)
        .join('; ')}`,
    );

    const rewritePrompt = this.getAuthenticityRewritePrompt(
      text,
      issues,
      refinementContext,
    );
    const rewritten = await this.generateWithProviderRotation(
      rewritePrompt,
      systemPrompt,
    );

    return this.humanizeText(rewritten);
  }

  // ═══════════════════════════════════════════════════════════════
  // Multi-turn refinement — draft, fact/voice critique, audit
  // ═══════════════════════════════════════════════════════════════
  private async generateAndRefine(
    prompt: string,
    systemPrompt?: string,
    refinementContext?: RefinementContext,
  ): Promise<string> {
    const draft = await this.generateWithProviderRotation(prompt, systemPrompt);

    const refined = await this.generateWithProviderRotation(
      this.getRefinePrompt(draft, refinementContext),
      systemPrompt,
    );

    return await this.enforceAuthenticity(
      this.humanizeText(refined),
      systemPrompt,
      refinementContext,
    );
  }

  private getRefinePrompt(
    draft: string,
    refinementContext?: RefinementContext,
  ): string {
    const mainChapterDepthInstruction = refinementContext?.isMainChapter
      ? `
MAIN CHAPTER DEPTH TO PRESERVE:
${this.buildMainChapterDepthRules()}
- During this rewrite, do not shorten the chapter except to remove invented or unsupported material.
`
      : '';

    return `Here is a draft history chapter you wrote. Rewrite it to fix these specific issues:

1. FACT CHECK FIRST: Remove or hedge any claim you are not confident is documented. Delete invented dialogue, speeches, inner thoughts and scenes nobody recorded; turn uncertain quotes into attributed paraphrase, and mark doubtful famous lines as "later attributed to". Where sources differ, say so once, plainly.
2. EVIDENCE VS. INTERPRETATION: Make sure every claim about causes, motives and meaning is either supported by the dossier or attributed to historians. Remove any theory of your own presented as fact. Give uncertain numbers as ranges with who estimated them.
3. ORIGINALITY AND COPYRIGHT: Rewrite any passage that sounds like Wikipedia, an encyclopedia, a textbook, a museum label, a documentary or another history book. Every sentence must be original phrasing. Remove any scene or dialogue that comes from a film, TV drama or novel. Remove all lyrics and poetry, any translated passage longer than a short, well-known phrase, and any quotation from a modern book, article, show or historian. Check that the headings and paragraph order don't follow a stock "Background / Rise / Height / Fall / Legacy" template or the order of any earlier work — the structure should come from this subject and this outline.
4. MYTHS: Remove or correct any popular myth, misattributed quotation or disproven claim the dossier flags.
5. FAIRNESS AND RESPECT: Make sure every side's reasons appear in their own terms. Cut slurs and loaded labels for peoples ("savage", "primitive", "barbaric"). Do not soften atrocities, and do not glorify conquest or violent leaders. Cut gore, torture detail and any description of sexual acts. Cut any detail that could work as instructions for making a weapon or causing harm.
6. Replace stock phrasing ("throughout history", "changed the course of history", "forever changed") with specific evidence: a document, a decision, a price, a result, a consequence.
7. Vary sentence length aggressively — mix short, plain sentences with longer narrative ones; no two consecutive sentences with the same rhythm.
8. Make sure no two consecutive paragraphs start with the same word or the same structure.
9. Keep the timeline clear: dates where the sources support them (with "about" or "c." where approximate), and explicit time jumps.
10. Preserve the subject, angle and promise from the title/subtitle — every paragraph should serve this story.
11. Turn note-like passages into finished narrative prose with the section headings from the outline.
12. THE DESCENDANT TEST: Read it as a descendant of each group in the story would. They should find it accurate and fair, even where it is painful. Ordinary people should appear as people, not as background.
13. RESEARCH CHECK: Every specific fact about the subject must be in the RESEARCH DOSSIER or author notes. Remove anything that isn't, and rewrite any sentence copied from the dossier.
14. VOICE CHECK: It should read like a careful writer telling a true story — not a textbook, not an encyclopedia, not a documentary script. Remove any claim that the writer visited, handled, interviewed or discovered anything.

${this.buildRefinementContextBlock('BOOK CONTEXT TO PRESERVE:', refinementContext)}
${mainChapterDepthInstruction}

DRAFT TO REWRITE:
${draft}

Return ONLY the rewritten text. No commentary.`;
  }

  async generateText(
    prompt: string,
    {
      refine = false,
      systemPrompt,
      refinementContext,
    }: {
      refine?: boolean;
      systemPrompt?: string;
      refinementContext?: RefinementContext;
    } = {},
  ): Promise<string> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.log(
          `Generating book content (attempt ${attempt}/${this.MAX_RETRIES})...`,
        );

        let text: string;

        if (refine) {
          text = await this.generateAndRefine(
            prompt,
            systemPrompt,
            refinementContext,
          );
        } else {
          text = await this.generateWithProviderRotation(prompt, systemPrompt);
          text = this.humanizeText(text);
        }

        this.logger.log('Content generated successfully');
        return text;
      } catch (error: any) {
        lastError = error;
        const isTransientError =
          this.isNetworkError(error) ||
          this.isOverloadError(error) ||
          this.isRateLimitError(error);

        if (isTransientError) {
          if (attempt < this.MAX_RETRIES) {
            const delay = this.INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
            this.logger.warn(
              `All providers temporarily unavailable (attempt ${attempt}/${this.MAX_RETRIES}). Retrying in ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }
        }

        this.logger.error('Error generating content:', error);
        throw error;
      }
    }

    this.logger.error(`All ${this.MAX_RETRIES} retry attempts failed`);
    throw lastError;
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOK OUTLINE — the arc of the story
  // ═══════════════════════════════════════════════════════════════
  async generateBookOutline(
    title: string,
    subtitle: string,
    numberOfChapters: number,
    brief: BookBrief,
  ): Promise<BookOutlineDto> {
    this.logger.log(
      `Generating book outline for "${title}" (subject: ${brief.subject})`,
    );

    const outlineSystemPrompt =
      'You are a book editor specializing in narrative history, careful about accuracy, fairness and original structure. Return only one valid JSON object. No markdown, no backticks, no comments, no ellipses, no placeholders, no explanation.';

    // Split large outlines into two halves to stay within token limits
    const useChunkedGeneration = numberOfChapters > 8;
    const MAX_OUTLINE_ATTEMPTS = 3;

    if (useChunkedGeneration) {
      return await this.generateBookOutlineChunked(
        title,
        subtitle,
        numberOfChapters,
        brief,
        outlineSystemPrompt,
      );
    }

    // ── Single-pass generation for ≤8 chapters ──────────────────
    const prompt = this.buildOutlinePrompt(
      title,
      subtitle,
      numberOfChapters,
      1,
      numberOfChapters,
      brief,
    );

    for (let attempt = 1; attempt <= MAX_OUTLINE_ATTEMPTS; attempt++) {
      this.logger.log(
        `Generating book outline (attempt ${attempt}/${MAX_OUTLINE_ATTEMPTS})...`,
      );

      const response = await this.generateOutlineJson(
        prompt,
        outlineSystemPrompt,
      );

      const outline = this.parseAndValidateOutline(
        response,
        numberOfChapters,
        attempt,
        MAX_OUTLINE_ATTEMPTS,
      );

      if (outline) {
        return { title, subtitle, author: '', chapters: outline.chapters };
      }

      if (attempt < MAX_OUTLINE_ATTEMPTS) {
        this.logger.warn(
          `Outline attempt ${attempt} failed. Retrying in 3s...`,
        );
        await this.sleep(3000);
      }
    }

    throw new Error(
      `Failed to generate a valid book outline after ${MAX_OUTLINE_ATTEMPTS} attempts`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CHUNKED GENERATION — For books with >8 chapters
  // Splits into ranges, and recursively shrinks failed ranges.
  // Later ranges see the chapters already planned so the timeline
  // continues instead of restarting.
  // ═══════════════════════════════════════════════════════════════
  private async generateBookOutlineChunked(
    title: string,
    subtitle: string,
    numberOfChapters: number,
    brief: BookBrief,
    outlineSystemPrompt: string,
  ): Promise<BookOutlineDto> {
    const half = Math.ceil(numberOfChapters / 2);

    this.logger.log(
      `Outline too large (${numberOfChapters} chapters) — generating in two chunks: [1-${half}] and [${half + 1}-${numberOfChapters}]`,
    );

    const chunk1Chapters = await this.generateOutlineRange(
      title,
      subtitle,
      numberOfChapters,
      1,
      half,
      brief,
      outlineSystemPrompt,
      [],
    );

    const chunk2Chapters = await this.generateOutlineRange(
      title,
      subtitle,
      numberOfChapters,
      half + 1,
      numberOfChapters,
      brief,
      outlineSystemPrompt,
      chunk1Chapters,
    );

    // ── Merge chunks and fix chapter numbers ─────────────────────
    const allChapters: ChapterOutline[] = [
      ...chunk1Chapters,
      ...chunk2Chapters,
    ].map((chapter, idx) => ({
      ...chapter,
      chapterNumber: idx + 1,
    }));

    this.logger.log(
      `Outline chunks merged successfully: ${allChapters.length} chapters total`,
    );

    return { title, subtitle, author: '', chapters: allChapters };
  }

  private async generateOutlineRange(
    title: string,
    subtitle: string,
    totalChapters: number,
    fromChapter: number,
    toChapter: number,
    brief: BookBrief,
    outlineSystemPrompt: string,
    previousChapters: ChapterOutline[],
  ): Promise<ChapterOutline[]> {
    const chapterCount = toChapter - fromChapter + 1;
    const MAX_OUTLINE_ATTEMPTS = 3;
    const prompt = this.buildOutlinePrompt(
      title,
      subtitle,
      totalChapters,
      fromChapter,
      toChapter,
      brief,
      previousChapters,
    );

    for (let attempt = 1; attempt <= MAX_OUTLINE_ATTEMPTS; attempt++) {
      this.logger.log(
        `Generating outline chapters ${fromChapter}-${toChapter}, attempt ${attempt}/${MAX_OUTLINE_ATTEMPTS}...`,
      );

      const response = await this.generateOutlineJson(
        prompt,
        outlineSystemPrompt,
      );

      const parsed = this.parseAndValidateOutline(
        response,
        chapterCount,
        attempt,
        MAX_OUTLINE_ATTEMPTS,
      );

      if (parsed) {
        return parsed.chapters;
      }

      if (attempt < MAX_OUTLINE_ATTEMPTS) {
        await this.sleep(3000);
      }
    }

    if (chapterCount > 1) {
      const midpoint = Math.floor((fromChapter + toChapter) / 2);
      this.logger.warn(
        `Outline chapters ${fromChapter}-${toChapter} failed as one range; splitting into ${fromChapter}-${midpoint} and ${midpoint + 1}-${toChapter}`,
      );

      const first = await this.generateOutlineRange(
        title,
        subtitle,
        totalChapters,
        fromChapter,
        midpoint,
        brief,
        outlineSystemPrompt,
        previousChapters,
      );
      const second = await this.generateOutlineRange(
        title,
        subtitle,
        totalChapters,
        midpoint + 1,
        toChapter,
        brief,
        outlineSystemPrompt,
        [...previousChapters, ...first],
      );
      return [...first, ...second];
    }

    throw new Error(
      `Failed to generate outline chapter ${fromChapter} after all attempts`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // PROMPT BUILDER — Generates prompt for a specific chapter range
  // ═══════════════════════════════════════════════════════════════
  private buildOutlinePrompt(
    title: string,
    subtitle: string,
    totalChapters: number,
    fromChapter: number,
    toChapter: number,
    brief: BookBrief,
    previousChapters: ChapterOutline[] = [],
  ): string {
    const chapterCount = toChapter - fromChapter + 1;
    const isFirstChunk = fromChapter === 1;
    const isLastChunk = toChapter === totalChapters;
    const isFullOutline = isFirstChunk && isLastChunk;

    let chapterRules = '';

    const intro = `Chapter 1: Introduction — what this subject is, why it is worth understanding and the book's angle, built around one documented moment, place, object or person (not a battle scene invented for effect)`;
    const conclusion = `Conclusion — what changed because of these events, how they have been remembered, and what historians still debate`;

    if (isFullOutline) {
      chapterRules = `
3. ${intro}
4. Chapters 2-${totalChapters - 1}: The story, in time order
5. Chapter ${totalChapters}: ${conclusion}`;
    } else if (isFirstChunk) {
      chapterRules = `
3. ${intro}
4. Chapters 2-${toChapter}: The story, in time order (first half of the book: the background and events onward)
NOTE: This is the FIRST HALF of a ${totalChapters}-chapter book. Do NOT include a conclusion chapter here, and do not cover the later stages of the story yet.`;
    } else if (isLastChunk) {
      chapterRules = `
3. Chapters ${fromChapter}-${toChapter - 1}: The story, continuing in time order from where the earlier chapters stop
4. Chapter ${toChapter}: ${conclusion}
NOTE: This is the SECOND HALF of a ${totalChapters}-chapter book. Number chapters starting from ${fromChapter}.`;
    } else {
      chapterRules = `
3. Chapters ${fromChapter}-${toChapter}: The story, continuing in time order
NOTE: This is a middle section of a ${totalChapters}-chapter book. Number chapters starting from ${fromChapter}.`;
    }

    const style = this.styleFor(brief, title, subtitle);

    const alreadyPlanned = previousChapters.length
      ? `
CHAPTERS ALREADY PLANNED (continue the timeline from here — do not repeat these periods or events):
${previousChapters
  .map((c) => `- Chapter ${c.chapterNumber}: ${c.chapterTitle}`)
  .join('\n')}
`
      : '';

    return `Create a detailed outline for chapters ${fromChapter} through ${toChapter} of a narrative history book about ${brief.subject}.

Book Title: "${title}"
Subtitle: "${subtitle}"
Total book length: ${totalChapters} chapters
Generate: EXACTLY ${chapterCount} chapters (chapters ${fromChapter}-${toChapter})

${this.buildBookPromise(title, subtitle, brief)}
${alreadyPlanned}
${HISTORY_FACT_RULES}

${HISTORY_FAIRNESS_RULES}

${HISTORY_COPYRIGHT_RULES}

THIS BOOK'S SHAPE: ${style.architecture.outline}
HEADING STYLE for section titles: ${style.headingStyle}

REQUIREMENTS:
1. Generate EXACTLY ${chapterCount} chapters
2. Number chapters from ${fromChapter} to ${toChapter}${chapterRules}
6. Each chapter should have 2 to 5 sections (vary it — not every chapter needs the same count)
7. Each section should have 2 to 4 subsections (vary these too)
8. Every subsection must be a non-empty string — no blank entries
9. Section and subsection titles should sound like a human wrote them — no generic filler
10. Main chapters follow the story in time order. Each covers a distinct stage or turning point — for example the world before, the roots and causes, the first signs of change, key events and decisions, the people caught up in them, daily life during them, consequences, and how the story was remembered — chosen and named to fit this particular subject. Include only stages the sources support. No overlaps, no repeats.
11. Do not use bare generic chapter titles like "Background", "The Rise", "The Fall", "The Aftermath" or "Legacy". Name the place, document, object, decision, date or question. Do not reuse chapter titles from any existing book, documentary, series or podcast about this subject.
12. Plan chapters, sections and subsections only around events you are confident are documented, or that appear in the author notes. Do not plan sections around legends, myths or apocryphal stories except to correct them.
13. No title may glorify violence or conquest, use a slur or loaded label for any people, or present a myth or doubtful quotation as fact.
14. Give real space to ordinary people and to those affected by events, not only to rulers and generals, as far as the dossier allows. Do not plan any section around the details of violence, torture or a sexual crime.
14a. Plan only from the RESEARCH DOSSIER and author notes. Choose your own selection and order of facts: the dossier's order is not the book's, and neither is any other book's.${brief.avoidTitles?.length ? `\n14b. Other books have already used these chapter titles for this subject. Do not reuse them or close variations:\n${brief.avoidTitles.map((t) => `- ${t}`).join('\n')}` : ''}
15. If historians are still actively debating the subject, or new discoveries are recent, the conclusion covers where things stand "as of this writing".
16. If the subtitle promises an angle, era or count, honor it clearly across the chapters without padding or duplicate ideas.
17. Use plain English for all titles, sections, and subsections: common words, direct phrasing, no jargon

BAD chapter/section titles (too generic, too grand or too loaded):
- "Background"
- "The Rise and Fall"
- "A Glorious Victory"
- "The Savage Frontier"

GOOD chapter/section titles (specific, but only when true for this subject):
- "The Price of Bread"
- "Nine Days to the Capital"
- "The Ledger in the Customs House"
- "What the Chronicler Left Out"

JSON RULES:
- Return one complete JSON object and nothing else
- Do not include comments, markdown, backticks, notes, or explanations
- Do not use ellipses, "omitted", "as above", "continue similarly", or placeholder chapters
- Every chapter, section, and subsection must be fully written out

OUTPUT FORMAT (JSON):
{
  "chapters": [
    {
      "chapterNumber": ${fromChapter},
      "chapterTitle": "A specific chapter title",
      "sections": [
        {
          "sectionTitle": "A specific interesting title",
          "subsections": ["Concrete topic 1", "Concrete topic 2", "Concrete topic 3"]
        }
      ]
    }
  ]
}

Generate ALL ${chapterCount} chapters (${fromChapter} through ${toChapter}). CRITICAL: Return valid JSON only. Use double quotes for all strings. No single quotes, no trailing commas, no markdown.`;
  }

  // ═══════════════════════════════════════════════════════════════
  // JSON PARSER — Tries clean parse, then repair, then partial salvage
  // ═══════════════════════════════════════════════════════════════
  private parseAndValidateOutline(
    response: string,
    expectedChapters: number,
    attempt: number,
    maxAttempts: number,
  ): { chapters: ChapterOutline[] } | null {
    const cleaned = this.extractLikelyJson(response);

    // ── Attempt 1: clean parse ────────────────────────────────────
    let outline = this.tryParseJson(cleaned);

    // ── Attempt 2: repair truncated JSON ─────────────────────────
    if (!outline) {
      this.logger.warn(
        `Attempt ${attempt}: Clean JSON parse failed — trying repair...`,
      );
      outline = this.tryRepairJson(cleaned);
    }

    if (!outline) {
      this.logger.error(
        `Attempt ${attempt}/${maxAttempts}: Could not parse or repair outline JSON. ` +
          `Response tail: ...${cleaned.slice(-200)}`,
      );
      return null;
    }

    if (!outline.chapters || !Array.isArray(outline.chapters)) {
      this.logger.error(
        `Attempt ${attempt}/${maxAttempts}: Outline missing chapters array`,
      );
      return null;
    }

    if (this.containsOutlinePlaceholders(outline)) {
      this.logger.error(
        `Attempt ${attempt}/${maxAttempts}: Outline contains placeholder or editorial text`,
      );
      return null;
    }

    // ── Chapter count check ───────────────────────────────────────
    if (outline.chapters.length < expectedChapters) {
      this.logger.warn(
        `Attempt ${attempt}/${maxAttempts}: Got ${outline.chapters.length} chapters, expected ${expectedChapters}`,
      );
      // Only hard-fail on last attempt — partial outlines on early attempts → retry
      if (attempt === maxAttempts) {
        throw new Error(
          `AI generated only ${outline.chapters.length} chapters instead of ${expectedChapters} after ${maxAttempts} attempts`,
        );
      }
      return null;
    }

    // Trim if too many chapters came back
    if (outline.chapters.length > expectedChapters) {
      this.logger.warn(
        `Got ${outline.chapters.length} chapters, trimming to ${expectedChapters}`,
      );
      outline.chapters = outline.chapters.slice(0, expectedChapters);
    }

    // ── Structural validation + auto-repair ──────────────────────
    outline.chapters.forEach((chapter: ChapterOutline, idx: number) => {
      // Auto-repair missing sections array
      if (!chapter.sections || !Array.isArray(chapter.sections)) {
        this.logger.warn(
          `Chapter ${idx + 1} missing sections — inserting placeholder`,
        );
        chapter.sections = [
          {
            sectionTitle: chapter.chapterTitle || 'Overview',
            subsections: ['Introduction'],
          },
        ];
      }

      chapter.sections.forEach((section: any, secIdx: number) => {
        // Auto-repair missing or malformed subsections
        if (!section.subsections || !Array.isArray(section.subsections)) {
          if (
            typeof section.subsections === 'string' &&
            section.subsections.trim()
          ) {
            // Model returned a string instead of array — wrap it
            this.logger.warn(
              `Chapter ${idx + 1}, Section ${secIdx + 1} subsections is a string — wrapping in array`,
            );
            section.subsections = [section.subsections.trim()];
          } else {
            // Missing entirely — fall back to section title
            this.logger.warn(
              `Chapter ${idx + 1}, Section ${secIdx + 1} missing subsections — using section title as fallback`,
            );
            section.subsections = [section.sectionTitle || 'Overview'];
          }
        }

        // Filter out blank subsections (model sometimes emits "")
        section.subsections = section.subsections.filter(
          (s: any) => typeof s === 'string' && s.trim().length > 0,
        );

        // Still empty after filtering — use section title
        if (section.subsections.length === 0) {
          this.logger.warn(
            `Chapter ${idx + 1}, Section ${secIdx + 1} has no valid subsections after filtering — using section title as fallback`,
          );
          section.subsections = [section.sectionTitle || 'Overview'];
        }
      });
    });

    return outline;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS — JSON parse + repair
  // ═══════════════════════════════════════════════════════════════
  private tryParseJson(raw: string): any | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private extractLikelyJson(response: string): string {
    const withoutFences = response
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();
    const firstBrace = withoutFences.indexOf('{');
    const lastBrace = withoutFences.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return withoutFences.slice(firstBrace, lastBrace + 1).trim();
    }

    return withoutFences;
  }

  private containsOutlinePlaceholders(outline: any): boolean {
    const serialized = JSON.stringify(outline).toLowerCase();
    return /\b(omitted|as above|same as above|continue similarly|continued similarly|placeholder|proceeding accordingly|filling in chapters?|chapter \d+ would|would be complete|to be filled|todo|tbd)\b|\.\.\./i.test(
      serialized,
    );
  }

  private tryRepairJson(raw: string): any | null {
    try {
      // Remove trailing commas before ] or }
      let repaired = this.normalizeSingleQuotes(raw);

      repaired = repaired
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      repaired = repaired.replace(/,\s*([}\]])/g, '$1');

      // Close any unclosed strings (truncation mid-string)
      // Count unmatched quotes — if odd, the string was cut off; close it
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        repaired = repaired.trimEnd() + '"';
      }

      // Close unclosed arrays and objects by tracking the stack
      const stack: string[] = [];
      let inString = false;
      let escape = false;

      for (const ch of repaired) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (ch === '{' || ch === '[') stack.push(ch);
        if (ch === '}' || ch === ']') stack.pop();
      }

      // Close open structures in reverse order
      for (const open of [...stack].reverse()) {
        repaired += open === '{' ? '}' : ']';
      }

      const result = JSON.parse(repaired);
      this.logger.warn('JSON repair succeeded — response was truncated');
      return result;
    } catch {
      return null;
    }
  }

  // New helper to add
  private normalizeSingleQuotes(raw: string): string {
    // Replace single-quoted keys and values with double-quoted ones
    // Handles: 'key': 'value', 'key': ['val1', 'val2']
    // Does NOT touch apostrophes inside words (e.g., "don't", "Albania's")
    return (
      raw
        // Keys: 'word' followed by : → "word":
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, '"$1":')
        // Values: : 'value' or , 'value' or [ 'value'
        .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"')
        .replace(/,\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ', "$1"')
        .replace(/\[\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, '["$1"')
    );
  }

  private stripMetaCommentary(text: string): string {
    const metaPatterns = [
      /^here'?s?\s+(?:the\s+)?(?:revised|rewritten|updated|edited|final|complete)\s+chapter[^:\n]*:\s*/im,
      /^here\s+is\s+(?:the\s+)?(?:revised|rewritten|updated|edited|final|complete)\s+chapter[^:\n]*:\s*/im,
      /^(?:revised|rewritten|updated|edited|final)\s+chapter[^:\n]*:\s*/im,
      /^ready\s+for\s+publication[^:\n]*:\s*/im,
      /^here'?s?\s+the\s+introduction[^:\n]*:\s*/im,
      /^here'?s?\s+your[^:\n]*:\s*/im,
      /^the\s+following\s+is[^:\n]*:\s*/im,
    ];

    let result = text.trim();
    for (const pattern of metaPatterns) {
      result = result.replace(pattern, '').trim();
    }

    // Also strip a repeated chapter title if it appears as the very first line
    // before any real paragraph content (bold heading leak)
    result = result.replace(/^#{1,6}\s+.+\n+/m, '').trim();

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // INTRODUCTION — why this subject matters
  // ═══════════════════════════════════════════════════════════════
  async generateIntroduction(
    title: string,
    subtitle: string,
    outline: BookOutlineDto,
    brief: BookBrief,
  ): Promise<string> {
    const introChapter = outline.chapters.find((c) => c.chapterNumber === 1);

    if (!introChapter) {
      throw new Error('Introduction chapter not found in outline');
    }

    const result = await this.generateText(
      this.buildIntroPrompt(title, subtitle, introChapter, outline, brief),
      {
        refine: true,
        systemPrompt: this.getSystemPrompt(brief, title, subtitle),
        refinementContext: {
          bookTitle: title,
          bookSubtitle: subtitle,
          chapterTitle: introChapter.chapterTitle,
          chapterOutline: introChapter,
          brief,
        },
      },
    );

    return this.stripMetaCommentary(result);
  }

  private buildIntroPrompt(
    title: string,
    subtitle: string,
    introChapter: ChapterOutline,
    outline: BookOutlineDto,
    brief: BookBrief,
  ): string {
    const style = this.styleFor(brief, title, subtitle);

    return `Write the complete Introduction chapter for this narrative history book about ${brief.subject}:

Title: "${title}"
Subtitle: "${subtitle}"

${this.buildBookPromise(title, subtitle, brief)}
${this.buildHistoryQualityRules()}

Chapter Structure:
${JSON.stringify(introChapter, null, 2)}

The rest of the book (so you can set it up without repeating it):
${outline.chapters
  .slice(1)
  .map((c) => `- Chapter ${c.chapterNumber}: ${c.chapterTitle}`)
  .join('\n')}

STRUCTURE:
- Write 15-20 paragraphs covering all sections and subsections from the outline
- Vary paragraph length: some short (2 sentences), some longer (4-5 sentences)
- How to open: ${style.openingMove} Whatever you open on must be documented — not "Throughout history", not a birth date, not an invented scene
- This book's shape: ${style.architecture.intro}
- Raise the book's question (see BOOK CONTEXT) in your own words, early on. Don't answer it yet.
- Explain why this subject is worth understanding, what the book's angle is (from the title/subtitle), and whose lives it touched
- Include one short, honest paragraph on sources: this is an independent account built from published scholarship, primary sources and reliable reporting; where the evidence is thin or historians disagree, the text says so; and dates and numbers from the past are often approximate. Do not name specific sources unless the dossier names them. Do not claim any archive visits or private access.
- Stay in the third person. Do not describe the writer's own experience.
- Close with forward momentum into the next chapter, without a fake cliffhanger
- Do not summarize every chapter; set up the story instead

SENTENCE RHYTHM (critical for sounding human):
- Mix short sentences (4-8 words) with medium (12-18 words) and occasional long (20-25 words)
- Never start 3+ consecutive sentences the same way
- Use a fragment now and then where it lands well

VOICE EXAMPLE (invented — copy the rhythm and the way in, never the facts):
"""
${style.voiceExample}
"""

Write in plain English the complete Introduction chapter now.
Return ONLY the chapter text. Do NOT include any preamble, meta-commentary, or phrases like "Here's the revised chapter" or "Here's the introduction". Do NOT restate the chapter title as a heading at the start. Begin directly with the opening moment.`;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAPTER CONTENT — each book rotates through its own formats
  // ═══════════════════════════════════════════════════════════════
  async generateChapterContent(
    chapterOutline: ChapterOutline,
    bookTitle: string,
    bookSubtitle: string,
    brief: BookBrief,
    outline?: BookOutlineDto,
  ): Promise<string> {
    const format = formatForChapter(
      this.styleFor(brief, bookTitle, bookSubtitle),
      chapterOutline.chapterNumber,
    );
    this.logger.log(
      `Generating chapter ${chapterOutline.chapterNumber} with format: ${format.id}`,
    );

    return await this.generateText(
      this.buildChapterPrompt(
        chapterOutline,
        bookTitle,
        bookSubtitle,
        format.instructions,
        brief,
        outline,
      ),
      {
        refine: true,
        systemPrompt: this.getSystemPrompt(brief, bookTitle, bookSubtitle),
        refinementContext: {
          bookTitle,
          bookSubtitle,
          chapterTitle: chapterOutline.chapterTitle,
          chapterOutline,
          isMainChapter: true,
          brief,
        },
      },
    );
  }

  private buildChapterPrompt(
    chapterOutline: ChapterOutline,
    bookTitle: string,
    bookSubtitle: string,
    formatInstructions: string,
    brief: BookBrief,
    outline?: BookOutlineDto,
  ): string {
    const previous = outline?.chapters.find(
      (c) => c.chapterNumber === chapterOutline.chapterNumber - 1,
    );
    const next = outline?.chapters.find(
      (c) => c.chapterNumber === chapterOutline.chapterNumber + 1,
    );
    const placement =
      previous || next
        ? `
WHERE THIS CHAPTER SITS:
${previous ? `- Previous chapter: "${previous.chapterTitle}" (already written — pick up from where it ends, don't retell it)` : ''}
${next ? `- Next chapter: "${next.chapterTitle}" (don't cover its events here)` : ''}
`
        : '';

    return `Write Chapter ${chapterOutline.chapterNumber}: "${chapterOutline.chapterTitle}" for the narrative history book "${bookTitle}${bookSubtitle ? `: ${bookSubtitle}` : ''}" about ${brief.subject}, IN PLAIN ENGLISH.

${this.buildBookPromise(bookTitle, bookSubtitle, brief)}
${this.buildMainChapterDepthRules()}

Chapter Structure:
${JSON.stringify(chapterOutline, null, 2)}
${placement}
PURPOSE: This is narrative history. Every paragraph should move the story forward or help the reader understand the people, the place and the times.

${formatInstructions}

${this.getChapterSharedRules()}

Write in plain English the complete chapter now:`;
  }

  private getChapterSharedRules(): string {
    return `
${this.buildHistoryQualityRules()}

HISTORY CONTENT RULES (apply regardless of format):
- Every section needs: what happened, when, where, who was involved, how we know, and what came next
- Explain unfamiliar offices, customs, money, measures and technology in plain words so a newcomer understands why they mattered
- Include disputes, uncertainty and gaps in the evidence where documented; this book is neither a celebration nor a condemnation of anyone
- Keep ordinary people present as people, not as background or statistics
- Use attributed paraphrase for what people said or wrote; direct quotes only under the COPYRIGHT rules
- Tie the chapter back to the book's angle from the title/subtitle at least once
- Make time jumps explicit
- Use the section headings from the outline. The chapter should feel edited, coherent and ready to publish.
- The FACTUAL ACCURACY, FAIRNESS and COPYRIGHT rules in your instructions apply to every sentence.

WHAT TO AVOID:
- Don't list facts like a textbook or encyclopedia — tell what happened and why it mattered
- Don't moralize, and don't turn paragraphs into tributes or condemnations
- Don't foreshadow with clichés ("little did they know", "it was only the beginning") or end sections on fake cliffhangers
- Don't start more than two paragraphs in a row with the same person's name or "He"/"She"/"They"
- Don't summarize sections or telegraph what's coming next
- Don't end paragraphs with vague statements about destiny, greatness or the "march of history"
- Don't use difficult words when simple ones will do — "use" not "utilize", "fix" not "ameliorate"`;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONCLUSION — what it changed and how it is remembered, plus a timeline
  // ═══════════════════════════════════════════════════════════════
  async generateConclusion(
    title: string,
    subtitle: string,
    outline: BookOutlineDto,
    brief: BookBrief,
  ): Promise<string> {
    const conclusionChapter = outline.chapters.find(
      (c) => c.chapterNumber === outline.chapters.length,
    );

    if (!conclusionChapter) {
      throw new Error('Conclusion chapter not found in outline');
    }

    return await this.generateText(
      this.buildConclusionPrompt(title, subtitle, conclusionChapter, brief),
      {
        refine: true,
        systemPrompt: this.getSystemPrompt(brief, title, subtitle),
        refinementContext: {
          bookTitle: title,
          bookSubtitle: subtitle,
          chapterTitle: conclusionChapter.chapterTitle,
          chapterOutline: conclusionChapter,
          brief,
        },
      },
    );
  }

  private buildConclusionPrompt(
    title: string,
    subtitle: string,
    conclusionChapter: ChapterOutline,
    brief: BookBrief,
  ): string {
    const style = this.styleFor(brief, title, subtitle);

    return `Write in plain English the Conclusion chapter for this narrative history book about ${brief.subject}:

Title: "${title}"
Subtitle: "${subtitle}"

${this.buildBookPromise(title, subtitle, brief)}
${this.buildHistoryQualityRules()}

Chapter Structure:
${JSON.stringify(conclusionChapter, null, 2)}

PURPOSE: Step back from the timeline and weigh the story. What the evidence firmly establishes, what remains uncertain or debated, what changed because of these events, and how they have been remembered. This is an honest assessment, not a final verdict of your own.

STRUCTURE:
- 15-20 paragraphs of narrative covering all sections and subsections, then the TIMELINE reference below
- Open with a specific, documented image or fact that sums up the story — not "In conclusion", and not a grand statement about history
- This book's shape: ${style.architecture.conclusion}
- Answer the book's question (see BOOK CONTEXT) as far as the evidence allows, using what the chapters showed. If the evidence doesn't settle it, say so.
- How to close: ${style.closingMove}
- Cover lasting effects with concrete examples (a border, a law, an institution, a language, a building, a custom) rather than claims of importance
- Where historians still disagree, set out the main positions fairly and in your own words, without picking a side beyond what the evidence supports
- Be careful with links to the present: only claim a lasting effect the dossier or historians support, and never draw lessons about modern groups or politics
- If new discoveries or debates are recent, describe where things stand "as of this writing" without predicting what comes next
- Close the narrative with a short final paragraph (2-3 sentences) — clear-eyed, not sentimental

TIMELINE (after the narrative, under the heading "Timeline"):
- A simple list of 10-20 important events in time order, one per line, formatted "YEAR — event"
- Use "c." for approximate years and BCE/CE (or BC/AD, matching the rest of the book) where needed
- Only include events and years you are confident are documented; leave out anything uncertain rather than guessing
- Plain, neutral wording, with no violent detail
- Lists are allowed here; this is the reference section of the book

WHAT TO AVOID:
- Don't open with "In conclusion", "As we come to the end", "Looking back" or "Throughout history"
- Don't retell the book chapter by chapter
- Don't end with "the rest is history", "changed the world forever", "a lesson for us all" or similar stock lines
- Don't invent statistics, tributes, memorials, quotes or modern-day consequences
- Don't use difficult words when simple ones will do

Write the complete Conclusion chapter now:`;
  }

  // ═══════════════════════════════════════════════════════════════
  // ABOUT BOOK
  // ═══════════════════════════════════════════════════════════════
  async generateAboutBook(
    title: string,
    subtitle: string,
    brief: BookBrief,
  ): Promise<string> {
    const prompt = `Write an "About This Book" blurb for a narrative history book about ${brief.subject} titled "${title}"${subtitle ? ` with the subtitle "${subtitle}"` : ''}.

${this.buildBookPromise(title, subtitle, brief)}

Follow the FAIRNESS and COPYRIGHT rules from your instructions.

4-6 short paragraphs. NO generic phrases like "sweeping saga", "epic story", "you won't believe", "the definitive history" or "everything you need to know". NO grand claims about changing the world.

Instead, be specific about:
- The angle this book takes and the part of the story it gives the most weight to
- Who will get the most out of it (readers new to the subject? readers interested in daily life, politics, war, or how historians know things?)
- One honest limitation: this is an independent account drawn from published scholarship, primary sources and reliable reporting — it is not affiliated with any museum, archive or institution, doesn't claim original archival discoveries, and notes where the evidence is thin or historians disagree
- How it's organized (the story told in order, with a timeline at the end)

Do not invent quotes, sources, credentials or endorsements. Do not compare it to any other book, film, show or podcast.

Tone: confident, direct, respectful. Like a back-cover blurb written by the writer, not a marketer.`;

    return await this.generateText(prompt, {
      refine: false,
      systemPrompt: this.getSystemPrompt(brief, title, subtitle),
    });
  }
}
