import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

/**
 * Server-side OpenAI helper.
 * - Reads the API key from the private env (OPENAI_API_KEY)
 * - Sends a chat completion request and returns the assistant text
 */
export async function generateChanges(_payload: any): Promise<string> {
  const key = OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in your private environment.');
  }

  const model = OPENAI_MODEL ?? 'gpt-4o-mini';

  // For now we send a minimal instruction; the payload is ignored per current requirements.
  const messages = [
    {
      role: 'system',
      content:
        'You are an assistant that returns a single fenced code block containing the updated visualization spec. Return only the code block and do not add any additional explanation.'
    },
    { role: 'user', content: 'Please produce the updated visualization spec as a fenced code block.' }
  ];

  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1500
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  // Support both chat-style and legacy choices.text
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
  return content;
}
