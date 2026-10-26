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

// `code` is a global store and mounted boxes stay in the document, so reset both
afterEach(() => {
	code.set('');
	document.body.replaceChildren();
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
