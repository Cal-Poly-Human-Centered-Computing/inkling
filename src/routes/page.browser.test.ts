import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import 'bulma/css/bulma.min.css';
import '../app.css';
import { code } from '$lib/stores/code';
import { getRows, setDataset } from '$lib/utils/datasetStore';
import { mockApplyChanges, mountPage } from '../test/pageHelpers';
import Page from './+page.svelte';

let restoreFetch: (() => void) | undefined;

/** A small valid point chart with inline data, used as the spec before Apply. */
const pointChart = JSON.stringify({
  data: {
    values: [
      { a: 1, b: 2 },
      { a: 2, b: 3 }
    ]
  },
  mark: 'point',
  encoding: {
    x: { field: 'a', type: 'quantitative' },
    y: { field: 'b', type: 'quantitative' }
  }
});

/** Applies a chat message with the server mocked to return `spec`, and waits for the spec to land. */
async function applyChat(screen: Awaited<ReturnType<typeof mountPage>>, spec: string) {
  restoreFetch?.();
  restoreFetch = mockApplyChanges({ ok: true, result: spec, errors: [] });
  await screen.getByLabelText('Text input').fill('start from this chart');
  await screen.getByRole('button', { name: 'Apply changes' }).click();
  await expect.poll(() => get(code), { timeout: 2500 }).toContain(JSON.parse(spec).mark);
}

/** Clicks the canvas with the textbox tool, which adds a textbox (a stand-in for any canvas input). */
async function addTextbox(screen: Awaited<ReturnType<typeof mountPage>>) {
  await screen.getByRole('button', { name: 'Textbox tool' }).click();
  await page
    .elementLocator(screen.container.querySelector('.upper-canvas')!)
    .click({ position: { x: 200, y: 300 } });
}

// Apply needs an attached dataset, so most tests start with one
beforeEach(() => {
  setDataset([{ a: 1, b: 2 }], ['a', 'b'], { url: 'https://example.com/points.csv' });
});

// `code` is a global store, `fetch` may be mocked and an attached dataset persists in localStorage, so reset all three
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  code.set('');
  localStorage.clear();
});

