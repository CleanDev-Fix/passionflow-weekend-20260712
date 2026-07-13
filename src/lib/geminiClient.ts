import type { MediaAsset, PhotoAnalysis, UserEditBrief } from '../types'

const analysisImageMaxDimension = 1_280

async function toPayloadAsset(asset: MediaAsset): Promise<{ id: string; name: string; mimeType: string; data: string }> {
  let analysisFile = asset.file

  try {
    const bitmap = await createImageBitmap(asset.file)
    const longestSide = Math.max(bitmap.width, bitmap.height)
    if (longestSide > analysisImageMaxDimension) {
      const scale = analysisImageMaxDimension / longestSide
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (context) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .84))
        if (compressed) {
          analysisFile = new File([compressed], asset.file.name, { type: 'image/jpeg' })
        }
      }
    }
    bitmap.close()
  } catch {
    // The original file remains a valid analysis fallback for browser-unsupported formats.
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not prepare ${asset.file.name} for Gemini review.`))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(analysisFile)
  })

  return {
    id: asset.id,
    name: asset.file.name,
    mimeType: analysisFile.type,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
  }
}

async function toDerivativePayload(asset: MediaAsset): Promise<{ id: string; name: string; mimeType: string; data: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not prepare ${asset.file.name} for AI editing.`))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(asset.file)
  })

  return {
    id: asset.id,
    name: asset.file.name,
    mimeType: asset.file.type,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
  }
}

export async function analyseProjectPhotos(projectName: string, assets: MediaAsset[], userEditBrief: UserEditBrief, apiKey?: string, signal?: AbortSignal): Promise<PhotoAnalysis> {
  const selectedAssets = assets.filter((asset) => asset.selected).slice(0, 6)
  if (selectedAssets.length === 0) {
    throw new Error('Select at least one image before starting Gemini review.')
  }

  const response = await fetch('/api/analyse-photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: projectName.trim(),
      assets: await Promise.all(selectedAssets.map(toPayloadAsset)),
      apiKey: apiKey?.trim() || undefined,
      userEditBrief,
    }),
    signal,
  })

  const body = await response.json().catch(() => ({})) as PhotoAnalysis & { error?: string }
  if (!response.ok) {
    throw new Error(body.error || 'Gemini could not analyze these images. Keep working locally or try again.')
  }
  return body
}

export async function createPhotoDerivative(asset: MediaAsset, userEditBrief: UserEditBrief, instructions: string[], apiKey?: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/create-photo-derivative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: await toDerivativePayload(asset),
      desiredOutcome: userEditBrief.desiredOutcome,
      preservationConstraints: userEditBrief.preservationConstraints,
      instructions,
      apiKey: apiKey?.trim() || undefined,
    }),
    signal,
  })
  const body = await response.json().catch(() => ({})) as { error?: string; image?: { data: string; mimeType: string } }
  if (!response.ok || !body.image) {
    throw new Error(body.error || 'The AI editor could not create a derivative. Your original remains local.')
  }
  const bytes = Uint8Array.from(atob(body.image.data), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: body.image.mimeType })
}
