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
Article language: ${language}
Article title: ${titleOrig}
Article body: ${bodySnippet}`;
}

// Single GPT-4.4-mini call per article. Branches on source language internally
// via the prompt (spec §5.3) — same endpoint, same parsing.
export async function processArticle(env, { language, titleOrig, body }, allowedTopics) {
  const bodySnippet = (body ?? '').replace(/<[^>]+>/g, ' ').slice(0, 500);
  const prompt = buildPrompt({ language, titleOrig, bodySnippet, allowedTopics });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI chat completion failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(raw);
}
