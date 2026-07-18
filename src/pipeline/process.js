import { OPENAI_CHAT_MODEL } from '../lib/constants.js';

const SYSTEM_PROMPT =
  'You are a geopolitical intelligence analyst. Respond ONLY with valid JSON. ' +
  'No markdown, no explanation, no code fences.';

const IMPORTANCE_SCALE = `Importance scale:
1-2: Local/minor interest
3-4: National significance
5-6: Regional significance
7-8: Multi-regional impact
9-10: Global geopolitical event`;

function buildPrompt({ language, titleOrig, bodySnippet, allowedTopics }) {
  const topicsList = allowedTopics.join(', ');

  if (language === 'en') {
    return `Analyse the following English news article and return a JSON object with exactly these fields:
{
  "title_en":         string,   // English headline
  "summary_en":       string,   // 100-150 word English summary
  "synopsis_gr":      null,     // always null for English-source articles
  "topics":           string[], // from allowed list injected below
  "entities": {
    "people":         string[],
    "orgs":           string[],
    "locations":      string[]
  },
  "subject_location": string | null,
  "importance":       number,   // 1-10 (see scale below)
  "greece_related":   boolean
}

${IMPORTANCE_SCALE}

Allowed topics: ${topicsList}
Article title: ${titleOrig}
Article body: ${bodySnippet}`;
  }

  return `Analyse the following news article (written in ${language}) and return a JSON object
with exactly these fields:
{
  "title_en":         string,   // English headline (translated)
  "summary_en":       null,     // always null for non-English-source articles
  "synopsis_gr":      string,   // 80-100 word Greek summary (translate + summarise in one step)
  "topics":           string[], // from allowed list injected below
  "entities": {
    // Give every name in its most common English form (e.g. "US", not
    // its ${language} transliteration) — these feed a cross-article
    // keyword index shared with English-source articles, so names must
    // be in a common language to link up rather than fragmenting by
    // source language or script.
    "people":         string[],
    "orgs":           string[],
    "locations":      string[]
  },
  "subject_location": string | null, // also in English, same reason as entities above
  "importance":       number,   // 1-10 (see scale below)
  "greece_related":   boolean
}

${IMPORTANCE_SCALE}

Allowed topics: ${topicsList}
Article language: ${language}
Article title: ${titleOrig}
Article body: ${bodySnippet}`;
}

// Builds the chat-completion request body for one article's GPT analysis
// (spec §5.3, branching on source language internally). Ingestion is not
// time-critical, so this is only ever submitted via the OpenAI Batch API
// (see pipeline/batch.js) rather than called as a live request — a live
// per-article fetch() is what blew through Cloudflare's per-invocation
// subrequest limit when a large RSS backlog landed in one cron tick.
export function buildChatRequestBody({ language, titleOrig, body }, allowedTopics) {
  const bodySnippet = (body ?? '').replace(/<[^>]+>/g, ' ').slice(0, 500);
  const prompt = buildPrompt({ language, titleOrig, bodySnippet, allowedTopics });

  return {
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };
}
