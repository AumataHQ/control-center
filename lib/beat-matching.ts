/**
 * Matching a beat against a piece of collected text.
 *
 * A beat is standing coverage: a technology, product, or theme you want to hear
 * about until you say otherwise. Two kinds, because the examples that motivate
 * the feature are two different matching problems and treating them as one does
 * both badly.
 *
 * An **entity** beat is a named thing — GrokBot, Buzz. The names are ordinary
 * words that will match constantly on nothing relevant, so a name alone is not
 * evidence. It needs corroboration: the item is on a domain the beat owns, or a
 * disambiguating anchor appears near the name.
 *
 * A **theme** beat is a subject — personal AI assistants, multi-agent
 * orchestration. No single literal string finds these reliably, so a theme
 * matches on a vocabulary: one of its phrases, or two of its anchors anywhere
 * in the text. Precision matters less here than recall, because a theme that
 * quietly under-reports gives no signal that it is doing so.
 *
 * Phrases are matched as token sequences with light suffix tolerance rather than
 * as raw substrings, so "multi-agent orchestration" also finds "multi agent
 * orchestrations". Anchors are single tokens matched anywhere. Neither uses a
 * real stemmer: the cost of a wrong stem is a false match on a standing beat,
 * which is noise you have to read every day.
 */

export type BeatKind = "entity" | "theme";
export type BeatTermKind = "phrase" | "anchor" | "negative" | "domain";
export type BeatConfidence = "high" | "medium" | "low";

export type BeatTerm = { kind: BeatTermKind; value: string };

export type BeatDefinition = {
  id: string;
  name: string;
  kind: BeatKind;
  terms: BeatTerm[];
};

export type BeatSubject = {
  title?: string;
  body?: string;
  url?: string;
};

export type BeatMatch = {
  beatId: string;
  confidence: BeatConfidence;
  /** The term that matched and the rule that accepted it, in plain words. */
  why: string;
  /** Text around the match, so a reader can judge it without opening the link. */
  evidence: string;
};

/** How much text either side of a match to keep as evidence. */
const EVIDENCE_WINDOW = 160;
/** How near an anchor must be to an entity's name to corroborate it. */
const ANCHOR_WINDOW_TOKENS = 40;

const WORD = /[a-z0-9]+/g;

type Token = { text: string; stem: string; start: number; end: number };

/**
 * A conservative stem: plurals and the two most common verb endings, and only
 * on words long enough that removing three letters leaves something meaningful.
 * "ing" off "ring" would leave "r".
 */
export function stem(word: string) {
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  const lowered = value.toLowerCase();
  for (const match of lowered.matchAll(WORD)) {
    const text = match[0];
    tokens.push({
      text,
      stem: stem(text),
      start: match.index ?? 0,
      end: (match.index ?? 0) + text.length,
    });
  }
  return tokens;
}

function excerpt(text: string, start: number, end: number) {
  const from = Math.max(0, start - EVIDENCE_WINDOW);
  const to = Math.min(text.length, end + EVIDENCE_WINDOW);
  const body = text.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}

/** Every position where a phrase's token sequence occurs. */
export function findPhrase(tokens: Token[], phrase: string): { from: number; to: number }[] {
  const wanted = tokenize(phrase);
  if (!wanted.length) return [];
  const hits: { from: number; to: number }[] = [];
  for (let index = 0; index + wanted.length <= tokens.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (tokens[index + offset].stem !== wanted[offset].stem) {
        matched = false;
        break;
      }
    }
    if (matched) hits.push({ from: index, to: index + wanted.length - 1 });
  }
  return hits;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ownsHost(host: string, domain: string) {
  const wanted = domain.toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "").split("/")[0];
  return !!host && !!wanted && (host === wanted || host.endsWith(`.${wanted}`));
}

/**
 * Whether a name is unambiguous enough to stand on its own.
 *
 * "Buzz" is an ordinary English word and needs corroboration. "GrokBot" is not
 * a word anyone writes by accident, and demanding an anchor for it would make
 * the beat miss the very articles it exists to catch.
 *
 * The signals are all about the shape of the written name: more than one word,
 * an internal capital, a digit, or word parts joined by a hyphen or underscore.
 * None of them occur in ordinary prose by accident, which is the property that
 * matters. Length alone is not a signal — "assistant" is long and useless.
 */
export function isDistinctivePhrase(phrase: string) {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  if (tokenize(trimmed).length > 1) return true;
  if (/\d/.test(trimmed)) return true;
  if (/[a-z][A-Z]/.test(trimmed)) return true;
  return /[a-z0-9][-_][a-z0-9]/i.test(trimmed);
}

