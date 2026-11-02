// Saves the editor page's state to localStorage, so it survives navigating away (e.g. to the dataset preview) and
// reloads: the editable part of the spec (the part below the read-only header; the editor rebuilds the header from the
// current dataset when it restores) and the canvas marks (Fabric JSON, without the rendered chart).

const SAVED_SPEC_KEY = 'app:editor:spec';
const SAVED_CANVAS_KEY = 'app:editor:canvas';

/** The saved editable part of the spec, or null if nothing was saved (or localStorage isn't available). */
export function loadSavedSpecBody(): string | null {
  try {
    return localStorage.getItem(SAVED_SPEC_KEY);
  } catch {
    return null;
  }
}

/** Saves the editable part of the spec, replacing what was saved before. */
export function saveSpecBody(body: string) {
  try {
    localStorage.setItem(SAVED_SPEC_KEY, body);
  } catch (err) {
    console.warn('savedSpec: failed to save the spec', err);
  }
}

/** The saved canvas marks (a CanvasView snapshot), or null if nothing was saved. */
export function loadSavedCanvas(): string | null {
  try {
    return localStorage.getItem(SAVED_CANVAS_KEY);
  } catch {
    return null;
  }
}

/** Saves the canvas marks, replacing what was saved before. A failed write (e.g. over quota) is only logged. */
export function saveCanvas(snapshot: string) {
  try {
    localStorage.setItem(SAVED_CANVAS_KEY, snapshot);
  } catch (err) {
    console.warn('savedEditor: failed to save the canvas', err);
  }
}
