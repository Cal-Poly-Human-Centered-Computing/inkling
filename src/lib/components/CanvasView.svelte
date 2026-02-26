<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { writable } from 'svelte/store';
	import { code } from "$lib/stores/code";
	import {CanvasToolbar, VersionControlToolbar} from "$lib/components/index";

	// removed exported `spec` prop — CanvasView now reads the `code` store directly via `$code`
	let selectedTool: 'selector' | 'pen' | 'textbox' | 'eraser' = 'pen';

	let containerEl: HTMLDivElement | null = null;
	let contentEl: HTMLDivElement | null = null;
	let svgEl: SVGSVGElement | null = null;
	let view: any = null;

	// debounced rendering of the Vega-Lite spec
	let renderTimeout: ReturnType<typeof setTimeout> | null = null;
	const RENDER_DEBOUNCE_MS = 800; // 800 ms

	// cache serialized specs so we only schedule/render when the spec actually changes
	let lastScheduledSpecStr: string | null = null;
	let lastRenderedSpecStr: string | null = null;

	async function doRenderSpec() {
		const toUse: any = $code as any;
		if (typeof window === 'undefined' || !containerEl || !toUse) return;
		try {
			// clear previous embed and finalize previous view if present
			try {
				if (view && view.view && typeof view.view.finalize === 'function') {
					view.view.finalize();
				}
			} catch (err) { /* ignore */ }
			// clear existing contents so embed injects fresh DOM
			containerEl.innerHTML = '';
			const embed = (await import('vega-embed')).default;
			let parsed: any = toUse;
			if (typeof toUse === 'string') {
				const s = toUse.trim();
				// if it looks like JSON but fails to parse, abort to avoid embed treating it as a URL
				if (s.startsWith('{') || s.startsWith('[')) {
					try {
						parsed = JSON.parse(toUse);
					} catch (err) {
						console.warn('doRenderSpec: invalid JSON spec string; aborting embed to avoid network fetch', err);
						return;
					}
				} else {
					// not JSON-like; allow embed to treat as a URL
					parsed = toUse;
				}
			}
			// request SVG renderer so Vega outputs DOM/SVG that can be inspected/selected
			view = await embed(containerEl, parsed, { actions: false, renderer: 'svg' });
			// allow pointer events on the vega container so its SVG can be interactive
			if (containerEl) containerEl.style.pointerEvents = 'auto';
		} catch (err) {
			console.warn('vega-embed render failed:', err);
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

	const strokes = writable<Array<Array<{x:number,y:number}>>>([]);
	// texts now have an id so overlays can be tracked
	const texts = writable<Array<{id:string,x:number,y:number,text:string,width?:number,height?:number,fontSize?:string,fontFamily?:string,fontWeight?:string,fontStyle?:string}>>([]);

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

	// track each series of edits before/between changes applied
	export let historyStacks: Array<Array<string>> = [];
	let currentHistoryStack: Array<string> = [];
	// track where we are in currentHistoryStack
	export let historyIndex = -1;

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

	// Start editing an existing text item (used by the selector tool)
	function editText(t: { id: string; x: number; y: number; text: string; width?: number; height?: number; fontSize?: string; fontFamily?: string; fontWeight?: string; fontStyle?: string }) {
        if (!t) return;
        // set editing geometry from the item's stored geometry
        editingId = t.id;
        editingText = t.text ?? '';
        editingX = t.x ?? 0;
        editingY = t.y ? t.y - 13 : 0;
        editingWidth = t.width ?? 160;
        editingHeight = t.height ?? 24;

        // prime the wrapper cache so the overlay doesn't jump on first render
        if (svgEl) {
            try {
                 _lastWrapperLeft = Math.round(editingX - TEXT_BORDER - TEXT_PAD);
                 _lastWrapperTop = Math.round(editingY - TEXT_BORDER - TEXT_PAD);
                 _lastWrapperWidth = Math.round(editingWidth);
                 _lastWrapperHeight = Math.round(editingHeight);
            } catch (err) {
                _lastWrapperLeft = null;
                _lastWrapperTop = null;
                _lastWrapperWidth = null;
                _lastWrapperHeight = null;
            }
        }

        // wait for DOM to render textarea overlay, then size and focus it
        tick().then(() => {
            try {
                if (textareaRef) {
                    textareaRef.style.width = editingWidth + 'px';
                    textareaRef.style.height = editingHeight + 'px';
                    adjustTextareaSize();
                    textareaRef.focus();
                    const len = textareaRef.value.length;
                    textareaRef.setSelectionRange(len, len);
                }
            } catch (err) { /* ignore */ }
        });
    }

	function snapshot() {
		// serialize strokes and texts
		let s: any[] = [];
		strokes.subscribe(v => s = v)();
		let t: any[] = [];
		texts.subscribe(v => t = v)();
		const snap = JSON.stringify({ strokes: s, texts: t });
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
		} catch (err) {
			console.warn('failed to restore snapshot', err);
		}
	}

	onMount(async () => {
		// no canvas context - SVG overlay will be used
		// Render Vega-Lite spec using vega-embed (client-only)
		if (typeof window !== 'undefined') {
			try {
				const embed = (await import('vega-embed')).default;
				if (containerEl && ($code)) {
					let parsed: any = $code; // original string-ish source
					let parsedObj: any = parsed; // the value we'll pass to vega-embed (may be object or URL string)
					if (typeof parsed === 'string') {
						const s = parsed.trim();
						if (s.startsWith('{') || s.startsWith('[')) {
							try { parsedObj = JSON.parse(parsed); } catch (err) { console.warn('onMount: initial spec string is invalid JSON; skipping initial embed', err); parsedObj = null; }
						} else {
							parsedObj = parsed;
						}
					}
					if (parsedObj) view = await embed(containerEl, parsedObj, { actions: false, renderer: 'svg' });
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
			window.removeEventListener('pointerdown', onGlobalPointerDown, true);
		}
		// clear any pending render timeout
		if (renderTimeout) {
			clearTimeout(renderTimeout);
			renderTimeout = null;
		}
		// finalize vega view if present
		try {
			if (view && view.view && typeof view.view.finalize === 'function') view.view.finalize();
		} catch (err) { /* ignore */ }
	});

	// remove canvas resize logic - SVG uses bounding box for coordinates
	function toLocalCoords(e: PointerEvent) {
		const el = svgEl ?? containerEl ?? null;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// helper: convert a stroke (array of points) to an SVG path string
	function strokeToPath(stroke: Array<{x:number,y:number}>) {
	    if (!stroke || stroke.length === 0) return '';
	    const parts: string[] = [];
	    parts.push(`M ${stroke[0].x} ${stroke[0].y}`);
	    for (let i = 1; i < stroke.length; i++) parts.push(`L ${stroke[i].x} ${stroke[i].y}`);
	    return parts.join(' ');
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
	}

	function ensureCanvasReady() {
		// kept for compatibility - ensure SVG element exists
		if (!svgEl) return;
	}

	function pointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
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
			// DOM will update the SVG path automatically
			try {
				if (svgEl && (svgEl as any).setPointerCapture) {
					(svgEl as any).setPointerCapture(e.pointerId);
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
			// include default font properties so SVG uses consistent rendering
			texts.update(arr => { arr.push({ id, x: p.x, y: p.y, text: '', width: editingWidth, height: editingHeight, fontSize: '14px', fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: '' }); return arr; });
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
				if (svgEl && (svgEl as any).setPointerCapture) {
					(svgEl as any).setPointerCapture(e.pointerId);
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
		// Determine whether this item previously existed and had content. If it was an existing
		// non-empty text item, cancelling should NOT delete it. We only remove newly-created
		// blank textboxes (the ones created when user picked the textbox tool).
		let prevItem: any = null;
		texts.subscribe(v => { prevItem = (v || []).find((it: any) => it.id === id) || null; })();
		if (prevItem) {
			if ((prevItem.text || '').toString().trim() === '') {
				// newly created blank textbox: remove it, but don't snapshot (it's not a meaningful change)
				texts.update(arr => arr.filter(t => t.id !== id));
			} else {
				// existing non-empty item: leave it as-is (discard any uncommitted edits) and don't snapshot
			}
		}
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
		// strokes store updated -> SVG path updates automatically
		strokes.update(s => s);
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
				if (svgEl && _e && (svgEl as any).releasePointerCapture) {
					(svgEl as any).releasePointerCapture(_e.pointerId);
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
				if (svgEl && _e && (svgEl as any).releasePointerCapture) {
					(svgEl as any).releasePointerCapture(_e.pointerId);
				}
			} catch (err) {
				// ignore
			}
			// snapshot already handled by eraseAt when something was removed
		}
	}

	// Exported helper: clear all overlays (strokes and texts) and snapshot the cleared state
	function clearOverlays() {
		try {
			// If a textarea is being edited, blur/finish it first
			try { if (textareaRef) textareaRef.blur(); } catch (_) {}
			editingId = null;
			editingText = '';
			strokes.set([]);
			texts.set([]);
			// Record this change so it can be undone
			snapshot();
		} catch (err) {
			console.warn('clearOverlays failed', err);
		}
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

	function updateText(id: string, newText: string) {
		texts.update(arr => arr.map(t => t.id === id ? { ...t, text: newText, width: t.width ?? editingWidth, height: t.height ?? editingHeight } : t));
	}

	let measureCtx: CanvasRenderingContext2D | null = null;

	// helper: measure a string width using canvas 2D context for the given CSS font
	function measureTextWidth(text: string, cssFont: string) {
	    try {
	        if (!measureCtx) {
	            const c = document.createElement('canvas');
	            measureCtx = c.getContext('2d');
	        }
	        if (!measureCtx) return text.length * 7; // fallback
	        measureCtx.font = cssFont || '14px sans-serif';
	        const m = measureCtx.measureText(text);
	        return m.width || 0;
	    } catch (err) {
	        return text.length * 7;
	    }
	}

	// Wrap text to a maximum pixel width using the provided CSS font
	function wrapTextToWidth(text: string, maxWidth: number, cssFont: string) {
	    if (!text || maxWidth <= 0) return text;
	    const paragraphs = text.split('\n');
	    const outLines: string[] = [];

	    for (const para of paragraphs) {
	        const words = para.split(/(\s+)/); // keep spaces so we can preserve multiple spaces
	        let line = '';
	        for (let i = 0; i < words.length; i++) {
	            const word = words[i];
	            // if adding this word exceeds width, flush current line
	            const candidate = line + word;
	            const w = measureTextWidth(candidate.replace(/\s+/g, ' '), cssFont);
	            if (w <= maxWidth) {
	                line = candidate;
	            } else {
	                if (line.trim().length > 0) {
	                    outLines.push(line.replace(/\s+$/, ''));
	                    line = '';
	                }
	                // If the single word is wider than the box, break the word
	                let remaining = word;
	                // break long continuous segment
	                while (measureTextWidth(remaining.replace(/\s+/g, ' '), cssFont) > maxWidth && remaining.length > 1) {
	                    // binary-search approximate break point
	                    let lo = 0, hi = remaining.length;
	                    while (lo < hi) {
	                        const mid = Math.ceil((lo + hi) / 2);
	                        const part = remaining.slice(0, mid);
	                        if (measureTextWidth(part.replace(/\s+/g, ' '), cssFont) <= maxWidth) lo = mid; else hi = mid - 1;
	                        if (lo === hi - 1) break;
	                    }
	                    const cut = Math.max(1, lo);
	                    outLines.push(remaining.slice(0, cut));
	                    remaining = remaining.slice(cut);
	                }
	                // remaining fits
	                if (remaining.trim().length > 0) {
	                    line = remaining;
	                } else {
	                    line = '';
	                }
	            }
	        }
	        if (line.length > 0) outLines.push(line.replace(/\s+$/, ''));
	        // preserve empty paragraph as blank line
	        if (para === '' && outLines.length === 0) outLines.push('');
	    }

	    return outLines.join('\n');
	}

	function finishEditing() {
		// commit current editingText to the store for the editingId, then clear editing state
		if (!editingId) return;
		const id = editingId;
		// clear editingId first so overlay doesn't duplicate content
		editingId = null;

		// Capture previous item so we can detect whether anything meaningful changed
		let prevItem: any = null;
		texts.subscribe(v => { prevItem = (v || []).find((it: any) => it.id === id) || null; })();

		if (editingText.trim() === '') {
			// remove empty textbox
			texts.update(arr => arr.filter(t => t.id !== id));
			// Only snapshot if the previous item existed and had non-empty text (i.e. this is a meaningful deletion)
			if (prevItem && (prevItem.text && String(prevItem.text).trim() !== '')) {
				snapshot();
			}
			editingText = '';
			return;
		}

		// compute final position and size from the textarea's bounding rect so SVG alignment is exact
		let finalX = editingX;
		let finalY = editingY;
		let finalW = editingWidth;
		let finalH = editingHeight;
		try {
			if (textareaWrapperRef && svgEl) {
				const tr = textareaWrapperRef.getBoundingClientRect();
				const cr = svgEl.getBoundingClientRect();
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
				// store the content origin (inside-border + padding) so SVG drawing aligns exactly
				finalX = tr.left - cr.left + borderLeft + padLeft;
				finalY = tr.top - cr.top + borderTop + padTop + 13;
				finalW = textareaWrapperRef.offsetWidth;
				finalH = textareaWrapperRef.offsetHeight;
			}
		} catch (err) {
			// fallback to editingX/Y
		}

		// Attempt to preserve visually-wrapped lines (textarea soft-wrapping)
		let finalText = editingText;
		try {
			if (textareaRef) {
				const cs = window.getComputedStyle(textareaRef);
				const fontSize = cs.fontSize || '14px';
				const fontFamily = cs.fontFamily || 'sans-serif';
				const fontWeight = cs.fontWeight || 'normal';
				const fontStyle = cs.fontStyle || '';
				const cssFont = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`.trim();

				// content width: clientWidth includes padding, so subtract left/right padding to get text area
				const padLeft = parseFloat(cs.paddingLeft || String(TEXT_PAD)) || TEXT_PAD;
				const padRight = parseFloat(cs.paddingRight || String(TEXT_PAD)) || TEXT_PAD;
				const contentWidth = Math.max(10, textareaRef.clientWidth - padLeft - padRight);

				finalText = wrapTextToWidth(editingText, contentWidth, cssFont);
			}
		} catch (err) {
			// ignore wrapping failures and fall back to raw text
		}

		// Determine whether anything meaningful changed compared to previous item
		let changed = false;
		if (!prevItem) changed = true; else {
			// compare text, geometry, and font properties
			if ((prevItem.text || '') !== finalText) changed = true;
			else if ((prevItem.width || 0) !== finalW) changed = true;
			else if ((prevItem.height || 0) !== finalH) changed = true;
			else if ((prevItem.x || 0) !== finalX) changed = true;
			else if ((prevItem.y || 0) !== finalY) changed = true;
		}

		// Apply update
		texts.update(arr => arr.map(t => t.id === id ? { ...t, text: finalText, width: finalW, height: finalH, x: finalX, y: finalY } : t));
		// DOM will update automatically

		editingText = '';
		// Only snapshot when something actually changed
		if (changed) snapshot();
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

		// capture an explicit start rect (or synthesize one if ref missing)
		try {
			if (textareaWrapperRef) {
				resizeStartRect = textareaWrapperRef.getBoundingClientRect();
			} else if (svgEl) {
				const cr = svgEl.getBoundingClientRect();
				// synthesize a rect from editingX/Y/W/H (editingX/Y are content origin)
				const left = cr.left + editingX - TEXT_BORDER - TEXT_PAD;
				const top = cr.top + editingY - TEXT_BORDER - TEXT_PAD;
				resizeStartRect = new DOMRect(left, top, editingWidth, editingHeight);
			} else {
				resizeStartRect = null;
			}
		} catch {
			resizeStartRect = null;
		}

		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', endResize);
	}

	function onResizeMove(e: PointerEvent) {
		if (!isResizing || !resizeSide || !resizeStartRect || !textareaWrapperRef || !svgEl) return;

		const canvasRect = svgEl.getBoundingClientRect();

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
			if (textareaWrapperRef && svgEl) {
				const tr = textareaWrapperRef.getBoundingClientRect();
				const cr = svgEl.getBoundingClientRect();
				// compute content origin using computed padding/border if available for pixel-perfect alignment
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

	// helper: handle keyboard activation of a text group (Enter/Space)
    function onTextGroupKeyDown(e: KeyboardEvent, t: any) {
        try {
            const k = e && (e as KeyboardEvent).key || '';
            if (selectedTool === 'selector' && (k === 'Enter' || k === ' ' || k === 'Spacebar')) {
                e.preventDefault();
                editText(t);
            }
        } catch (err) { /* ignore */ }
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
		// Ensure any active textarea edits are committed so the export includes current text
		try {
			if (editingId) finishEditing();
		} catch (err) {}

		if (typeof window === 'undefined') throw new Error('exportCanvasDataUrl: window is not defined');

		const usedScale = typeof scale === 'number' && isFinite(scale) && scale > 0 ? scale : (window.devicePixelRatio || 1);

		// Determine container size (CSS pixels)
		const containerRef = (containerEl || svgEl);
		if (!containerRef) throw new Error('exportCanvasDataUrl: canvas container not available');
		const containerRect = containerRef.getBoundingClientRect();
		const cssContainerW = Math.max(1, Math.round(containerRect.width));
		const cssContainerH = Math.max(1, Math.round(containerRect.height));
		const pxW = Math.max(1, Math.round(cssContainerW * usedScale));
		const pxH = Math.max(1, Math.round(cssContainerH * usedScale));

		// Helper to serialize an SVG element to a standalone SVG string with explicit width/height and xmlns
		function serializeSvg(svgNode: SVGElement | null, widthCssPx: number, heightCssPx: number) {
			if (!svgNode) return null;
			try {
				const clone = svgNode.cloneNode(true) as SVGElement;
				if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
				// Use CSS-pixel width/height for serialization so SVG rasterizes at expected aspect
				clone.setAttribute('width', String(Math.max(1, Math.round(widthCssPx))));
				clone.setAttribute('height', String(Math.max(1, Math.round(heightCssPx))));
				return new XMLSerializer().serializeToString(clone);
			} catch (err) {
				return null;
			}
		}

		// Find the base visualization SVG inside the container (vega-embed writes an svg inside containerEl)
		let baseSvg: SVGElement | null = null;
		try { if (containerEl) baseSvg = containerEl.querySelector('svg'); } catch (err) { baseSvg = null; }
		const overlaySvg = svgEl;

		// Compute bounding rects (CSS pixels). Fall back gracefully.
		let baseRect: DOMRect | null = null;
		try { baseRect = baseSvg ? baseSvg.getBoundingClientRect() : null; } catch (_) { baseRect = null; }
		let overlayRect: DOMRect | null = null;
		try { overlayRect = overlaySvg ? overlaySvg.getBoundingClientRect() : containerRect; } catch (_) { overlayRect = containerRect; }

		// Serialize SVGs using their own CSS sizes
		const baseSvgStr = baseRect ? serializeSvg(baseSvg, baseRect.width, baseRect.height) : null;
		const overlaySvgStr = overlayRect ? serializeSvg(overlaySvg, overlayRect.width, overlayRect.height) : null;

		if (!baseSvgStr && !overlaySvgStr) throw new Error('exportCanvasDataUrl: no SVG content found to export');

		// helper to load an SVG string into an Image
		function loadImageFromSvgString(svgString: string) {
			return new Promise<HTMLImageElement>((resolve, reject) => {
				try {
					const img = new Image();
					img.onload = () => resolve(img);
					img.onerror = () => reject(new Error('Failed to load SVG image for export'));
					img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
				} catch (err) { reject(err); }
			});
		}

		// create offscreen canvas
		const canvas = document.createElement('canvas');
		canvas.width = pxW;
		canvas.height = pxH;
		canvas.style.width = cssContainerW + 'px';
		canvas.style.height = cssContainerH + 'px';
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('exportCanvasDataUrl: failed to get 2D context');

		// Draw images in layer order: white background first, then base visualization, then overlays
		try {
			ctx.clearRect(0, 0, pxW, pxH);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, pxW, pxH);

			// Draw base visualization at its position relative to the container
			if (baseSvgStr && baseRect) {
				const img = await loadImageFromSvgString(baseSvgStr);
				const dstX = Math.round((baseRect.left - containerRect.left) * usedScale);
				const dstY = Math.round((baseRect.top - containerRect.top) * usedScale);
				const dstW = Math.max(1, Math.round(baseRect.width * usedScale));
				const dstH = Math.max(1, Math.round(baseRect.height * usedScale));
				ctx.drawImage(img, dstX, dstY, dstW, dstH);
			}

			// Draw overlay SVG at its position relative to the container (usually full-size)
			if (overlaySvgStr && overlayRect) {
				const img2 = await loadImageFromSvgString(overlaySvgStr);
				const dstX2 = Math.round((overlayRect.left - containerRect.left) * usedScale);
				const dstY2 = Math.round((overlayRect.top - containerRect.top) * usedScale);
				const dstW2 = Math.max(1, Math.round(overlayRect.width * usedScale));
				const dstH2 = Math.max(1, Math.round(overlayRect.height * usedScale));
				ctx.drawImage(img2, dstX2, dstY2, dstW2, dstH2);
			}
		} catch (err: any) {
			throw new Error('exportCanvasDataUrl: failed to rasterize SVG layers (possible cross-origin/tainted canvas): ' + (err && err.message ? err.message : String(err)));
		}

		try {
			const approxBytes = Math.ceil((pxW * pxH * 4) / 0.75);
			if (approxBytes > 6 * 1024 * 1024) {
				console.warn('exportCanvasDataUrl: exported image may be large (~' + Math.round(approxBytes / (1024 * 1024)) + ' MB). Consider reducing scale.');
			}
		} catch (_) {}

		try {
			return canvas.toDataURL(mime, quality as any);
		} catch (err: any) {
			throw new Error('exportCanvasDataUrl: failed to generate data URL (tainted canvas or other error): ' + (err && err.message ? err.message : String(err)));
		}
	}

	function handleSelectTool(e: CustomEvent) {
		selectedTool = e.detail;
	}

</script>

<style>
    /* intentionally left empty; no global styles here */
    .text-overlay:focus { outline: none; }
    .text-overlay { box-sizing: border-box; }
    .overlays { pointer-events: none; }
    .overlays.pointer-active { pointer-events: auto; }
    .handle { box-sizing: border-box; }

    /* Ensure common modal/dialog selectors sit above the canvas and overlays in all themes
   Force a very high z-index so third-party modals (Bootstrap, Bulma, native dialog, etc.)
   will render above the canvas. This avoids detecting modal state and is a minimal change. */
    :global(dialog[open]), :global(.modal), :global([role="dialog"]), :global(.modal-backdrop) {
        z-index: 100000 !important;
    }
</style>

<div class="box" style="height:100%; position:relative; display:flex; flex-direction:column;">

	<div class="content" style="flex:1 1 auto; min-height:0; position:relative; z-index:0;" bind:this={contentEl}>
		<div bind:this={containerEl} style="height:100%; width:100%; background:#fff; display:flex; align-items:center; justify-content:center; position:relative; pointer-events:auto; z-index:0;">
			{#if !$code}
				<p class="has-text-grey">Vega-Lite visualization preview will render here.</p>
			{/if}
		</div>
	</div>

	<div style="position:absolute; left:0; right:0; top:0; display:flex; justify-content:center; pointer-events:auto; width: 100%; padding: 20px 20px 0 20px; z-index:10000;">
		<CanvasToolbar selected={selectedTool} on:selectTool={handleSelectTool} on:undo={undo} on:redo={redo} />
	</div>

	<!-- Replace canvas with an SVG overlay that renders strokes and texts as DOM elements -->
	<svg bind:this={svgEl}
		style="position:absolute; left:0; top:0; right:0; bottom:0; width:100%; height:100%; pointer-events:auto; touch-action:none; z-index:30;"
		on:pointerdown={pointerDown}
		on:pointermove={pointerMove}
		on:pointerup={pointerUp}
		aria-label="Drawing SVG overlay">

		<defs>
			<!-- Placeholder for stroke markers / defs if needed -->
		</defs>

		<!-- render strokes as individual path elements so they can be selected/manipulated -->
		{#each $strokes as st, i (i)}
			<path
				d={strokeToPath(st)}
				fill="none"
				stroke="red"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				data-index={i}
				style="pointer-events: stroke;"
			/>
 		{/each}

 		<!-- Render non-editing texts as SVG <text> so they can be selected/moved if desired -->
		{#each $texts as t (t.id)}
			{#if t.id !== editingId}
				<g transform={`translate(${t.x}, ${t.y})`} style="pointer-events:auto; cursor: {selectedTool === 'selector' ? 'move' : 'default'};" role="button" tabindex="0" on:click={() => { if (selectedTool === 'selector') editText(t); }} on:keydown={(e) => onTextGroupKeyDown(e, t)}>
					<text font-size={t.fontSize ?? '14px'} font-family={t.fontFamily ?? 'sans-serif'} font-weight={t.fontWeight ?? 'normal'} font-style={t.fontStyle ?? ''} fill="#000">
						{#each (t.text || '').split('\n') as line, idx}
							{#if idx === 0}
								{line}
							{:else}
								<tspan x="0" dy="1.2em">{line}</tspan>
							{/if}
						{/each}
					</text>
				</g>
			{/if}
		{/each}

 	</svg>

 	<!-- overlays layer sits above the canvas; layer ignores pointer events except active textareas -->
 	<div class="overlays" class:pointer-active={editingId} style="position:absolute; left:0; top:0; right:0; bottom:0; z-index:31;">
 		{#each $texts as t (t.id)}
 			{#if t.id === editingId}
 				<div bind:this={textareaWrapperRef} style="position:absolute; pointer-events:auto; z-index:32;">
 					<textarea
 						bind:this={textareaRef}
 						class="text-overlay"
 						style={`position:relative; z-index:33; min-width:40px; min-height:20px; border:1px dashed rgba(0,0,0,0.35); background:transparent; padding:4px; color:#000; resize:none; caret-color: rgba(0,0,0,0.85); font: ${t.fontSize ?? '14px'} ${t.fontFamily ?? 'sans-serif'}; font-weight: ${t.fontWeight ?? 'normal'}; font-style: ${t.fontStyle ?? 'normal'};`}
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
 						on:pointerdown={(e) => {
 						 e.stopPropagation();
 						 // ensure textarea gets focus and caret placed where clicked
 						 try { textareaRef?.focus(); const pos = (textareaRef && typeof textareaRef.selectionStart === 'number') ? textareaRef.selectionStart : textareaRef?.value.length ?? 0; textareaRef?.setSelectionRange(pos, pos); } catch (err) {}
 						}}
 						></textarea>
 						<!-- resize handles: small circles at midpoints of each side -->
 						{#if editingId}
 							<!-- top -->
 							<div class="handle" on:pointerdown={(e) => startResize('top', e)} style="position:absolute; left:50%; transform:translateX(-50%); top:-6px; width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:n-resize; z-index:34; pointer-events:auto;"></div>
 							<!-- right -->
 							<div class="handle" on:pointerdown={(e) => startResize('right', e)} style="position:absolute; right:-6px; top:50%; transform:translateY(-50%); width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:e-resize; z-index:34; pointer-events:auto;"></div>
 							<!-- bottom -->
 							<div class="handle" on:pointerdown={(e) => startResize('bottom', e)} style="position:absolute; left:50%; transform:translateX(-50%); bottom:-6px; width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:s-resize; z-index:34; pointer-events:auto;"></div>
 							<!-- left -->
 							<div class="handle" on:pointerdown={(e) => startResize('left', e)} style="position:absolute; left:-6px; top:50%; transform:translateY(-50%); width:12px; height:12px; border-radius:50%; background:#333; opacity:0.95; cursor:w-resize; z-index:34; pointer-events:auto;"></div>
 						{/if}
 					</div>
 				{/if}
 			{/each}
 		</div>


</div>
