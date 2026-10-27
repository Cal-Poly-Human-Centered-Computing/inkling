import { vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import 'bulma/css/bulma.min.css';
import '../app.css';
import Page from '../routes/+page.svelte';

/** Mounts the page and waits for Monaco and Fabric, which build their DOM after mount. */
export async function mountPage() {
  const screen = await render(Page);
  await vi.waitFor(
    () => {
      if (
        !screen.container.querySelector('.monaco-editor') ||
        !screen.container.querySelector('canvas')
      ) {
        throw new Error('editor or canvas not ready');
      }
    },
    { timeout: 10_000 }
  );
  return screen;
}

/** Answers POST /api/apply-changes with `response` (or a promise of one, to hold the request open) and passes other requests through. Call the returned function to restore `fetch`. */
export function mockApplyChanges(response: object | Response | Promise<object | Response>) {
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/api/apply-changes')) return realFetch(input, init);
    return Promise.resolve(response).then((r) => (r instanceof Response ? r : Response.json(r)));
  };
  return () => {
    window.fetch = realFetch;
  };
}