function termsOf(beat: BeatDefinition, kind: BeatTermKind) {
  return beat.terms.filter((term) => term.kind === kind).map((term) => term.value).filter(Boolean);
}

/**
 * Match one beat against one item. Returns null when the beat does not apply,
 * which is the common case and must stay cheap.
 */
export function matchBeat(beat: BeatDefinition, subject: BeatSubject): BeatMatch | null {
  const text = [subject.title || "", subject.body || ""].filter(Boolean).join("\n\n");
  if (!text.trim() && !subject.url) return null;
  const tokens = tokenize(text);
  const host = hostOf(subject.url || "");

  const negatives = termsOf(beat, "negative");
  const anchors = termsOf(beat, "anchor");
  const phrases = termsOf(beat, "phrase");
  const domains = termsOf(beat, "domain");

  const anchorHits = new Map<string, { from: number; to: number }[]>();
  for (const anchor of anchors) {
    const hits = findPhrase(tokens, anchor);
    if (hits.length) anchorHits.set(anchor, hits);
  }

  const negativeHits = new Set<string>();
  for (const negative of negatives) {
    if (findPhrase(tokens, negative).length) negativeHits.add(negative);
  }

  const owned = domains.find((domain) => ownsHost(host, domain));

  if (beat.kind === "entity") {
    // A first-party domain is identity on its own: no name in the text can be
    // more certain than the publisher's own address.
    if (owned) {
      if (negativeHits.size)
        return null;
      return {
        beatId: beat.id,
        confidence: "high",
        why: `published on ${owned}, a domain this beat owns`,
        evidence: excerpt(text, 0, 0),
      };
    }
    for (const phrase of phrases) {
      for (const hit of findPhrase(tokens, phrase)) {
        const from = tokens[hit.from].start;
        const to = tokens[hit.to].end;
        // Negatives are judged near the match, not across the whole document: a
        // long page may mention an unrelated sense of the word paragraphs away.
        const nearbyNegative = negatives.find((negative) =>
          findPhrase(tokens, negative).some(
            (other) => Math.abs(other.from - hit.from) <= ANCHOR_WINDOW_TOKENS,
          ),
        );
        if (nearbyNegative) continue;
        const corroborating = [...anchorHits.entries()].find(([, hits]) =>
          hits.some((other) => Math.abs(other.from - hit.from) <= ANCHOR_WINDOW_TOKENS),
        );
        if (corroborating)
          return {
            beatId: beat.id,
            confidence: "high",
            why: `"${phrase}" near "${corroborating[0]}"`,
            evidence: excerpt(text, from, to),
          };
        if (isDistinctivePhrase(phrase))
          return {
            beatId: beat.id,
            confidence: "high",
            why: `"${phrase}", which is not a name anything else goes by`,
            evidence: excerpt(text, from, to),
          };
        return {
          beatId: beat.id,
          confidence: "low",
          why: `"${phrase}" with nothing to confirm it is the right one`,
          evidence: excerpt(text, from, to),
        };
      }
    }
    return null;
  }

  // Themes: aboutness rather than identity.
  if (negativeHits.size) return null;
  for (const phrase of phrases) {
    const [hit] = findPhrase(tokens, phrase);
    if (!hit) continue;
    return {
      beatId: beat.id,
      confidence: "high",
      why: `"${phrase}"`,
      evidence: excerpt(text, tokens[hit.from].start, tokens[hit.to].end),
    };
  }
  const distinct = [...anchorHits.keys()];
  if (distinct.length >= 2) {
    const first = anchorHits.get(distinct[0])![0];
    return {
      beatId: beat.id,
      confidence: distinct.length >= 3 ? "high" : "medium",
      why: `${distinct.length} of this beat's terms: ${distinct.slice(0, 4).join(", ")}`,
      evidence: excerpt(text, tokens[first.from].start, tokens[first.to].end),
    };
  }
  if (owned)
    return {
      beatId: beat.id,
      confidence: "medium",
      why: `published on ${owned}, a domain this beat follows`,
      evidence: excerpt(text, 0, 0),
    };
  return null;
}

/** Every active beat that matches, strongest first. */
export function matchBeats(beats: BeatDefinition[], subject: BeatSubject): BeatMatch[] {
  const order: Record<BeatConfidence, number> = { high: 0, medium: 1, low: 2 };
  return beats
    .flatMap((beat) => {
      const match = matchBeat(beat, subject);
      return match ? [match] : [];
    })
    .sort((a, b) => order[a.confidence] - order[b.confidence]);
}
