// import type { RequestHandler } from '@sveltejs/kit';
// import { json } from '@sveltejs/kit';
// import { initialize } from '$lib/server/server';
//
// export const POST: RequestHandler = async ({ request }) => {
//   try {
//     const body = await request.json().catch(() => ({}));
//
//     let columnNames: string[] | null = null;
//     let exampleRow: Record<string, any> | null = null;
//     if (body && typeof body === 'object') {
//       columnNames = body.columnNames ?? null
//       exampleRow = body.exampleRow ?? null;
//     }
//
//     const result = await initialize({ columnNames, exampleRow });
//     return json({ ok: true, result });
//   } catch (err) {
//     const message = err instanceof Error ? err.message : String(err);
//     return json({ ok: false, error: message }, { status: 500 });
//   }
// };
