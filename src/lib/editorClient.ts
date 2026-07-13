import type { EditorProviderInfo, MediaAsset } from '../types'

async function encodeOriginalAsset(asset: MediaAsset): Promise<{ id: string; name: string; mimeType: string; data: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not prepare ${asset.file.name} for editor handoff.`))
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

export async function getEditorProvider(): Promise<EditorProviderInfo> {
  const response = await fetch('/api/editor-provider')
  if (!response.ok) {
    throw new Error('Editor provider status is unavailable.')
  }
  return await response.json() as EditorProviderInfo
}

export async function configureEditorProvider(configuration: { label: string; url: string; token: string }): Promise<EditorProviderInfo> {
  const response = await fetch('/api/editor-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(configuration),
  })
  const body = await response.json().catch(() => ({})) as EditorProviderInfo & { error?: string }
  if (!response.ok) {
    throw new Error(body.error || 'The editor API could not be configured.')
  }
  return body
}

export async function clearEditorProvider(): Promise<EditorProviderInfo> {
  const response = await fetch('/api/editor-provider', { method: 'DELETE' })
  if (!response.ok) {
    throw new Error('The editor API configuration could not be cleared.')
  }
  return await response.json() as EditorProviderInfo
}

export async function submitEditorHandoff(projectName: string, assets: MediaAsset[], manifest: Record<string, unknown>): Promise<{ provider: { label: string }; jobId: string | null }> {
  const response = await fetch('/api/editor-handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: projectName.trim(),
      assets: await Promise.all(assets.map(encodeOriginalAsset)),
      manifest,
    }),
  })
  const body = await response.json().catch(() => ({})) as { error?: string; provider?: { label: string }; jobId?: string | null }
  if (!response.ok || !body.provider) {
    throw new Error(body.error || 'The editor connector could not accept this handoff.')
  }
  return { provider: body.provider, jobId: body.jobId ?? null }
}
