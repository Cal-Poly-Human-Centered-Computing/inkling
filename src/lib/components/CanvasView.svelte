<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { code } from "$lib/stores/code";
	import { isDark } from "$lib/stores/theme";
	import { plotTheme } from "$lib/utils/vegaTheme";
	import {CanvasToolbar, ZoomToolbar} from "$lib/components/index";
	import Fa from 'svelte-fa';
	import {faSpinner} from "@fortawesome/free-solid-svg-icons/faSpinner";
	import {Canvas, FabricImage, IText, PencilBrush} from 'fabric';
	import {installFabricNavigation, type FabricNavigationController} from '$lib/utils/fabricNavigation';
	import {flipInk} from '$lib/utils/ink';

	// Fabric.js canvas references
	let fabricCanvas: any = null;
	let fabricCanvasEl: HTMLCanvasElement | null = null;
	let boxEl: HTMLDivElement | null = null;
	let toolbarEl: HTMLDivElement | null = null;
	let fabricNavigation: FabricNavigationController | null = null;

	export let applying: boolean = false;

	// brush settings
	let brushColor: string;
	let brushWidth: number;

	// selected tool state
	let selectedTool: 'pen' | 'textbox' | 'selector' | 'hand' = 'pen';
	let zoomPercent = 100;

	// canvas background per theme; dark matches the vega-themes 'dark' background so there's no seam around the chart
	const LIGHT_BG = '#ffffff';
	const DARK_BG = '#333';

	// small SVG pen cursor (inline data URL) - use a solid/filled pen icon so the cursor appears filled.
	// Fallback to 'crosshair' if not supported.
	function penCursor(dark: boolean) {
		const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${dark ? 'white' : 'black'}" stroke="none"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`);
		return `url("data:image/svg+xml;utf8,${svg}") 3 20, auto`;
	}

	// theme the canvas was last configured for; null until mounted
	let appliedDark: boolean | null = null;

	let editingText: boolean = false;
	let objectSelected: boolean = false;

	// track each series of edits before/between changes applied
	export let historyStacks: Array<Array<string>> = [];
	let currentHistoryStack: Array<string> = [];
	// track where we are in currentHistoryStack
	export let historyIndex = -1;

	function handleSelectTool(e: CustomEvent) {
		selectedTool = e.detail;
		updateToolMode();
		fabricNavigation?.setHandMode(selectedTool === 'hand');
	}

	function handleZoom(e: CustomEvent<'in' | 'out'>) {
		if (e.detail === 'in') {
			fabricNavigation?.zoomIn();
		} else {
			fabricNavigation?.zoomOut();
		}
	}

	function deleteSelectedObject() {
		fabricCanvas.getActiveObjects().forEach((object: any) => {
			fabricCanvas.remove(object);
		})
		fabricCanvas.discardActiveObject();
		fabricCanvas.renderAll();

		objectSelected = false;

		snapshot();
	}

	function updateToolMode() {
		if (!fabricCanvas) return;
		if (selectedTool === 'pen') {
			fabricCanvas.isDrawingMode = true;
			if (fabricCanvas.freeDrawingBrush) {
				const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
				fabricCanvas.freeDrawingBrush.color = brushColor;
				fabricCanvas.freeDrawingBrush.width = brushWidth * ratio;
			}
			// show a pen-style cursor while in drawing mode. Use fabric.js cursor properties if available;
			fabricCanvas.freeDrawingCursor = penCursor($isDark);
			fabricCanvas.defaultCursor = penCursor($isDark);
			fabricCanvas.selection = false;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = false));
		} else if (selectedTool === 'selector') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.freeDrawingCursor = 'crosshair';
			fabricCanvas.defaultCursor = 'crosshair';
			fabricCanvas.selection = true;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = true));
		} else if (selectedTool === 'textbox') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.selection = false;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = true));
			try { fabricCanvas.defaultCursor = 'text'; } catch (err) {}
		} else if (selectedTool === 'hand') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.selection = false;
			fabricCanvas.defaultCursor = 'grab';
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = false));
		}
	}

