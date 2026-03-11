// import type { RequestHandler } from '@sveltejs/kit';
// import { json } from '@sveltejs/kit';
// import {uploadColumnNames} from '$lib/server/openai';
//
// export const POST: RequestHandler = async ({ request }) => {
//   try {
//     const body = await request.json().catch(() => ({}));
//
//     let convId: number | null = null;
//     let columnNames: string[] | null = null;
//     if (body && typeof body === 'object') {
//       columnNames = body.columnNames ?? null
//       convId = body.convId
//     }
//
//     const result = await uploadColumnNames({ convId, columnNames });
//
//     return json({ ok: result });
//   } catch (err) {
//     const message = err instanceof Error ? err.message : String(err);
//     return json({ ok: false, error: message }, { status: 500 });
//   }
// };