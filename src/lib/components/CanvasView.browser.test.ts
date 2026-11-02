import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import 'bulma/css/bulma.min.css';
import '../../app.css';
import { code } from '$lib/stores/code';
import CanvasView from './CanvasView.svelte';

/** A small valid bar chart spec with inline data. */
const barChart = JSON.stringify({
  data: {
    values: [
      { a: 'A', b: 1 },
      { a: 'B', b: 3 },
      { a: 'C', b: 2 }
    ]
  },
  mark: 'bar',
  encoding: {
    x: { field: 'a', type: 'nominal' },
    y: { field: 'b', type: 'quantitative' }
  }
});

// `code` is a global store, mounted boxes stay in the document and the canvas saves its marks to localStorage (and
// restores them on mount), so reset all three
afterEach(() => {
  code.set('');
  document.body.replaceChildren();
  localStorage.clear();
});

/** Mounts CanvasView in an 800×600 box; the canvas sizes itself from its container. */
async function mountCanvasView() {
  const box = document.createElement('div');
  // a grid stretches the mounted component to fill the box
  box.style.cssText = 'display: grid; width: 800px; height: 600px;';
  document.body.append(box);
  return render(CanvasView, {}, { baseElement: box });
}

test('with the textbox tool, a click while holding space adds no textbox', async () => {
  const screen = await mountCanvasView();
  await screen.getByRole('button', { name: 'Textbox tool' }).click();
  const canvas = page.elementLocator(screen.container.querySelector('.upper-canvas')!);
  const belowToolbar = { position: { x: 400, y: 400 } };

  await userEvent.keyboard('[Space>]');
  await canvas.click(belowToolbar);
  await userEvent.keyboard('[/Space]');
  expect(screen.component.hasCanvasObjects()).toBe(false);

  // the same click without space adds one, so the check above could have failed
  await canvas.click(belowToolbar);
  expect(screen.component.hasCanvasObjects()).toBe(true);
});

test('a valid spec renders a chart', async () => {
  const screen = await mountCanvasView();

  code.set(barChart);
  await expect.poll(() => screen.component.renderedVisPresent(), { timeout: 5000 }).toBe(true);
});

type Screen = Awaited<ReturnType<typeof mountCanvasView>>;
type Point = { x: number; y: number };

/** Locator for the canvas layer that receives mouse input. */
function drawingCanvas(screen: Screen) {
  return page.elementLocator(screen.container.querySelector('.upper-canvas')!);
}

/** Zooms in twice with the zoom buttons, then pans with the hand tool, so screen and scene coordinates differ. */
async function zoomAndPan(screen: Screen) {
  await screen.getByRole('button', { name: 'Zoom in' }).click();
  await screen.getByRole('button', { name: 'Zoom in' }).click();
  await screen.getByRole('button', { name: 'Hand tool' }).click();
  const canvas = drawingCanvas(screen);
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 500, y: 450 },
    targetPosition: { x: 380, y: 360 }
  });
}

/** Draws a pen stroke between two points on the canvas with a real mouse drag. */
async function drawStroke(screen: Screen, from: Point, to: Point) {
  await screen.getByRole('button', { name: 'Pen tool' }).click();
  const canvas = drawingCanvas(screen);
  await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: from, targetPosition: to });
}

/** Whether `point` lies inside the only object's on-screen box, allowing a few pixels for padding and stroke width. */
function onlyObjectCovers(screen: Screen, ...points: Point[]) {
  const bounds = screen.component.canvasObjectScreenBounds();
  if (bounds.length !== 1) return false;
  const [box] = bounds;
  const slack = 12;
  return points.every(
    (p) =>
      p.x >= box.left - slack &&
      p.x <= box.right + slack &&
      p.y >= box.top - slack &&
      p.y <= box.bottom + slack
  );
}

test.each([
  { view: 'unzoomed', prepare: async () => {} },
  { view: 'zoomed and panned', prepare: zoomAndPan }
])('a textbox appears where you click ($view)', async ({ prepare }) => {
  const screen = await mountCanvasView();
  await prepare(screen);
  const clickAt = { x: 300, y: 350 };

  await screen.getByRole('button', { name: 'Textbox tool' }).click();
  await drawingCanvas(screen).click({ position: clickAt });

  expect(onlyObjectCovers(screen, clickAt)).toBe(true);
});

test.each([
  { view: 'unzoomed', prepare: async () => {} },
  { view: 'zoomed and panned', prepare: zoomAndPan }
])('a pen stroke appears where you draw ($view)', async ({ prepare }) => {
  const screen = await mountCanvasView();
  await prepare(screen);
  const from = { x: 250, y: 300 };
  const to = { x: 450, y: 400 };

  await drawStroke(screen, from, to);

  expect(onlyObjectCovers(screen, from, to)).toBe(true);
});

test('the click that dismisses the colour picker does not draw', async () => {
  const screen = await mountCanvasView();
  const from = { x: 250, y: 300 };
  const to = { x: 450, y: 400 };

  await screen.getByLabelText('Brush color').click();
  await drawStroke(screen, from, to);
  expect(screen.component.hasCanvasObjects()).toBe(false);

  // the same stroke afterwards draws, so the check above could have failed
  await drawStroke(screen, from, to);
  expect(screen.component.hasCanvasObjects()).toBe(true);
});
