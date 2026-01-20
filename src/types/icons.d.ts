declare module 'svelte-fa' {
	import type { SvelteComponent } from 'svelte';
	export default class Fa extends SvelteComponent {
		// props
		constructor(options: any);
	}
}

declare module '@fortawesome/free-solid-svg-icons' {
	export const faUndo: any;
	export const faRedo: any;
	export const faPen: any;
	export const faPenAlt: any;
	export const faFont: any;
	export const faEraser: any;
	export const faSync: any;
	export const faSyncAlt: any;
}