test('the page mounts with the editor, chat input and canvas', async () => {
  const screen = await render(Page);

  await expect.element(screen.getByLabelText('Text input')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Apply changes' })).toBeVisible();
  // Monaco and Fabric build their DOM asynchronously after mount
  await expect
    .poll(() => screen.container.querySelector('.monaco-editor'), { timeout: 10_000 })
    .not.toBeNull();
  await expect.poll(() => screen.container.querySelector('canvas')).not.toBeNull();
});

test('applying a chat message updates the spec and clears the chat', async () => {
  restoreFetch = mockApplyChanges({
    ok: true,
    result: JSON.stringify({ mark: 'bar' }),
    errors: []
  });
  const screen = await mountPage();
  const chat = screen.getByLabelText('Text input');

  await chat.fill('make it a bar chart');
  await screen.getByRole('button', { name: 'Apply changes' }).click();

  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"bar"');
  await expect.element(chat).toHaveValue('');
});

test('applying canvas input updates the spec and clears the canvas', async () => {
  restoreFetch = mockApplyChanges({
    ok: true,
    result: JSON.stringify({ mark: 'bar' }),
    errors: []
  });
  const screen = await mountPage();
  const apply = screen.getByRole('button', { name: 'Apply changes' });
  const lowerCanvas = screen.container.querySelector('canvas.lower-canvas')!;

  await expect.element(apply).toBeDisabled();
  await addTextbox(screen);
  await expect.element(apply).toBeEnabled();
  expect(lowerCanvas.classList.contains('is-active')).toBe(true);

  await apply.click();

  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"bar"');
  await expect.poll(() => lowerCanvas.classList.contains('is-active')).toBe(false);
});

test('the page is busy while a request is pending and usable again after', async () => {
  const { promise, resolve } = Promise.withResolvers<object>();
  restoreFetch = mockApplyChanges(promise);
  const screen = await mountPage();
  const chat = screen.getByLabelText('Text input');
  const apply = screen.getByRole('button', { name: 'Apply changes' });

  await chat.fill('make it a bar chart');
  await apply.click();
  await expect.element(chat).toBeDisabled();
  await expect.element(apply).toBeDisabled();

  resolve({ ok: true, result: JSON.stringify({ mark: 'bar' }), errors: [] });
  await expect.element(chat).toBeEnabled();
});

test('annotating after a previous Apply and applying again updates the spec and clears the annotations', async () => {
  const screen = await mountPage();
  const lowerCanvas = screen.container.querySelector('canvas.lower-canvas')!;
  await applyChat(screen, pointChart);

  restoreFetch?.();
  restoreFetch = mockApplyChanges({
    ok: true,
    result: JSON.stringify({ mark: 'bar' }),
    errors: []
  });
  await addTextbox(screen);
  expect(lowerCanvas.classList.contains('is-active')).toBe(true);
  await screen.getByRole('button', { name: 'Apply changes' }).click();

  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"bar"');
  await expect.poll(() => lowerCanvas.classList.contains('is-active')).toBe(false);
});

test('rolling back restores the spec and canvas from before Apply', async () => {
  const screen = await mountPage();
  const lowerCanvas = screen.container.querySelector('canvas.lower-canvas')!;
  await applyChat(screen, pointChart);

  restoreFetch?.();
  restoreFetch = mockApplyChanges({
    ok: true,
    result: JSON.stringify({ mark: 'bar' }),
    errors: []
  });
  await addTextbox(screen);
  await screen.getByRole('button', { name: 'Apply changes' }).click();
  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"bar"');
  await expect.poll(() => lowerCanvas.classList.contains('is-active')).toBe(false);

  await screen.getByRole('button', { name: 'Rollback' }).click();
  await screen.getByRole('dialog').getByRole('button', { name: 'Yes' }).click();

  await expect.poll(() => get(code)).toContain('"point"');
  await expect.poll(() => lowerCanvas.classList.contains('is-active')).toBe(true);
});

test('attaching a CSV file stores its rows and names it in the spec', async () => {
  const screen = await mountPage();

  await screen.getByRole('button', { name: 'Attach dataset' }).click();
  await screen.getByLabelText('Choose dataset source').selectOptions('file');
  await screen
    .getByLabelText('JSON/CSV file')
    .upload(new File(['a,b\n1,2\n2,3'], 'points.csv', { type: 'text/csv' }));
  await screen.getByRole('button', { name: 'Attach', exact: true }).click();

  await expect.poll(() => get(code)).toMatch(/"data":\s*\{\s*"name"/);
  expect(getRows()).toHaveLength(2);
});

test('the spec survives leaving the editor and coming back', async () => {
  const first = await mountPage();
  await applyChat(first, pointChart);
  first.unmount();
  code.set('');

  await mountPage();

  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"point"');
});

test('a restored spec gets the header of the dataset attached while away', async () => {
  const first = await mountPage();
  await applyChat(first, pointChart);
  first.unmount();
  setDataset([{ a: 1, b: 2 }], ['a', 'b'], { url: 'https://example.com/other.csv' });

  await mountPage();

  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"point"');
  expect(get(code)).toContain('https://example.com/other.csv');
});

test('when a dataset is attached, a link to should point to its preview', async () => {
  setDataset([{ a: 1, b: 2 }], ['a', 'b'], { url: 'https://example.com/other.csv' });
  const screen = await mountPage();

  await expect
    .poll(() => screen.container.querySelector('.dataset-link'), { timeout: 2500 })
    .toHaveTextContent('Peek at other.csv');
  await expect
    .poll(() => screen.getByText('Attach a different dataset'), { timeout: 2500 })
    .toBeDefined();
});

test("when no dataset is attached, there shouldn't be a preview link", async () => {
  localStorage.clear();
  const screen = await mountPage();

  const datasetLink = screen.container.querySelector('.dataset-link');

  expect(datasetLink).toBeNull();
  await expect.poll(() => screen.getByText('Attach a dataset'), { timeout: 2500 }).toBeDefined();
});

test('Apply stays disabled until a dataset is attached', async () => {
  localStorage.clear();
  const screen = await mountPage();
  const apply = screen.getByRole('button', { name: 'Apply changes' });

  await screen.getByLabelText('Text input').fill('make it a bar chart');
  await expect.element(apply).toBeDisabled();

  await screen.getByRole('button', { name: 'Attach dataset' }).click();
  await screen.getByLabelText('Choose dataset source').selectOptions('file');
  await screen
    .getByLabelText('JSON/CSV file')
    .upload(new File(['a,b\n1,2'], 'points.csv', { type: 'text/csv' }));
  await screen.getByRole('button', { name: 'Attach', exact: true }).click();

  await expect.element(apply).toBeEnabled();
});

test('canvas marks survive leaving the editor and coming back', async () => {
  const first = await mountPage();
  await addTextbox(first);
  first.unmount();

  const screen = await mountPage();

  // marks on the canvas mark it active and enable Apply, with nothing typed in the chat
  await expect
    .poll(() =>
      screen.container.querySelector('canvas.lower-canvas')?.classList.contains('is-active')
    )
    .toBe(true);
  await expect.element(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
});

test('applied canvas marks are not restored after leaving the editor', async () => {
  restoreFetch = mockApplyChanges({
    ok: true,
    result: JSON.stringify({ mark: 'bar' }),
    errors: []
  });
  const first = await mountPage();
  await addTextbox(first);
  await first.getByRole('button', { name: 'Apply changes' }).click();
  await expect.poll(() => get(code), { timeout: 2500 }).toContain('"bar"');
  // the canvas is cleared just after the spec updates
  await expect
    .poll(() =>
      first.container.querySelector('canvas.lower-canvas')?.classList.contains('is-active')
    )
    .toBe(false);
  first.unmount();

  const screen = await mountPage();

  await expect.element(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  expect(
    screen.container.querySelector('canvas.lower-canvas')?.classList.contains('is-active')
  ).toBe(false);
});
