// DeepSeek API client — OpenAI-compatible chat completions endpoint.
// Docs: https://api-docs.deepseek.com

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

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
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
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

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DeepSeek API ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  return data.choices[0].message.content
}
