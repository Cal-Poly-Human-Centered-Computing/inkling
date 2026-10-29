// Saves the editable part of the editor's spec to localStorage, so it survives navigating away (e.g. to the dataset
// preview) and reloads. Only the part below the read-only header is kept; the editor rebuilds the header from the
// current dataset when it restores.

const SAVED_SPEC_KEY = 'app:editor:spec';

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