// Keep brush properties in sync if user changes brush controls while mounted
$: if (fabricCanvas && fabricCanvas.freeDrawingBrush) {
 	const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
 	fabricCanvas.freeDrawingBrush.color = brushColor;
 	fabricCanvas.freeDrawingBrush.width = brushWidth * ratio;
}

	// the svg rendered by the vega-lite specs - is null if nothing is rendered
	// moving here so other components can tell whether the user is drawing from scratch or annotating a visualization
	export let baseSvg: SVGElement | null = null;

	// debounced rendering of the Vega-Lite spec (unused for now)
	let renderTimeout: ReturnType<typeof setTimeout> | null = null;
	const RENDER_DEBOUNCE_MS = 800; // 800 ms

	// cache serialized specs so we only schedule/render when the spec actually changes
	let lastScheduledSpecStr: string | null = null;
	let lastRenderedSpecStr: string | null = null;

	let backgroundImg: any = null;

	async function doRenderSpec() {
		// Render the Vega-Lite spec from the `code` store into an SVG,
		// then set that SVG as the Fabric canvas background so strokes/text
		// remain on top. Uses dynamic import of vega-embed to avoid SSR issues.
		if (typeof window === 'undefined' || !fabricCanvas) return;

		let specStr: string = $code;
		let specObj: any;
		try {
			specObj = JSON.parse(specStr);
		} catch (err) {
			// invalid JSON will throw errors if it's passed through vegaEmbed, so just pass an empty object
			// TODO: instead of just logging it, show the user the syntax error
			console.log(err);
			specObj = {};
		}

		try {
			// dynamic import to avoid bundling/SSR issues
			const embedModule = await import('vega-embed');
			const vegaEmbed = (embedModule && (embedModule.default || embedModule)) as any;

			// create an offscreen container for embed
			const off = document.createElement('div');
			// embed the spec as SVG
			// vega-embed merges this config under the spec's own `config`, so specs can still override it
			await vegaEmbed(off, specObj, { renderer: 'svg', actions: false, config: plotTheme($isDark) });

			const svgEl = off.querySelector('svg') as SVGElement | null;
			if (!svgEl) throw new Error('vega-embed produced no SVG element');

			baseSvg = svgEl;

			// Serialize SVG to a data URL
			const serializer = new XMLSerializer();
			let svgStr = serializer.serializeToString(svgEl);
			svgStr = svgStr.replace(/url\([^)#]*#/g, 'url(#');
			if (!svgStr.includes('xmlns')) svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
			if (!svgStr.includes('xmlns:xlink')) svgStr = svgStr.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
			const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);


			FabricImage.fromURL(svgDataUrl).then((img: any) => {
				const canvasW = fabricCanvas.getWidth();
				const toolbarHeight = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0;
				const canvasH = fabricCanvas.getHeight() - toolbarHeight;

				// anchor top-left and prevent interaction
				img.set({
					originX: 'center',
					originY: 'center',
					left: canvasW / 2,
					top: (canvasH / 2) + toolbarHeight,
				});

				if (img.width > canvasW) {
					console.log('scaling to width')
					img.scaleToWidth(canvasW)
				}
				if (img.height > canvasH && img.height > img.width) {
					console.log('scaling to height')
					img.scaleToHeight(canvasH)
				}

				fabricCanvas.backgroundImage = img;
				backgroundImg = img;

				fabricCanvas.requestRenderAll();
			});

		} catch (err) {
			console.error('doRenderSpec error', err);
			baseSvg = null;
			fabricCanvas.backgroundImage = null;
			fabricCanvas.requestRenderAll();
			throw err;
		}
	}

	function scheduleRender() {
		const toUse: any = $code as any;
		// serialize spec for cheap equality checks
		let s: string;
		try { s = typeof toUse === 'string' ? toUse : JSON.stringify(toUse); } catch (err) { s = String(toUse); }
		// if we've already scheduled the same spec, don't re-schedule
		if (lastScheduledSpecStr === s) return;
		lastScheduledSpecStr = s;

		if (renderTimeout) clearTimeout(renderTimeout);
		renderTimeout = setTimeout(() => {
			renderTimeout = null;
			// clear lastScheduled now that we're running
			lastScheduledSpecStr = null;
			doRenderSpec().then(() => {
				// mark this spec as rendered
				lastRenderedSpecStr = s;
			}).catch(() => {
				// on error we still clear the scheduled marker so user can retry edits
				lastRenderedSpecStr = null;
			});
		}, RENDER_DEBOUNCE_MS);
	}

	// reactively schedule a render only when the code store changes; do NOT read renderTimeout here
	$: if (typeof window !== 'undefined' && $code !== undefined) {
		const toSerialize: any = $code as any;
		try {
			const s = typeof toSerialize === 'string' ? toSerialize : JSON.stringify(toSerialize);
			if (lastRenderedSpecStr === s) {
				// already rendered; nothing to do
			} else {
				scheduleRender();
			}
		} catch (err) {
			scheduleRender();
		}
	}

	// invert near-black/near-white ("ink") strokes and text so they stay visible against the new background;
	// other colors are left alone
	function recolorInk() {
		for (const obj of fabricCanvas.getObjects()) {
			obj.set({ stroke: flipInk(obj.stroke), fill: flipInk(obj.fill) });
		}
		fabricCanvas.requestRenderAll();
	}

	// when the system theme flips, restyle the canvas and re-render the chart; the background image is swapped
	// and ink-colored strokes/text are inverted, other markup stays put. `appliedDark` is set first so this block
	// can't re-trigger itself.
	$: if (fabricCanvas && appliedDark !== null && appliedDark !== $isDark) {
		appliedDark = $isDark;
		fabricCanvas.backgroundColor = $isDark ? DARK_BG : LIGHT_BG;
		brushColor = flipInk(brushColor); // so new strokes use the new default; updateToolMode applies it to the brush
		recolorInk();
		updateToolMode();
		doRenderSpec().catch(() => {});
	}

	function snapshot() {
		const background = fabricCanvas.backgroundImage;

		fabricCanvas.backgroundImage = null;

		// record the theme the strokes were drawn under so restore() knows whether to recolor ink
		const snap = JSON.stringify({ ...fabricCanvas.toJSON(), dark: $isDark });
		// trim future redo history
		currentHistoryStack = currentHistoryStack.slice(0, historyIndex + 1);
		currentHistoryStack.push(snap);
		historyIndex = currentHistoryStack.length - 1;

		fabricCanvas.backgroundImage = background;
	}

	export function undo() {
		if (historyIndex <= 0) return;
		historyIndex--;
		restore(currentHistoryStack[historyIndex]);
	}

	export function redo() {
		if (historyIndex >= currentHistoryStack.length - 1) return;
		historyIndex++;
		restore(currentHistoryStack[historyIndex]);
	}

	function restore(snap: string) {
		try {
			fabricCanvas.clear();
			// restore canvas state
			fabricCanvas.loadFromJSON(snap).then(() => {
				if (backgroundImg) {
					// since this is only used for undo/redo which only affect canvas markup,
					// keep the rendered visualization the same
					backgroundImg.canvas = fabricCanvas;
					fabricCanvas.backgroundImage = backgroundImg;
				}
				// in case the user has switched between light and dark mode, keep the theme consistent
				fabricCanvas.backgroundColor = $isDark ? DARK_BG : LIGHT_BG;
				// ...and make sure ink drawn under the other theme stays visible
				if (JSON.parse(snap).dark !== $isDark) recolorInk();

				fabricCanvas.requestRenderAll()
			});
		} catch (err) {
			console.warn('failed to restore snapshot', err);
		}
	}

	function resize() {
		if (!fabricCanvasEl || !fabricCanvas) return;

		const container = boxEl || document.body;
		const rect = container.getBoundingClientRect();
		const ratio = window.devicePixelRatio || 1;
		try {
			fabricCanvas.setDimensions({ width: rect.width, height: rect.height });

			// Adjust brush to account for pixel ratio so stroke thickness is consistent visually
			if (fabricCanvas.freeDrawingBrush) {
				fabricCanvas.freeDrawingBrush.width = brushWidth * ratio;
			}

			if (typeof fabricCanvas.calcOffset === 'function') fabricCanvas.calcOffset();
			fabricCanvas.renderAll();
			// re-render background to match new canvas size
			try { doRenderSpec().catch(() => {}); } catch (err) {}
		} catch (err) {
			// ignore resize errors
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// ignore typing in inputs/textareas or contenteditable elements
		const target = e.target as HTMLElement | null;
		if (target) {
			const tag = target.tagName;
			const isEditable = target.getAttribute('contenteditable') === 'true';
			if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditable) return;
		}

		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (!fabricCanvas) return;

			let activeObjects = fabricCanvas.getActiveObjects();

			if (!activeObjects || activeObjects.length === 0) return;

			// Remove objects from canvas
			try {
				fabricCanvas.remove(...activeObjects);

				// discard selection and re-render
				fabricCanvas.discardActiveObject();

				// render update
				fabricCanvas.requestRenderAll();

				// record the change so undo/redo can pick it up (see notes below)
				snapshot();
			} catch (err) {
				console.error('Failed to delete selected objects', err);
			}
			objectSelected = false;
		}
	}

	// handle adding textboxes when the textbox tool is selected
	function createTextboxAt(x: number, y: number) {
		if (!fabricCanvas) return null;
		editingText = true;
		const id = 'text-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
		const itext: any = new IText('Text', {
			left: x,
			top: y,
			fontSize: 16,
			fill: $isDark ? '#ffffff' : '#000000',
			fontFamily: 'Arial',
			editable: true,
			selectable: true,
		});
		itext.on('editing:exited', function() {
			if (itext.text.trim() === '') {
				fabricCanvas.remove(itext);
			}
			console.log('User finished editing:', itext.text);
		});
		// attach a stable id so we can sync later
		(itext as any).__customId = id;
		fabricCanvas.add(itext);
		fabricCanvas.setActiveObject(itext);
		try {
			itext.enterEditing();
			itext.selectAll();
		} catch (err) { /* some Fabric builds may not support enterEditing immediately */ }
		fabricCanvas.requestRenderAll();
		snapshot();
		return itext;
	}

	function handleCanvasMouseDown(opt: any) {
		try {
			if (selectedTool !== 'textbox') return;

			if (editingText) {
				editingText = false;
				return;
			}

			// if clicking on an existing object, and it's text, enter editing
			if (opt.target) {
				const target = opt.target;
				if (target && (target.type === 'i-text' || target instanceof IText)) {
					fabricCanvas.setActiveObject(target);
					try { target.enterEditing(); target.selectAll(); } catch (err) {}
					return;
				}
			}
			const pointer = opt.viewportPoint;
			if (!pointer) return;
			createTextboxAt(pointer.x, pointer.y);
		} catch (err) {
			console.error('handleCanvasMouseDown error', err);
		}
	}

	function handleSelectionCreated(opt: any) {
		objectSelected = true;
	}

	function handleSelectionCleared(opt: any) {
		objectSelected = false;
	}

	onMount(async () => {
		if (!fabricCanvasEl) return;
		// create Fabric canvas
		fabricCanvas = new Canvas(fabricCanvasEl, {
			isDrawingMode: true,
			selection: false,
			backgroundColor: $isDark ? DARK_BG : LIGHT_BG,
			preserveObjectStacking: true
		});
		fabricNavigation = installFabricNavigation(fabricCanvas, {
			onZoomChange: (zoom) => {
				zoomPercent = zoom * 100;
			}
		});
		fabricNavigation?.setHandMode(selectedTool === 'hand');
		appliedDark = $isDark;

		try {
			// Some Fabric builds create a default freeDrawingBrush; create explicit PencilBrush
			if (!fabricCanvas.freeDrawingBrush || fabricCanvas.freeDrawingBrush.constructor.name !== 'PencilBrush') {
				fabricCanvas.freeDrawingBrush = new PencilBrush(fabricCanvas);
			}
			const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
			fabricCanvas.freeDrawingBrush.color = brushColor;
			fabricCanvas.freeDrawingBrush.width = brushWidth * ratio;
		} catch (err) {
			// if brush creation fails, ignore but drawing may not work
			console.warn('failed to initialize PencilBrush', err);
		}

			// Ensure the canvas cursor/tool mode matches the selected tool on mount
			updateToolMode();
		snapshot();

		// snapshot whenever something is added or changed
		fabricCanvas.on('object:modified', snapshot)
		fabricCanvas.on('path:created', snapshot);

		// wire up mouse handler
		fabricCanvas.on('mouse:down', handleCanvasMouseDown);

		fabricCanvas.on('selection:created', handleSelectionCreated)

		fabricCanvas.on('selection:cleared', handleSelectionCleared)

		// Call resize after layout settles; use multiple strategies to be robust
		tick().then(() => {
			resize();
		});

		// keep canvas sized on window resize
		window.addEventListener('resize', resize);
		// handle delete/backspace for deleting selected objects
		window.addEventListener('keydown', handleKeydown);

	});

	onDestroy(() => {
		// cleanup listeners and dispose fabric canvas
		try {
			fabricNavigation?.dispose();
			fabricNavigation = null;
			window.removeEventListener('resize', resize);
			window.removeEventListener('keydown', handleKeydown);
			if (fabricCanvas) {
				fabricCanvas.off && fabricCanvas.off('path:created');
				fabricCanvas.off && fabricCanvas.off('mouse:down');
				fabricCanvas.off && fabricCanvas.off('object:modified');
				fabricCanvas.off && fabricCanvas.off('object:removed');
				// dispose/remove canvas to avoid memory leaks (method name varies by Fabric version)
				if (typeof fabricCanvas.dispose === 'function') {
					fabricCanvas.dispose();
				} else if (typeof fabricCanvas.clear === 'function') {
					fabricCanvas.clear();
				}
			}
		} catch (err) { /* ignore cleanup errors */ }
		fabricCanvas = null;
	});

	function clearOverlays() {
		// remove all objects from the Fabric canvas
		const objs = (fabricCanvas.getObjects && fabricCanvas.getObjects()) ? fabricCanvas.getObjects().slice() : [];
		objs.forEach((o: any) => fabricCanvas.remove(o));
		fabricCanvas.requestRenderAll();
		snapshot()
	}

	export function applyChanges() {
		historyStacks = [...historyStacks, currentHistoryStack];
		// start a new stack working off of this state
		currentHistoryStack = [];
		historyIndex = -1
		clearOverlays();
		resetViewport();
	}

	function resetViewport() {
		if (!fabricCanvas) return;
		fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
		zoomPercent = 100;
		fabricCanvas.requestRenderAll();
	}

	export function rollbackChanges() {
		// get the last stack (or empty)
		const restoredHistoryStack = historyStacks.length > 0 ? historyStacks[historyStacks.length - 1] : [];
		// remove the last stack by reassigning a new array (triggers Svelte reactivity)
		historyStacks = historyStacks.slice(0, -1);

		let lastIndexBeforeChangesApplied = restoredHistoryStack.length - 1;
		if (lastIndexBeforeChangesApplied >= 0) {
			let snap = restoredHistoryStack[lastIndexBeforeChangesApplied];
			backgroundImg = JSON.parse(snap).backgroundImage;
		}
		restore(restoredHistoryStack[lastIndexBeforeChangesApplied]);
		historyIndex = lastIndexBeforeChangesApplied;
		currentHistoryStack = restoredHistoryStack;
	}

	export function hasCanvasObjects(): boolean {
		return !!fabricCanvas?.getObjects?.().length;
	}

	export function renderedVisPresent() {
		return !!baseSvg;
	}

	type ExportBounds = {
		top: number, left: number, width: number, height: number
	}

	function getExportBounds(): ExportBounds {
		const exportPadding = 24;

		const bounds = {
			left: Number.POSITIVE_INFINITY,
			top: Number.POSITIVE_INFINITY,
			right: Number.NEGATIVE_INFINITY,
			bottom: Number.NEGATIVE_INFINITY
		};

		const includeObjectBounds = (object: any) => {
			if (!object || object.visible === false || typeof object.getBoundingRect !== 'function') return;
			object.setCoords?.();
			const objectBounds = object.getBoundingRect();
			bounds.left = Math.min(bounds.left, objectBounds.left);
			bounds.top = Math.min(bounds.top, objectBounds.top);
			bounds.right = Math.max(bounds.right, objectBounds.left + objectBounds.width);
			bounds.bottom = Math.max(bounds.bottom, objectBounds.top + objectBounds.height);
		};

		// The visualization is stored as Fabric's background image; it uses scene
		// coordinates by default, so it remains part of the export regardless of
		// the current viewport transform.
		includeObjectBounds(fabricCanvas.backgroundImage);
		fabricCanvas.getObjects().forEach(includeObjectBounds);

		const left = Math.floor(bounds.left - exportPadding);
		const top = Math.floor(bounds.top - exportPadding);
		const right = Math.ceil(bounds.right + exportPadding);
		const bottom = Math.ceil(bounds.bottom + exportPadding);
		return {
			left,
			top,
			width: Math.max(1, right - left),
			height: Math.max(1, bottom - top)
		};
	}

	/**
	 * Export the current canvas (vega visualization + SVG overlays) to a base64 data URL.
	 * Commits any active text editing before export so the SVG overlay contains the current text.
	 *
	 * @param mime MIME type for export (default: 'image/png')
	 * @param quality quality for lossy formats (JPEG) (optional)
	 * @param scale pixel scale multiplier (default: window.devicePixelRatio || 1)
	 * @returns Promise<string> that resolves to a data URL (e.g. 'data:image/png;base64,...')
	 * @throws Error when export fails (including canvas taint due to cross-origin content)
	 */
	export async function exportCanvasDataUrl(mime: string = 'image/png', quality?: number, scale?: number): Promise<string> {
		if (!fabricCanvas) throw new Error('exportCanvasDataUrl: no fabric canvas available to export');

		const format = (mime.split('/')[1] || 'png');
		const multiplier = scale ?? (window.devicePixelRatio || 1);
		const exportBounds: ExportBounds = getExportBounds();

		// Ensure any active object selection is discarded so objects render in final state
		try { fabricCanvas.discardActiveObject(); } catch (e) {}

		// Render and export
		try {
			// Fabric's export helper preserves the current zoom when rendering.
			// Normalize the viewport first so scene-space bounds are rendered at
			// one-to-one scale regardless of the user's current navigation state.
			const originalViewportTransform = [...fabricCanvas.viewportTransform];
			fabricCanvas.setViewportTransform([
				1,
				0,
				0,
				1,
				-exportBounds.left,
				-exportBounds.top
			]);

			try {
				fabricCanvas.requestRenderAll();
				return fabricCanvas.toDataURL({
					format,
					multiplier,
					quality,
					left: 0,
					top: 0,
					width: exportBounds.width,
					height: exportBounds.height
				});
			} finally {
				fabricCanvas.setViewportTransform(originalViewportTransform);
				fabricCanvas.requestRenderAll();
			}
		} catch (err) {
			// Provide a helpful error when canvas is tainted due to cross-origin resources
			const msg = String(err || 'unknown error');
			if (/taint|security|cross-origin|domexception/i.test(msg)) {
				throw new Error('exportCanvasDataUrl: export failed due to cross-origin-tainted canvas. Ensure all images/resources are served with CORS headers or are inlined. Original error: ' + msg);
			}
			throw new Error('exportCanvasDataUrl: failed to export - ' + msg);
		}
	}

