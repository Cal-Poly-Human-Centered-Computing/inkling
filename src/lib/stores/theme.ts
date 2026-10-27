import { readable } from 'svelte/store';

// true when the OS/browser prefers a dark color scheme; updates live when the preference changes
export const isDark = readable(false, (set) => {
  if (typeof window === 'undefined') return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  set(mq.matches);
  const onChange = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
});
