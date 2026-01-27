<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { writable } from 'svelte/store';

	export let spec: any = null;
	export let selectedTool: 'pen' | 'textbox' | 'eraser' = 'pen';

	let containerEl: HTMLDivElement | null = null;
	let canvasEl: HTMLCanvasElement | null = null;
	let ctx: CanvasRenderingContext2D | null = null;

	const strokes = writable<Array<Array<{x:number,y:number}>>>([]);
	// texts now have an id so overlays can be tracked
	const texts = writable<Array<{id:string,x:number,y:number,text:string,width?:number,height?:number}>>([]);

	// editing geometry when a text box is active
	let editingX = 0;
	let editingY = 0;
	let editingWidth = 150;
	let editingHeight = 24;

	const TEXT_PAD = 4; // must match textarea padding in style
	const TEXT_BORDER = 1; // must match textarea border width
	const MIN_W = 40;
	const MIN_H = 16;

	// resizing state
	let isResizing = false;
	let resizeSide: 'left'|'right'|'top'|'bottom' | null = null;
	let resizeStartRect: DOMRect | null = null;

	// history for undo/redo
	let history: Array<string> = [];
	let historyIndex = -1;

	let isDrawing = false;
	let currentStroke: Array<{x:number,y:number}> | null = null;
	let isErasing = false;

	// id of the text currently being edited (shows an HTML textarea overlay)
	let editingId: string | null = null;
	let editingText: string = '';
	let textareaRef: HTMLTextAreaElement | null = null;
	let textareaWrapperRef: HTMLDivElement | null = null;
	let ignoreNextBlur = false;
	let _lastWrapperLeft: number | null = null;
	let _lastWrapperTop: number | null = null;
	let _lastWrapperWidth: number | null = null;
	let _lastWrapperHeight: number | null = null;

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
		// capture-phase pointerdown to detect handle presses before blur happens
		if (typeof window !== 'undefined') {
			window.addEventListener('pointerdown', onGlobalPointerDown, true);
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', resizeCanvas);
			window.removeEventListener('pointerdown', onGlobalPointerDown, true);
		}
	});

	function resizeCanvas() {
		if (!canvasEl || !containerEl) return;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
		// set CSS size
		canvasEl.style.width = cw + 'px';
		canvasEl.style.height = ch + 'px';
		// set backing store size for crisp drawing on high-DPI
		canvasEl.width = Math.round(cw * dpr);
		canvasEl.height = Math.round(ch * dpr);
		if (!ctx) ctx = canvasEl.getContext('2d');
		// reset transform so 1 unit in canvas = 1 CSS pixel
		ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
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

	function ensureCanvasReady() {
		if (!canvasEl) return;
		if (!ctx) ctx = canvasEl.getContext('2d');
		// if canvas has no size, resize from container
		if (canvasEl.width === 0 || canvasEl.height === 0) {
			resizeCanvas();
		}
	}

	function pointerDown(e: PointerEvent) {
		e.preventDefault();
		ensureCanvasReady();
		// If a text is currently being edited but user clicked elsewhere (not the textarea), commit it first
		const target = (e.target as Element | null);
		if (editingId && textareaRef && target !== textareaRef) {
			// schedule blur on the textarea on next microtask so the browser finishes any pending input events
			setTimeout(() => {
				try {
					textareaRef?.blur();
				} catch (err) {
					finishEditing();
				}
			}, 0);
			return;
		}
		const p = toLocalCoords(e);
		if (selectedTool === 'pen') {
			isDrawing = true;
			currentStroke = [];
			currentStroke.push(p);
			strokes.update(s => { s.push(currentStroke!); return s; });
			drawAll();
			// capture pointer so we continue receiving move/up events even if pointer leaves canvas
			try {
				if (canvasEl && (canvasEl as any).setPointerCapture) {
					(canvasEl as any).setPointerCapture(e.pointerId);
				}
			} catch (err) {
				// ignore if not supported
			}
		} else if (selectedTool === 'textbox') {
			// create a text box overlay
			const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8);
			editingX = p.x;
			editingY = p.y;
			editingWidth = 160;
			editingHeight = 24;
			texts.update(t => { t.push({ id, x: p.x, y: p.y, text: '', width: editingWidth, height: editingHeight }); return t; });
			editingId = id;
			editingText = '';
			// wait for DOM to render the textarea and focus it
			tick().then(() => {
				if (textareaRef) {
					// set initial size from editingWidth/editingHeight
					textareaRef.style.width = editingWidth + 'px';
					textareaRef.style.height = editingHeight + 'px';
					adjustTextareaSize();
					textareaRef.focus();
					// place caret at end
					const len = textareaRef.value.length;
					textareaRef.setSelectionRange(len, len);
				}
			});
			// don't snapshot yet; wait until user finishes editing (on blur)
		} else if (selectedTool === 'eraser') {
			// start erasing at the clicked point and capture pointer to continue erasing while dragging
			isErasing = true;
			eraseAt(p);
			try {
				if (canvasEl && (canvasEl as any).setPointerCapture) {
					(canvasEl as any).setPointerCapture(e.pointerId);
				}
			} catch (err) {}
		}
	}

	// Cancel editing and remove the textbox from the store (used for Escape and empty cancels)
	function cancelEditing() {
		if (!editingId) return;
		const id = editingId;
		editingId = null;
		editingText = '';
		texts.update(arr => arr.filter(t => t.id !== id));
		snapshot();
	}

	function pointerMove(e: PointerEvent) {
		ensureCanvasReady();
		// eraser active and dragging -> erase at pointer
		if (isErasing) {
			e.preventDefault();
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
		ensureCanvasReady();
		// finish drawing
		if (isDrawing) {
			isDrawing = false;
			currentStroke = null;
			snapshot();
			// release pointer capture if present
			try {
				if (canvasEl && _e && (canvasEl as any).releasePointerCapture) {
					(canvasEl as any).releasePointerCapture(_e.pointerId);
				}
			} catch (err) {
				// ignore
			}
		}

		// finish erasing
		if (isErasing) {
			isErasing = false;
			// release pointer capture if present
			try {
				if (canvasEl && _e && (canvasEl as any).releasePointerCapture) {
					(canvasEl as any).releasePointerCapture(_e.pointerId);
				}
			} catch (err) {
				// ignore
			}
			// snapshot already handled by eraseAt when something was removed
		}
	}

	function clearCanvas() {
		if (!ctx || !canvasEl) return;
		ctx!.clearRect(0,0,canvasEl.width, canvasEl.height);
	}

	function updateText(id: string, newText: string) {
		texts.update(arr => arr.map(t => t.id === id ? { ...t, text: newText, width: t.width ?? editingWidth, height: t.height ?? editingHeight } : t));
		drawAll();
	}

	function finishEditing() {
		// commit current editingText to the store for the editingId, then clear editing state
		if (!editingId) return;
		const id = editingId;
		// clear editingId first so drawAll doesn't skip this id
		editingId = null;
		if (editingText.trim() === '') {
			// remove empty textbox
			texts.update(arr => arr.filter(t => t.id !== id));
		} else {
			// compute final position and size from the textarea's bounding rect so canvas alignment is exact
			let finalX = editingX;
			let finalY = editingY;
			let finalW = editingWidth;
			let finalH = editingHeight;
			try {
				if (textareaWrapperRef && canvasEl) {
					const tr = textareaWrapperRef.getBoundingClientRect();
					const cr = canvasEl.getBoundingClientRect();
					// read computed padding/border from the textarea if available for pixel-perfect alignment
					let padLeft = TEXT_PAD, padTop = TEXT_PAD;
					let borderLeft = TEXT_BORDER, borderTop = TEXT_BORDER;
					try {
						if (textareaRef) {
							const cs = window.getComputedStyle(textareaRef);
							padLeft = parseFloat(cs.paddingLeft || String(TEXT_PAD)) || TEXT_PAD;
							padTop = parseFloat(cs.paddingTop || String(TEXT_PAD)) || TEXT_PAD;
							borderLeft = parseFloat(cs.borderLeftWidth || String(TEXT_BORDER)) || TEXT_BORDER;
							borderTop = parseFloat(cs.borderTopWidth || String(TEXT_BORDER)) || TEXT_BORDER;
						}
					} catch (err) { /* ignore */ }
					// store the content origin (inside-border + padding) so canvas drawing aligns exactly
					finalX = tr.left - cr.left + borderLeft + padLeft;
					finalY = tr.top - cr.top + borderTop + padTop + 2; // small 2px nudge down to correct placement
					finalW = textareaWrapperRef.offsetWidth;
					finalH = textareaWrapperRef.offsetHeight;
				}
			} catch (err) {
				// fallback to editingX/Y
			}
			texts.update(arr => arr.map(t => t.id === id ? { ...t, text: editingText, width: finalW, height: finalH, x: finalX, y: finalY } : t));
			// ensure a draw after updating
			drawAll();
		}
		editingText = '';
		snapshot();
	}

	// auto-resize textarea to fit content and stay within container
	function adjustTextareaSize() {
		if (!textareaRef || !containerEl) return;
		// when actively resizing, don't reset width/height styles -- preserve the user's drag
		try {
			if (isResizing) {
				// read actual offset sizes
				editingWidth = Math.max(40, textareaRef.offsetWidth);
				editingHeight = Math.max(16, textareaRef.offsetHeight);
				return;
			}
		} catch (err) {}
		// reset to auto to measure content size when not resizing
		textareaRef.style.height = 'auto';
		textareaRef.style.width = 'auto';
		// measure and store current width/height
		const paddingH = 8; // approximate padding
		// keep current width if user resized, otherwise use scrollWidth
		const measuredWidth = textareaRef.offsetWidth || Math.max(40, textareaRef.scrollWidth + 12);
		let newHeight = textareaRef.scrollHeight + paddingH;
		const maxHeight = containerEl.clientHeight - (textareaRef.offsetTop + 20);
		if (newHeight > maxHeight) newHeight = maxHeight;
		editingWidth = Math.max(40, measuredWidth);
		editingHeight = newHeight;
		textareaRef.style.width = editingWidth + 'px';
		textareaRef.style.height = editingHeight + 'px';
	}

	function drawAll() {
		if (!ctx || !canvasEl) return;
		clearCanvas();
		// configure text baseline to top so canvas y matches textarea top
		ctx!.textBaseline = 'top';
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

		// draw texts (skip the one currently being edited so overlay doesn't duplicate)
		let tarr: Array<{id:string,x:number,y:number,text:string,width?:number,height?:number}> = [];
		texts.subscribe(v => tarr = v)();
		ctx!.fillStyle = 'black';
		ctx!.font = '14px sans-serif';
		const lineHeight = 18; // px
		tarr.forEach(t => {
			if (t.id === editingId) return;
			// available width inside the textbox (subtract padding and borders)
			const boxW = (t.width ?? editingWidth) - (TEXT_PAD * 2) - (TEXT_BORDER * 2);
			const startX = t.x; // t.x is stored as content origin (includes border+padding)
			let y = t.y; // t.y is content origin
			if (!boxW || boxW < 20) {
				// just draw raw text at padded position
				ctx!.fillText(t.text, startX, y);
				return;
			}
			// handle explicit newlines and wrapping
			const paragraphs = t.text.split('\n');
			paragraphs.forEach(p => {
				const words = p.split(' ');
				let line = '';
				for (let n=0;n<words.length;n++) {
					const testLine = line ? (line + ' ' + words[n]) : words[n];
					const metrics = ctx!.measureText(testLine);
					const testWidth = metrics.width;
					if (testWidth > boxW && line) {
						ctx!.fillText(line, startX, y);
						line = words[n];
						y += lineHeight;
					} else {
						line = testLine;
					}
				}
				// last line
				if (line) {
					ctx!.fillText(line, startX, y);
					y += lineHeight;
				}
			});
		});
	}

	function startResize(side: 'left'|'right'|'top'|'bottom', e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		try {
			const h = e.currentTarget as Element & { setPointerCapture?: (id: number) => void };
			if (h && typeof h.setPointerCapture === 'function') h.setPointerCapture(e.pointerId);
		} catch {}
		ignoreNextBlur = true;
		isResizing = true;
		resizeSide = side;
		resizeStartX = e.clientX;
		resizeStartY = e.clientY;
		resizeStartLeft = editingX;
		resizeStartTop = editingY;
		resizeStartW = editingWidth;
		resizeStartH = editingHeight;

		// capture an explicit start rect (or synthesize one if ref missing)
		try {
			if (textareaWrapperRef) {
				resizeStartRect = textareaWrapperRef.getBoundingClientRect();
			} else if (canvasEl) {
				const cr = canvasEl.getBoundingClientRect();
				// synthesize a rect from editingX/Y/W/H (editingX/Y are content origin)
				const left = cr.left + editingX - TEXT_BORDER - TEXT_PAD;
				const top = cr.top + editingY - TEXT_BORDER - TEXT_PAD;
				resizeStartRect = new DOMRect(left, top, editingWidth, editingHeight);
			} else {
				resizeStartRect = null;
			}
			if (resizeStartRect) {
				resizeStartBottom = resizeStartRect.bottom;
				resizeStartTopPx = resizeStartRect.top;
				resizeStartHeightPx = resizeStartRect.height;
			}
		} catch {
			resizeStartRect = null;
		}

		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', endResize);
	}

	function onResizeMove(e: PointerEvent) {
		if (!isResizing || !resizeSide || !resizeStartRect || !textareaWrapperRef || !canvasEl) return;

		const canvasRect = canvasEl.getBoundingClientRect();

		const startLeft = resizeStartRect.left;
		const startRight = resizeStartRect.right;
		const startTop = resizeStartRect.top;
		const startBottom = resizeStartRect.bottom;

		if (resizeSide === 'right') {
			// anchor left
			const rawW = e.clientX - startLeft;
			const newW = Math.max(MIN_W, Math.round(rawW));

			textareaWrapperRef.style.width = newW + 'px';
			if (textareaRef) textareaRef.style.width = newW + 'px';
			editingWidth = newW;
		}

		else if (resizeSide === 'left') {
			// anchor right
			const rawW = startRight - e.clientX;
			const newW = Math.max(MIN_W, Math.round(rawW));

			const newLeftClient = startRight - newW;
			const leftPx = Math.round(newLeftClient - canvasRect.left);

			if (_lastWrapperLeft !== leftPx) {
				textareaWrapperRef.style.left = leftPx + 'px';
				_lastWrapperLeft = leftPx;
			}

			textareaWrapperRef.style.width = newW + 'px';
			if (textareaRef) textareaRef.style.width = newW + 'px';
			editingWidth = newW;
		}

		else if (resizeSide === 'bottom') {
			// anchor top
			const rawH = e.clientY - startTop;
			const newH = Math.max(MIN_H, Math.round(rawH));

			textareaWrapperRef.style.height = newH + 'px';
			if (textareaRef) textareaRef.style.height = newH + 'px';
			editingHeight = newH;
		}

		else if (resizeSide === 'top') {
			// anchor bottom
			const rawH = startBottom - e.clientY;
			const newH = Math.max(MIN_H, Math.round(rawH));

			const newTopClient = startBottom - newH;
			const topPx = Math.round(newTopClient - canvasRect.top);

			if (_lastWrapperTop !== topPx) {
				textareaWrapperRef.style.top = topPx + 'px';
				_lastWrapperTop = topPx;
			}

			textareaWrapperRef.style.height = newH + 'px';
			if (textareaRef) textareaRef.style.height = newH + 'px';
			editingHeight = newH;
		}
	}


	function endResize() {
		window.removeEventListener('pointermove', onResizeMove);
		window.removeEventListener('pointerup', endResize);

		try {
			if (textareaWrapperRef && canvasEl) {
				const tr = textareaWrapperRef.getBoundingClientRect();
				const cr = canvasEl.getBoundingClientRect();
				// compute content origin using computed padding/border if available
				let padLeft = TEXT_PAD, padTop = TEXT_PAD;
				let borderLeft = TEXT_BORDER, borderTop = TEXT_BORDER;
				try {
					if (textareaRef) {
						const cs = window.getComputedStyle(textareaRef);
						padLeft = parseFloat(cs.paddingLeft || String(TEXT_PAD)) || TEXT_PAD;
						padTop = parseFloat(cs.paddingTop || String(TEXT_PAD)) || TEXT_PAD;
						borderLeft = parseFloat(cs.borderLeftWidth || String(TEXT_BORDER)) || TEXT_BORDER;
						borderTop = parseFloat(cs.borderTopWidth || String(TEXT_BORDER)) || TEXT_BORDER;
					}
				} catch {}
				editingX = tr.left - cr.left + borderLeft + padLeft;
				editingY = tr.top - cr.top + borderTop + padTop + 2; // keep any existing visual nudge if desired
				editingWidth = textareaWrapperRef.offsetWidth;
				editingHeight = textareaWrapperRef.offsetHeight;

				_lastWrapperLeft = Math.round(tr.left - cr.left);
				_lastWrapperTop = Math.round(tr.top - cr.top);
				_lastWrapperWidth = textareaWrapperRef.offsetWidth;
				_lastWrapperHeight = textareaWrapperRef.offsetHeight;

				// apply immediately to avoid one-frame reactive overwrite
				try {
					textareaWrapperRef.style.left = _lastWrapperLeft + 'px';
					textareaWrapperRef.style.top = _lastWrapperTop + 'px';
					textareaWrapperRef.style.width = _lastWrapperWidth + 'px';
					textareaWrapperRef.style.height = _lastWrapperHeight + 'px';
				} catch {}
			}
		} catch {}

		resizeStartRect = null;
		isResizing = false;
		resizeSide = null;
		ignoreNextBlur = false;
		_topAtMin = false;
		try { textareaRef?.focus(); } catch {}
	}


	function onGlobalPointerDown(e: PointerEvent) {
		try {
			const el = e.target as Element | null;
			if (el && el.closest && el.closest('.handle')) {
				ignoreNextBlur = true;
			}
		} catch (err) {
			// ignore
		}
	}

	// keep wrapper DOM positioned/sized in sync with editing values when not actively resizing
	$: if (textareaWrapperRef && !isResizing) {
	    try {
	        // Prefer one-time cached wrapper pixel values (set at endResize) to avoid a single-frame overwrite
	        let leftPx: number;
	        let topPx: number;
	        let wPx: number;
	        let hPx: number;
	        if (_lastWrapperLeft !== null) {
	            leftPx = _lastWrapperLeft;
	            _lastWrapperLeft = null; // consume cache
	        } else {
	            leftPx = Math.round(editingX - TEXT_BORDER - TEXT_PAD);
	        }
	        if (_lastWrapperTop !== null) {
	            topPx = _lastWrapperTop;
	            _lastWrapperTop = null; // consume cache
	        } else {
	            topPx = Math.round(editingY - TEXT_BORDER - TEXT_PAD);
	        }
	        if (_lastWrapperWidth !== null) {
	            wPx = _lastWrapperWidth;
	            _lastWrapperWidth = null;
	        } else {
	            wPx = Math.round(editingWidth);
	        }
	        if (_lastWrapperHeight !== null) {
	            hPx = _lastWrapperHeight;
	            _lastWrapperHeight = null;
	        } else {
	            hPx = Math.round(editingHeight);
	        }
	        if (textareaWrapperRef.style.left !== leftPx + 'px') textareaWrapperRef.style.left = leftPx + 'px';
	        if (textareaWrapperRef.style.top !== topPx + 'px') textareaWrapperRef.style.top = topPx + 'px';
	        if (textareaWrapperRef.style.width !== wPx + 'px') textareaWrapperRef.style.width = wPx + 'px';
	        if (textareaWrapperRef.style.height !== hPx + 'px') textareaWrapperRef.style.height = hPx + 'px';
	    } catch (err) {
	        // ignore
	    }
	}
</script>

<div class="box" style="height:100%; position:relative; display:flex; flex-direction:column;">

	<div class="content" style="flex:1 1 auto; min-height:0; position:relative;" bind:this={contentEl}>
		<div bind:this={containerEl} style="height:100%; width:100%; background:#fff; display:flex; align-items:center; justify-content:center; position:relative; pointer-events:none; z-index:1;">
			{#if !spec}
				<p class="has-text-grey">Vega-Lite visualization preview will render here.</p>
			{/if}
		</div>

		<canvas bind:this={canvasEl}
			style="position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:auto; touch-action:none; z-index:9999;"
			on:pointerdown={pointerDown}
			on:pointermove={pointerMove}
			on:pointerup={pointerUp}
			aria-label="Drawing canvas overlay"></canvas>

		<!-- overlays layer sits above the canvas; layer ignores pointer events except active textareas -->
		<div class="overlays" class:pointer-active={editingId} style="position:absolute; left:0; top:0; right:0; bottom:0; z-index:10000;">
			{#each $texts as t (t.id)}
				{#if t.id === editingId}
					<div bind:this={textareaWrapperRef} style="position:absolute; pointer-events:auto;">
						<textarea
							bind:this={textareaRef}
							class="text-overlay"
							style="position:relative; z-index:1; min-width:40px; min-height:20px; border:1px dashed rgba(0,0,0,0.35); background:transparent; padding:4px; font:14px sans-serif; color:#000; resize:none;"
							bind:value={editingText}
							on:input={() => { adjustTextareaSize(); }}
							on:blur={() => {
							// delay commit briefly to let a resize start handler run (it sets isResizing)
							setTimeout(() => {
								if (ignoreNextBlur) { ignoreNextBlur = false; return; }
								if (!isResizing) finishEditing();
							}, 0);
						}}
							on:keydown={(e) => {
								if (e.key === 'Escape') { /* cancel edit - discard current editing text */ cancelEditing(); }
								// allow Enter to insert newline; Ctrl/Cmd+Enter commits
								if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
									textareaRef && textareaRef.blur();
								}
							}}
						></textarea>
						<!-- resize handles: small circles at midpoints of each side -->
						{#if editingId}
							<!-- top -->
							<div class="handle" on:pointerdown={(e) => startResize('top', e)} style="position:absolute; left:50%; transform:translateX(-50%); top:-6px; width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:n-resize; z-index:1001; pointer-events:auto;"></div>
							<!-- right -->
							<div class="handle" on:pointerdown={(e) => startResize('right', e)} style="position:absolute; right:-6px; top:50%; transform:translateY(-50%); width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:e-resize; z-index:1001; pointer-events:auto;"></div>
							<!-- bottom -->
							<div class="handle" on:pointerdown={(e) => startResize('bottom', e)} style="position:absolute; left:50%; transform:translateX(-50%); bottom:-6px; width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:s-resize; z-index:1001; pointer-events:auto;"></div>
							<!-- left -->
							<div class="handle" on:pointerdown={(e) => startResize('left', e)} style="position:absolute; left:-6px; top:50%; transform:translateY(-50%); width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:w-resize; z-index:1001; pointer-events:auto;"></div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>
</div>

<style>
 	/* intentionally left empty; no global styles here */
 	.text-overlay:focus { outline: none; }
 	.text-overlay { box-sizing: border-box; }
 	.overlays { pointer-events: none; }
 	.overlays.pointer-active { pointer-events: auto; }
 	.handle { box-sizing: border-box; }
</style>

