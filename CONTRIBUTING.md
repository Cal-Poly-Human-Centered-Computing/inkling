# Contributing

Thanks for your interest in Inkling! This guide is written mainly for students joining the project, but anyone is welcome to contribute.

Inkling is a [SvelteKit](https://svelte.dev/docs/kit) web app.
A user edits a [Vega-Lite](https://vega.github.io/vega-lite/) spec in a code editor, sketches or annotates on a canvas, and/or types instructions in a chat box.
When they click **Apply Changes**, the server sends those inputs to Claude (Anthropic's language model), which returns an updated spec.

Two outside services are involved:

- **Supabase** is used for authentication sign-in. Users log in with a magic link sent to their email before they can use the workspace.
- **The Anthropic API** runs the model behind Apply Changes.

The project is generally organized as follows:

- `src/routes/+page.svelte`: the main workspace page.
- `src/lib/components/`: the editor, canvas, chat box and toolbars.
- `src/routes/api/apply-changes/`: the endpoint that Apply Changes calls.
- `src/lib/server/`: prompts and the pipeline that talks to the model.

## Setting up

You'll need [Node.js](https://nodejs.org/) (version 22 or later) and Git.

1. Clone the repository and install dependencies:

```sh
npm install
```

2. Copy `.env.example` to `.env`. This file holds your keys; never commit it.

3. Fill in the values in `.env`:

- **Students working with us:** Please talk to me (Ayaan) to get set up with API keys for Supabase and Anthropic.
- **Everyone else:** you'll need your own accounts.
  - `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`: create a free [Supabase](https://supabase.com/) project and copy these from its API settings. Then, under Authentication, enable the Email provider and add `http://localhost:5173/auth/callback` as a redirect URL.
  - `CLAUDE_API_KEY` and `ANTHROPIC_WORKSPACE_ID`: create these in the [Anthropic Console](https://console.anthropic.com/). Each Apply Changes request costs a small amount of API credit. We have gotten quite far by testing with about $10 of credits. 
  - `CLAUDE_MODEL`: the model to use.

## Running the app

Start the development server:

```sh
npm run dev
```

Then open <http://localhost:5173>. You'll be asked for your email; click the link you receive to get into the workspace. You should only need to do this once unless you change browsers or delete cookies.

To open the app from another device on your network (say, a tablet for sketching), run `npm run dev -- --host` instead. It will tell you a URL that you can access from your tablet.

## Running the tests

The tests are split into two groups:

- **Unit tests** (files ending in `.test.ts`) cover plain logic such as data loading and spec rendering. They run in Node and finish in a few seconds.
- **Browser tests** (files ending in `.browser.test.ts`) cover components and the canvas. They run in a real Firefox browser through Playwright, so they're slower: each one mounts the editor or canvas and waits for it to load.

The first time, install Firefox for Playwright:

```sh
npx playwright install firefox
```

Then:

```sh
npm run test:run      # run everything once
npm run test:unit     # only the unit tests (quick)
npm run test:browser  # only the browser tests (slower)
npm test              # watch mode: re-runs affected tests as you edit
```

While you're working, run the group that covers what you're changing.
Run everything once before opening a pull request.

The tests don't use any external services.

## Making changes

1. Create a branch off `dev`.

```sh
git checkout -b <your-new-feature>
```

2. Make your change, and add or update tests where it makes sense.
3. Run `npm run test:run` and make sure everything passes.
4. Open a pull request against the **`dev`** branch, not `main`. Briefly describe what you changed and how you checked it.

If you're not sure where to start, or whether a change is wanted, please feel free to ask.

## Logging requests

Request logging is a development tool for improving the prompts. Prompts that work well for standard charts can fail on more unusual visualizations, and there's no automatic way to tell whether a generated spec is good. So when you change a prompt or the pipeline, record a session of real requests (sketches, annotations, chat messages) and look at what the model produced: its observations, the resulting spec, any errors, and the review verdict. Recording similar sessions under different labels (say, `baseline` and your change) lets you compare them side by side.

To record a session, start the dev server with a label:

```sh
EVAL_RECORD=baseline npm run dev
```

Each request you make in the app is saved to `eval/runs/<timestamp>-baseline/`, one folder per request: `input.json`, the canvas image, and `result.json` with the model's observations and the resulting spec. `index.html` in the run folder shows every request side by side and is updated after each one.

Logging only happens on the dev server, and only when `EVAL_RECORD` is set. The `eval/runs` folder is gitignored, so recordings stay on your machine.
