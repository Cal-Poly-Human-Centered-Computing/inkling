import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {Pipelines} from './pipeline';
import type {ReviewVerdict} from './schemas';

// Dev-only request log (see EVAL_RECORD in app.ts). Each request gets a folder in the run directory
// with input.json, canvas.png (if there was a sketch) and result.json; index.html shows them all.

export type RequestKind = keyof Pipelines;

type Recorded = {
  name: string;
  input: Record<string, any>;
  result: { observations: string | null; spec: string | null; errors: string[]; review?: ReviewVerdict | null };
};

/**
 * Saves one request and its result, then rewrites the run's index.html.
 * `output` is the pipeline's return value: a raw string from the old pipelines, or {spec, observations, errors, review}.
 */
export async function recordRequest(runDir: string, label: string, kind: RequestKind, payload: Record<string, any>, output: unknown, error?: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const caseDir = path.join(runDir, `${timestamp}-${kind}`);
  await mkdir(caseDir, {recursive: true});

  const {image, ...input} = payload;
  await writeFile(path.join(caseDir, 'input.json'), JSON.stringify({kind, ...input}, null, 2));
  if (typeof image === 'string') {
    await writeFile(path.join(caseDir, 'canvas.png'), Buffer.from(image.split(',')[1] ?? '', 'base64'));
  }

  const out = output as any;
  const result = typeof out === 'string'
    ? {observations: null, spec: out, errors: [], review: null}
    : {
      observations: out?.observations ?? null,
      spec: out?.spec ?? null,
      errors: [...(out?.errors ?? []), ...(error ? [error] : [])],
      review: out?.review ?? null
    };
  await writeFile(path.join(caseDir, 'result.json'), JSON.stringify(result, null, 2));

  await writeReport(runDir, label);
}

async function writeReport(runDir: string, label: string) {
  const names = (await readdir(runDir, {withFileTypes: true}))
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const records: Recorded[] = [];
  for (const name of names) {
    const read = (file: string) => readFile(path.join(runDir, name, file), 'utf8').then(JSON.parse, () => null);
    const [input, result] = await Promise.all([read('input.json'), read('result.json')]);
    if (input && result) records.push({name, input, result});
  }

  await writeFile(path.join(runDir, 'index.html'), report(label, records));
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
}

function pretty(spec: string | null) {
  if (!spec) return '';
  try {
    return JSON.stringify(JSON.parse(spec), null, 2);
  } catch {
    return spec;
  }
}

function report(label: string, records: Recorded[]) {
  const rows = records.map(({name, input, result}) => {
    const columns = (input.columns ?? []).map((c: any) => `${c.name}: ${c.type}`).join('\n');
    const inputs = [
      input.chatMessage ? `<b>Chat:</b> ${escapeHtml(input.chatMessage)}` : '',
      input.currentSpec ? `<details><summary>Current spec</summary><pre>${escapeHtml(pretty(input.currentSpec))}</pre></details>` : '',
      columns ? `<details><summary>Columns</summary><pre>${escapeHtml(columns)}</pre></details>` : ''
    ].filter(Boolean).join('');
    const errors = result.errors.map(e => `<div class="err">${escapeHtml(e)}</div>`).join('');
    const review = result.review
      ? `<b>${result.review.matches ? 'Matches' : 'Mismatch'}</b>` +
        (result.review.issues.length ? `<ul>${result.review.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '')
      : '';

    return `<tr>
      <td><b>${escapeHtml(name)}</b></td>
      <td><img src="${name}/canvas.png" onerror="this.remove()">${inputs}</td>
      <td><pre>${escapeHtml(result.observations ?? '')}</pre></td>
      <td>${errors}<pre>${escapeHtml(pretty(result.spec))}</pre></td>
      <td>${review}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Requests: ${escapeHtml(label)}</title>
<style>
  body { font: 13px system-ui, sans-serif; margin: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; text-align: left; }
  img { max-width: 420px; border: 1px solid #eee; display: block; }
  pre { white-space: pre-wrap; max-height: 500px; overflow: auto; background: #f7f7f7; padding: 4px; margin: 4px 0; }
  .err { color: #b00; margin-bottom: 4px; }
</style></head><body>
<h2>Requests: ${escapeHtml(label)}</h2>
<table><tr><th>Request</th><th>Inputs</th><th>Observations</th><th>Resulting spec</th><th>Review</th></tr>${rows}</table>
</body></html>`;
}
