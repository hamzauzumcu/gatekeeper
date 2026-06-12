// OpenAI chat completions — used for scanned PDF parsing via GPT-4o file input.
// Docs: https://developers.openai.com/api/docs/guides/pdf-files

const OPENAI_BASE_URL = 'https://api.openai.com'

export async function openaiParsePdf(apiKey: string, pdfBuffer: ArrayBuffer, prompt: string): Promise<string> {
  const bytes = new Uint8Array(pdfBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const base64 = btoa(binary)

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2048,
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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${err}`)
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}
