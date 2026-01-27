<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { writable } from 'svelte/store';

	export let spec: any = null;
	export let selectedTool: 'pen' | 'textbox' | 'eraser' = 'pen';

	let containerEl: HTMLDivElement | null = null;
	let canvasEl: HTMLCanvasElement | null = null;
	let ctx: CanvasRenderingContext2D | null = null;
	let view: any = null;

	const strokes = writable<Array<Array<{x:number,y:number}>>>([]);
	const texts = writable<Array<{x:number,y:number,text:string}>>([]);

	// history for undo/redo
	let history: Array<string> = [];
	let historyIndex = -1;

	let isDrawing = false;
	let currentStroke: Array<{x:number,y:number}> | null = null;

	function snapshot() {
		// serialize strokes and texts
		let s: any[] = [];
		strokes.subscribe(v => s = v)();
		let t: any[] = [];
		texts.subscribe(v => t = v)();
		const snap = JSON.stringify({ strokes: s, texts: t });
		// trim future redo history
		history = history.slice(0, historyIndex + 1);
		history.push(snap);
		historyIndex = history.length - 1;
	}

	export function undo() {
		if (historyIndex <= 0) return;
		historyIndex--;
		restore(history[historyIndex]);
	}

	export function redo() {
		if (historyIndex >= history.length - 1) return;
		historyIndex++;
		restore(history[historyIndex]);
	}

	function restore(snapStr: string) {
		try {
			const obj = JSON.parse(snapStr);
			strokes.set(obj.strokes || []);
			texts.set(obj.texts || []);
			drawAll();
		} catch (err) {
			console.warn('failed to restore snapshot', err);
		}
	}

	onMount(async () => {
		if (canvasEl) {
			ctx = canvasEl.getContext('2d');
			resizeCanvas();
			if (typeof window !== 'undefined') {
				window.addEventListener('resize', resizeCanvas);
			}
		}

		// Render Vega-Lite spec using vega-embed (client-only)
		if (typeof window !== 'undefined') {
			try {
				const embed = (await import('vega-embed')).default;
				if (containerEl && spec) {
					let parsed = spec;
					try { parsed = typeof spec === 'string' ? JSON.parse(spec) : spec; } catch (err) { parsed = spec; }
					view = await embed(containerEl, parsed, { actions: false, renderer: 'canvas' });
				}
			} catch (err) {
				console.warn('vega-embed not available or failed to render', err);
			}
		}

		// initial snapshot
		snapshot();
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', resizeCanvas);
		}
	});

	function resizeCanvas() {
		if (!canvasEl || !containerEl) return;
		canvasEl.width = containerEl.clientWidth;
		canvasEl.height = containerEl.clientHeight;
		drawAll();
	}

	function toLocalCoords(e: PointerEvent) {
		if (!canvasEl) return { x: 0, y: 0 };
		const rect = canvasEl.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function eraseAt(p: {x:number,y:number}) {
		// remove any stroke that has a point within threshold
		const threshold = 8; // px
		let removed = false;
		strokes.update(s => s.filter(st => {
			for (const pt of st) {
				const dx = pt.x - p.x;
				const dy = pt.y - p.y;
				if (dx*dx + dy*dy <= threshold*threshold) { removed = true; return false; } // remove this stroke
			}
			return true; // keep
		}));
		if (removed) snapshot();
		drawAll();
	}

	function pointerDown(e: PointerEvent) {
		e.preventDefault();
		const p = toLocalCoords(e);
		if (selectedTool === 'pen') {
			isDrawing = true;
			currentStroke = [];
			currentStroke.push(p);
			strokes.update(s => { s.push(currentStroke!); return s; });
			drawAll();
		} else if (selectedTool === 'textbox') {
			// create a text box overlay
			texts.update(t => { t.push({ x: p.x, y: p.y, text: 'Text' }); return t; });
			snapshot();
		} else if (selectedTool === 'eraser') {
			eraseAt(p);
		}
	}

	function pointerMove(e: PointerEvent) {
		if (selectedTool === 'eraser') {
			const p = toLocalCoords(e);
			eraseAt(p);
			return;
		}
		if (!isDrawing || !currentStroke) return;
		e.preventDefault();
		const p = toLocalCoords(e);
		currentStroke.push(p);
		drawAll();
	}

	function pointerUp(_e?: PointerEvent) {
		if (isDrawing) {
			isDrawing = false;
			currentStroke = null;
			snapshot();
		}
	}

	function clearCanvas() {
		if (!ctx || !canvasEl) return;
		ctx!.clearRect(0,0,canvasEl.width, canvasEl.height);
	}

	function drawAll() {
		if (!ctx || !canvasEl) return;
		clearCanvas();
		// draw strokes
		let sarr: Array<Array<{x:number,y:number}>> = [];
		strokes.subscribe(v => sarr = v)();
		ctx!.lineJoin = 'round';
		ctx!.lineCap = 'round';
		ctx!.strokeStyle = 'red';
		ctx!.lineWidth = 2;
		sarr.forEach(st => {
			if (st.length < 1) return;
			ctx!.beginPath();
			ctx!.moveTo(st[0].x, st[0].y);
			for (let i=1;i<st.length;i++) ctx!.lineTo(st[i].x, st[i].y);
			ctx!.stroke();
		});

		// draw texts
		let tarr: Array<{x:number,y:number,text:string}> = [];
		texts.subscribe(v => tarr = v)();
		ctx!.fillStyle = 'black';
		ctx!.font = '14px sans-serif';
		tarr.forEach(t => {
			ctx!.fillText(t.text, t.x, t.y);
		});
	}
</script>

<div class="box" style="height:100%; position:relative; display:flex; flex-direction:column;">
<!--	<div style="flex:0 0 auto;">-->
<!--		<p class="is-size-7 has-text-grey">Tool: <strong>{selectedTool}</strong></p>-->
<!--	</div>-->

	<div class="content" style="flex:1 1 auto; min-height:0; position:relative;">
		<div bind:this={containerEl} style="height:100%; width:100%; background:#fff; display:flex; align-items:center; justify-content:center;">
			{#if !spec}
				<p class="has-text-grey">Vega-Lite visualization preview will render here.</p>
			{/if}
		</div>
		<canvas bind:this={canvasEl}
			style="position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:auto; touch-action:none;"
			on:pointerdown={pointerDown}
			on:pointermove={pointerMove}
			on:pointerup={pointerUp}
			aria-label="Drawing canvas overlay"></canvas>
	</div>
</div>

<style>
	/* intentionally left empty; no global styles here */
</style>
