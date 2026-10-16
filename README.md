## Environment Setup

This project uses Supabase magic-link authentication and a server-side Anthropic API key for the "Apply Changes" feature.

- Copy `.env.example` to `.env`.
- Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from your Supabase project settings.
- Set `CLAUDE_API_KEY` to your key.
- Set `ANTHROPIC_WORKSPACE_ID` to your workspace ID.
- Do not commit `.env`.

In Supabase Authentication settings, enable the Email provider and add the local and deployed callback URLs:

```
http://localhost:5173/auth/callback
https://your-domain.example/auth/callback
```

The workspace requires users to sign in with a magic link. Users request a link at `/auth`, then return through the callback URL to enter the workspace.

## Running the project

To start a development server, run this command from the root directory:

```sh
npm run dev
```

Or, if you want to visit the site from a different device:

```sh
npm run dev -- --host
```

## Logging requests

To log a session, start the dev server with a label:

```sh
EVAL_RECORD=baseline npm run dev
```

Each request you make in the app is saved to `eval/runs/<timestamp>-baseline/`, one folder per request: `input.json`, the canvas image, and `result.json` with the model's observations and the resulting spec. `index.html` in the run folder shows every request side by side and is updated after each one.

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
