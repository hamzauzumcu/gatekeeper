// DeepSeek API client — OpenAI-compatible chat completions endpoint.
// Docs: https://api-docs.deepseek.com

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

// Abort a request that never responds. Without this, a hung connection inside a
// Durable Object alarm would block Promise.allSettled forever, stalling the whole
// sync job until the runtime kills the invocation (surfacing as "Network connection
// lost") and leaving the job permanently stuck.
const REQUEST_TIMEOUT_MS = 120_000

export type TextContent = { type: 'text'; text: string }
export type ImageContent = { type: 'image_url'; image_url: { url: string } }

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<TextContent | ImageContent>
}

export type DeepseekOptions = {
  model?: 'deepseek-v4-pro' | 'deepseek-v4-flash'
  temperature?: number
  maxTokens?: number
  /** if true, forces the model to return a JSON object */
  jsonMode?: boolean
  /** Reasoning (thinking) mode — enabled by default. Use 'disabled' for fast/cheap responses */
  thinking?: 'enabled' | 'disabled'
  /** reasoning intensity when thinking is enabled — defaults to 'high' */
  reasoningEffort?: 'high' | 'max'
}

export async function deepseekChat(
  apiKey: string,
  messages: ChatMessage[],
  options: DeepseekOptions = {}
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? 'deepseek-v4-pro',
        messages,
        temperature: options.temperature ?? 1,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(options.thinking
          ? {
              thinking: {
                type: options.thinking,
                ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
              },
            }
          : {}),
      }),
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`DeepSeek request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
    }
    throw e
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DeepSeek API ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  return data.choices[0].message.content
}