</script>

<div class="canvas-container" bind:this={boxEl}>

	<div bind:this={toolbarEl} style="position:absolute; left:0; right:0; top:0; display:flex; justify-content:center; pointer-events:auto; width: 100%; padding: 10px 10px 0 10px; z-index:10000;">
		<CanvasToolbar selected={selectedTool} bind:brushColor={brushColor} bind:brushWidth={brushWidth} enableDelete={objectSelected}
					   on:selectTool={handleSelectTool} on:delete={deleteSelectedObject}
					   on:undo={undo} on:redo={redo}
					   disableUndo={historyIndex == 0}
					   disableRedo={currentHistoryStack.length <= historyIndex + 1} />
	</div>

	<div class="zoom-toolbar-container">
		<ZoomToolbar zoomPercent={zoomPercent} on:zoom={handleZoom} />
	</div>

	<!-- Fabric.js canvas with the rendered vis as the background -->
	<canvas bind:this={fabricCanvasEl} class:is-active={hasCanvasObjects()}>
	</canvas>

	{#if applying}
		<div class="applying-overlay" aria-live="polite" aria-busy="true">
			<div class="applying-status">
				<Fa icon={faSpinner} spin />
				<span>Applying changes, please wait...</span>
			</div>
		</div>
	{/if}

</div>

<style>
	/* Ensure common modal/dialog selectors sit above the canvas and overlays in all themes
   Force a very high z-index so third-party modals (Bootstrap, Bulma, native dialog, etc.)
   will render above the canvas */
	:global(dialog[open]), :global(.modal), :global([role="dialog"]), :global(.modal-backdrop) {
		z-index: 100000 !important;
	}

	.canvas-container {
		height: 100%;
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0;
		margin: 0;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
		border-radius: var(--bulma-radius-medium);
	}

	.zoom-toolbar-container {
		position: absolute;
		right: 12px;
		bottom: 12px;
		z-index: 10000;
		pointer-events: auto;
	}

	canvas {
		position:absolute;
		left:0;
		top:0;
		right:0;
		bottom:0;
		width:100%;
		height:100%;
		touch-action:none;
		z-index:30;
		border-radius: var(--bulma-radius-medium);
		border: 1px solid var(--bulma-border);
		transition: box-shadow 200ms ease, border-color 200ms ease;
	}

	.applying-overlay {
		position: absolute;
		left: 0;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--color-float-bg) 80%, transparent);
		pointer-events: all;
		border-radius: var(--bulma-radius-medium);
		z-index: 1000;
	}

	.applying-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		color: var(--color-float-text);
		font-size: 16px;
		font-weight: 500;
		text-align: center;
	}

	canvas.is-active {
		border-color: var(--color-apply-changes-dark);
		box-shadow:
				0 0 0 1px var(--color-apply-changes-dark),
				0 2px 4px 1px color-mix(in srgb, var(--color-apply-changes-dark) 45%, transparent),
				0 6px 12px 3px color-mix(in srgb, var(--color-apply-changes-light) 45%, transparent);
	}
</style>
