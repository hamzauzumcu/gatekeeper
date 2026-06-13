// OpenAI chat completions — used for scanned PDF parsing via GPT-4o file input.
// Docs: https://developers.openai.com/api/docs/guides/pdf-files

const OPENAI_BASE_URL = 'https://api.openai.com'

// Abort a request that never responds, so a hung connection can't stall a sync
// job's alarm loop indefinitely. See the same guard in deepseek.ts.
const REQUEST_TIMEOUT_MS = 120_000

export async function openaiParsePdf(
  apiKey: string,
  pdfBuffer: ArrayBuffer,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const bytes = new Uint8Array(pdfBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const base64 = btoa(binary)

  let res: Response
  try {
    res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: {
                  filename: 'cv.pdf',
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`OpenAI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
    }
    throw e
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${err}`)
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}
