<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import {get, writable} from 'svelte/store';
	import { code } from "$lib/stores/code";
	import {CanvasToolbar} from "$lib/components/index";
	import Fa from 'svelte-fa';
	import {faSpinner} from "@fortawesome/free-solid-svg-icons/faSpinner";
	import {Canvas, IText, PencilBrush} from 'fabric';

	// Fabric.js canvas references
	let fabricCanvas: any = null;
	let fabricCanvasEl: HTMLCanvasElement | null = null;
	let boxEl: HTMLDivElement | null = null;

	export let applying: boolean = false;

	// brush settings
	let brushColor: string;
	let brushWidth: number;

	// selected tool state
	let selectedTool: 'pen' | 'textbox' | 'selector' | 'eraser' = 'pen';

	let editingText: boolean = false;

	function handleSelectTool(e: CustomEvent) {
		selectedTool = e.detail;
		updateToolMode();
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
			fabricCanvas.selection = false;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = false));
		} else if (selectedTool === 'selector') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.selection = true;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = true));
		} else if (selectedTool === 'textbox') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.selection = false;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = true));
			try { fabricCanvas.defaultCursor = 'text'; } catch (err) {}
		} else if (selectedTool === 'eraser') {
			fabricCanvas.isDrawingMode = false;
			fabricCanvas.selection = false;
			fabricCanvas.getObjects().forEach((o: any) => (o.selectable = true));
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

	async function doRenderSpec() {
		// Vega rendering is currently disabled — CanvasView is using Fabric.js only.
		return;
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

	const strokes = writable<Array<Array<{x:number,y:number}>>>([]);
	const texts = writable<Array<{id:string,x:number,y:number,text:string,width?:number,height?:number,fontSize?:string,fontFamily?:string,fontWeight?:string,fontStyle?:string}>>([]);

	// track each series of edits before/between changes applied
	export let historyStacks: Array<Array<string>> = [];
	let currentHistoryStack: Array<string> = [];
	// track where we are in currentHistoryStack
	export let historyIndex = -1;

	function snapshot() {
		// serialize strokes and texts
		let s: any[] = [];
		strokes.subscribe(v => s = v)();
		let t: any[] = [];
		texts.subscribe(v => t = v)();
		// include Fabric canvas JSON if available so we can restore annotation state
		let fabricState: any = null;
		try {
			if (fabricCanvas && typeof fabricCanvas.toJSON === 'function') {
				fabricState = fabricCanvas.toJSON();
			}
		} catch (err) { /* ignore */ }
		const snap = JSON.stringify({ strokes: s, texts: t, fabric: fabricState });
		// trim future redo history
		currentHistoryStack = currentHistoryStack.slice(0, historyIndex + 1);
		currentHistoryStack.push(snap);
		historyIndex = currentHistoryStack.length - 1;
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

	function restore(snapStr: string) {
		try {
			const obj = JSON.parse(snapStr);
			strokes.set(obj.strokes || []);
			texts.set(obj.texts || []);
			// restore fabric canvas if present
			try {
				if (obj.fabric && fabricCanvas && typeof fabricCanvas.loadFromJSON === 'function') {
					fabricCanvas.loadFromJSON(obj.fabric, () => {
						fabricCanvas.renderAll();
					});
				}
			} catch (err) {  }
		} catch (err) {
			console.warn('failed to restore snapshot', err);
		}
	}

	function resize() {
		if (!fabricCanvasEl || !fabricCanvas) return;

		const container = boxEl || document.body;
		const rect = container.getBoundingClientRect();
		const width = rect.width - 40; // account for horizontal padding (20px on each side)
		const height = rect.height - 40;
		const ratio = window.devicePixelRatio || 1;
		try {
			fabricCanvas.setDimensions({ width, height });

			// Adjust brush to account for pixel ratio so stroke thickness is consistent visually
			if (fabricCanvas.freeDrawingBrush) {
				fabricCanvas.freeDrawingBrush.width = brushWidth * ratio;
			}

			if (typeof fabricCanvas.calcOffset === 'function') fabricCanvas.calcOffset();
			fabricCanvas.renderAll();
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
		}
	}

	onMount(async () => {
		if (!fabricCanvasEl) return;
		// create Fabric canvas
		fabricCanvas = new Canvas(fabricCanvasEl, {
			isDrawingMode: true,
			selection: false,
			backgroundColor: '#ffffff',
			preserveObjectStacking: true
		});

		// ensure we have a proper pencil brush instance and initial settings
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

		// record strokes into the strokes store when a path is created by the pencil brush
		function handlePathCreated(event: any) {
			try {
				const pathObj = event.path || event.target;
				const pathData: any[] = (pathObj && (pathObj.path || pathObj._path)) || [];
				const pts: Array<{x:number,y:number}> = [];
				for (const seg of pathData) {
					if (Array.isArray(seg) && (typeof seg[1] === 'number') && (typeof seg[2] === 'number')) {
						pts.push({ x: seg[1], y: seg[2] });
					}
				}

				// Update store and log the new value immediately
				strokes.update(s => {
					const next = [...s, pts];
					return next;
				});

			} catch (err) {
				console.error('handlePathCreated error', err);
			}
		}

		// attach handler
		fabricCanvas.on('path:created', handlePathCreated);

		// handle adding textboxes when the textbox tool is selected
		function createTextboxAt(x: number, y: number) {
			if (!fabricCanvas) return null;
			editingText = true;
			const id = 'text-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
			const itext: any = new IText('Text', {
				left: x,
				top: y,
				fontSize: 16,
				fill: '#000000',
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
			// update texts store once
			syncTextsFromCanvas();
			return itext;
		}

		function syncTextsFromCanvas() {
			if (!fabricCanvas) return;
			const objs = fabricCanvas.getObjects().filter((o: any) => o.type === 'i-text' || o instanceof IText);
			const out = objs.map((o: any) => ({
				id: o.__customId || (o as any).uid || String(o.__uniqueId || (o.left + '-' + o.top)),
				x: o.left,
				y: o.top,
				text: o.text || o.textLines && o.textLines.join('\n') || '' ,
				width: o.width,
				height: o.height,
				fontSize: String(o.fontSize),
				fontFamily: o.fontFamily,
				fontWeight: o.fontWeight,
				fontStyle: o.fontStyle
			}));
			texts.set(out as any);
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

		// wire up mouse handler
		fabricCanvas.on('mouse:down', handleCanvasMouseDown);

		// sync texts when objects are modified or removed
		fabricCanvas.on('object:modified', (e: any) => {
			editingText = true;
			syncTextsFromCanvas();
		});
		fabricCanvas.on('object:removed', (e: any) => {
			syncTextsFromCanvas();
		});


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

	// Exported helper: clear all overlays (strokes and texts) and snapshot the cleared state
	function clearOverlays() {
		// clear stores
		strokes.set([]);
		texts.set([]);
		// remove all objects from the Fabric canvas
		if (fabricCanvas) {
			fabricCanvas.clear();
			// reapply background if needed
			try { fabricCanvas.backgroundColor = '#ffffff'; } catch (err) {}
			fabricCanvas.renderAll();
		}
		snapshot();
	}

	export function applyChanges() {
		historyStacks = [...historyStacks, currentHistoryStack];
		// start a new stack working off of this state
		currentHistoryStack = [];
		historyIndex = -1
		clearOverlays();
	}

	export function rollbackChanges() {
		let restoredHistoryStack = historyStacks.pop() ?? [];
		let lastIndexBeforeChangesApplied = restoredHistoryStack.length - 1;
		restore(restoredHistoryStack[lastIndexBeforeChangesApplied]);
		historyIndex = lastIndexBeforeChangesApplied;
		currentHistoryStack = restoredHistoryStack;
	}

	export function renderedVisPresent() {
		return !!baseSvg;
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
		if (fabricCanvas && typeof fabricCanvas.toDataURL === 'function') {
			const s = scale ?? (window.devicePixelRatio || 1);
			try {
				return fabricCanvas.toDataURL({ format: mime.split('/')[1] || 'png', multiplier: s, quality });
			} catch (err) {
				throw new Error('exportCanvasDataUrl: failed to export - ' + String(err));
			}
		}
		throw new Error('exportCanvasDataUrl: no fabric canvas available to export');
	}

</script>

<style>
    /* Ensure common modal/dialog selectors sit above the canvas and overlays in all themes
   Force a very high z-index so third-party modals (Bootstrap, Bulma, native dialog, etc.)
   will render above the canvas. This avoids detecting modal state and is a minimal change. */
    :global(dialog[open]), :global(.modal), :global([role="dialog"]), :global(.modal-backdrop) {
        z-index: 100000 !important;
    }

    /* overlay spinner styles */
    .applying-overlay {
    	position: absolute;
    	left: 0;
    	top: 0;
    	right: 0;
    	bottom: 0;
    	display: flex;
    	align-items: center;
    	justify-content: center;
    	background: rgba(255, 255, 255, 0.8);
    	pointer-events: all;
    	z-index: 1000;
		margin: 20px;
    }

    .applying-status {
    	display: flex;
    	flex-direction: column;
    	align-items: center;
    	color: #333;
    	font-size: 16px;
    	font-weight: 500;
    	text-align: center;
    }
</style>

<div class="box" style="height:100%; position:relative; display:flex; flex-direction:column;" bind:this={boxEl}>

	<div style="position:absolute; left:0; right:0; top:0; display:flex; justify-content:center; pointer-events:auto; width: 100%; padding: 20px 20px 0 20px; z-index:10000;">
		<CanvasToolbar selected={selectedTool} bind:brushColor={brushColor} bind:brushWidth={brushWidth} on:selectTool={handleSelectTool} on:undo={undo} on:redo={redo} />
	</div>

	<!-- Fabric.js canvas (annotation surface). Vega embed will be added later underneath this layer. -->
	<canvas bind:this={fabricCanvasEl}
		style="position:absolute; left:0; top:0; right:0; bottom:0; width:100%; height:100%; touch-action:none; z-index:30;">
	</canvas>

	<!-- Applying overlay with spinner and status text -->
	{#if applying}
		<div class="applying-overlay" aria-live="polite" aria-busy="true">
			<div class="applying-status">
				<Fa icon={faSpinner} spin />
				<span>Applying changes, please wait...</span>
			</div>
		</div>
	{/if}

</div>
