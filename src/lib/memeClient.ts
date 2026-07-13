export interface MemeGenerationRequest {
  subject: string
  visualDirection: string
  tone: string
  reference?: File | null
  apiKey?: string
}

async function encodeReference(reference: File): Promise<{ id: string; name: string; mimeType: string; data: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not prepare the optional reference image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(reference)
  })

  return {
    id: crypto.randomUUID(),
    name: reference.name,
    mimeType: reference.type,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
  }
}

export async function generateMemeImage(request: MemeGenerationRequest): Promise<Blob> {
  const reference = request.reference ? await encodeReference(request.reference) : undefined
  const response = await fetch('/api/generate-meme-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: request.subject.trim(),
      visualDirection: request.visualDirection.trim(),
      tone: request.tone.trim(),
      reference,
      apiKey: request.apiKey?.trim() || undefined,
    }),
  })
  const body = await response.json().catch(() => ({})) as { error?: string; image?: { data: string; mimeType: string } }
  if (!response.ok || !body.image) {
    throw new Error(body.error || 'The image provider could not generate a meme visual.')
  }

  const bytes = Uint8Array.from(atob(body.image.data), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: body.image.mimeType })
}
