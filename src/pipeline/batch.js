import { buildChatRequestBody } from './process.js';
import { BATCH_COMPLETION_WINDOW } from '../lib/constants.js';

function toJsonlLine(article, allowedTopics) {
  return JSON.stringify({
    custom_id: article.id,
    method: 'POST',
    url: '/v1/chat/completions',
    body: buildChatRequestBody(article, allowedTopics),
  });
}

async function uploadBatchFile(env, jsonl) {
  const form = new FormData();
  form.set('purpose', 'batch');
  form.set('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

  const res = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI file upload failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function createBatch(env, inputFileId) {
  const res = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: '/v1/chat/completions',
      completion_window: BATCH_COMPLETION_WINDOW,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI batch creation failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Submits one batch job covering all given articles. Two subrequests total
// (file upload + batch create) regardless of how many articles are in it.
export async function submitBatch(env, articles, allowedTopics) {
  const jsonl = articles.map((a) => toJsonlLine(a, allowedTopics)).join('\n');
  const file = await uploadBatchFile(env, jsonl);
  const batch = await createBatch(env, file.id);
  return { batchId: batch.id, inputFileId: file.id, status: batch.status };
}

export async function getBatchStatus(env, batchId) {
  const res = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI batch status check failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function downloadFile(env, fileId) {
  const res = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI file download failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}

// Returns a Map<custom_id, { result, error }> parsed from a completed
// batch's output (and error, if any) files.
export async function downloadBatchResults(env, batch) {
  const results = new Map();

  if (batch.output_file_id) {
    const text = await downloadFile(env, batch.output_file_id);
    for (const line of text.split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      const content = row.response?.body?.choices?.[0]?.message?.content;
      const requestError = row.response?.status_code && row.response.status_code >= 400
        ? row.response.body
        : null;
      results.set(row.custom_id, {
        result: content ? JSON.parse(content) : null,
        error: row.error ?? requestError,
      });
    }
  }

  if (batch.error_file_id) {
    const text = await downloadFile(env, batch.error_file_id);
    for (const line of text.split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      results.set(row.custom_id, {
        result: null,
        error: row.error ?? row.response?.body ?? 'Unknown batch error',
      });
    }
  }

  return results;
}
