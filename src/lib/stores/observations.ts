import { writable } from 'svelte/store';

// The model's observations from the latest Apply; null when the pipeline doesn't produce any
export const observations = writable<string | null>(null);
