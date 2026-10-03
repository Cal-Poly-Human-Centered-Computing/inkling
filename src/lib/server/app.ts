import {CLAUDE_API_KEY, ANTHROPIC_WORKSPACE_ID, CLAUDE_MODEL} from '$env/static/private';
import {env} from '$env/dynamic/private';
import {dev} from '$app/environment';
import path from 'node:path';
import {createLLM} from './prompting';
import {createPipelines, type Pipelines} from './pipeline';
import {recordRequest, type RequestKind} from './record';

// The only module that reads SvelteKit env vars: it binds the pipelines to the app's LLM client.

if (!CLAUDE_API_KEY) {
  throw new Error('Claude API key not configured. Set CLAUDE_API_KEY in your private environment.');
}

const pipelines = createPipelines(createLLM({
  apiKey: CLAUDE_API_KEY,
  workspaceId: ANTHROPIC_WORKSPACE_ID,
  model: CLAUDE_MODEL
}));

// Dev only: with EVAL_RECORD=<label>, every request's inputs, observations and resulting spec are saved
// to eval/runs/<timestamp>-<label>/, and that folder's index.html is rewritten after each one.
const recordLabel = dev ? env.EVAL_RECORD : undefined;

function recording<K extends RequestKind>(kind: K): Pipelines[K] {
  const run = pipelines[kind] as (payload: any) => Promise<unknown>;

  return (async (payload: Record<string, any>) => {
    // Kept on globalThis so a server module reload doesn't split one dev session across run folders
    const g = globalThis as { evalRunDir?: string };
    g.evalRunDir ??= path.join('eval/runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${recordLabel}`);

    let output: unknown = null;
    let error: string | undefined;
    try {
      output = await run(payload);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Recording is best-effort and must never break a request
    await recordRequest(g.evalRunDir, recordLabel!, kind, payload, output, error)
      .catch(err => console.warn('[record] failed to save request:', err));

    if (error !== undefined) throw new Error(error);
    return output;
  }) as Pipelines[K];
}

export const {fromScratch, refine} = recordLabel
  ? {
    fromScratch: recording('fromScratch'),
    refine: recording('refine')
  }
  : pipelines;
