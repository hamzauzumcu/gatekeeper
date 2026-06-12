// DeepSeek API istemcisi — OpenAI uyumlu chat completions endpoint'i.
// Docs: https://api-docs.deepseek.com

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type DeepseekOptions = {
  model?: 'deepseek-v4-pro' | 'deepseek-v4-flash'
  temperature?: number
  maxTokens?: number
  /** true verilirse model JSON object döndürmeye zorlanır */
  jsonMode?: boolean
  /** Reasoning (thinking) modu — varsayılan açık. Hızlı/ucuz cevap için 'disabled' */
  thinking?: 'enabled' | 'disabled'
  /** thinking açıkken reasoning yoğunluğu — varsayılan 'high' */
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
