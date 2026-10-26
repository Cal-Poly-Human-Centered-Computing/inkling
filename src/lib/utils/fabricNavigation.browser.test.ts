import { afterEach, expect, test } from 'vitest';
import { Canvas, Point, util } from 'fabric';
import { installFabricNavigation, type FabricNavigationController } from './fabricNavigation';

let canvas: Canvas;
let navigation: FabricNavigationController;

/** Creates a 400×300 Fabric canvas in the document with navigation installed. */
function setUp(options: Parameters<typeof installFabricNavigation>[1] = {}) {
	const element = document.createElement('canvas');
	document.body.append(element);
	canvas = new Canvas(element, { width: 400, height: 300 });
	// browsers refuse to capture the made-up pointers of dispatched events; capture isn't under test
	canvas.upperCanvasEl.setPointerCapture = () => {};
	navigation = installFabricNavigation(canvas, options);
}

/** Presses or releases space with keyboard focus on `target`. */
function space(type: 'keydown' | 'keyup', target: Element = document.body) {
	target.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
}

afterEach(() => {
	navigation.dispose();
	canvas.dispose();
	document.body.replaceChildren();
});

/** The scene point currently shown at a point on the canvas element. */
function sceneAt(viewportPoint: Point) {
	return viewportPoint.transform(util.invertTransform(canvas.viewportTransform));
}

test('ctrl+wheel zooms in about the cursor, keeping the point under it fixed', () => {
	setUp();
	const p = new Point(100, 80);
	const before = sceneAt(p);

	const rect = canvas.upperCanvasEl.getBoundingClientRect();
	canvas.upperCanvasEl.dispatchEvent(new WheelEvent('wheel', {
		clientX: rect.left + p.x,
		clientY: rect.top + p.y,
		deltaY: -10,
		ctrlKey: true,
		bubbles: true,
		cancelable: true
	}));

	expect(canvas.getZoom()).toBeGreaterThan(1);
	const after = sceneAt(p);
	expect(after.x).toBeCloseTo(before.x);
	expect(after.y).toBeCloseTo(before.y);
});

/** Dispatches a pointer event on the canvas at a point given in canvas-element coordinates. */
function pointer(type: string, at: Point) {
	const rect = canvas.upperCanvasEl.getBoundingClientRect();
	canvas.upperCanvasEl.dispatchEvent(new PointerEvent(type, {
		clientX: rect.left + at.x,
		clientY: rect.top + at.y,
		button: 0,
		buttons: type === 'pointerup' ? 0 : 1,
		pointerId: 1,
		pointerType: 'mouse',
		bubbles: true,
		cancelable: true
	}));
}

test('space+drag pans the view with the cursor and restores the pen', () => {
	setUp();
	canvas.isDrawingMode = true;
	const start = new Point(100, 80);
	const end = new Point(160, 120);
	const grabbed = sceneAt(start);

	space('keydown');
	pointer('pointerdown', start);
	pointer('pointermove', end);
	pointer('pointerup', end);
	space('keyup');

	const underCursor = sceneAt(end);
	expect(underCursor.x).toBeCloseTo(grabbed.x);
	expect(underCursor.y).toBeCloseTo(grabbed.y);
	expect(canvas.isDrawingMode).toBe(true);
});

test('holding space is a temporary hand tool, except while typing in the code editor', () => {
	const changes: boolean[] = [];
	setUp({ onSpaceHandChange: (active) => changes.push(active) });

	space('keydown');
	space('keyup');
	expect(changes).toEqual([true, false]);

	// the key-up never arrives if the window loses focus while space is held
	space('keydown');
	window.dispatchEvent(new Event('blur'));
	expect(changes).toEqual([true, false, true, false]);

	const editor = document.createElement('div');
	editor.className = 'monaco-editor';
	const line = editor.appendChild(document.createElement('div'));
	document.body.append(editor);
	space('keydown', line);
	space('keyup', line);
	expect(changes).toEqual([true, false, true, false]);
});
