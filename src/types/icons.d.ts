declare module 'svelte-fa' {
  import type { SvelteComponent } from 'svelte';
  export default class Fa extends SvelteComponent {}
}

declare module '@fortawesome/free-solid-svg-icons' {
  export const faUndo: any;
  export const faRedo: any;
  export const faPen: any;
  export const faFont: any;
  export const faEraser: any;
  export const faSync: any;
  export const faUpload: any;
  export const faDatabase: any;
}
