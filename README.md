## Environment Setup

This project uses a server-side Anthropic API key for the "Apply Changes" feature.

- Copy `.env.example` to `.env`.
- Set `CLAUDE_API_KEY` to your key.
- Set `ANTHROPIC_WORKSPACE_ID` to your workspace ID.
- Do not commit `.env`.

## Running the project

To start a development server, run this command from the root directory:

```sh
npm run dev -- --host
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
