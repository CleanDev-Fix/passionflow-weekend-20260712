import { strToU8, zipSync } from 'fflate'

import type { CreatorReceipt, MediaAsset, MediaDerivative, PhotoAnalysis } from '../types'

interface ExportContents {
  projectName: string
  assets: MediaAsset[]
  analysis: PhotoAnalysis | null
  shareImage: Blob | null
  shareCaption: string
  receipt?: CreatorReceipt | null
  derivatives?: MediaDerivative[]
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'readwrite'; id?: string; startIn?: 'downloads' }) => Promise<FileSystemDirectoryHandle>
  }
}

function fileStem(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'passionflow-project'
}

export function createHandoffManifest(contents: ExportContents): string {
  const selectedAssets = contents.assets.filter((asset) => asset.selected)
  return JSON.stringify({
    format: 'PassionFlow handoff',
    formatVersion: 1,
    projectName: contents.projectName.trim(),
    selectedSources: selectedAssets.map((asset) => ({
      fileName: asset.file.name,
      mimeType: asset.file.type,
      sourceKind: asset.sourceKind,
    })),
    shareCaption: contents.shareCaption.trim(),
    photoPlan: contents.analysis,
    sourceFileCount: selectedAssets.length,
    editorResults: (contents.derivatives ?? []).map((derivative) => ({
      originalAssetId: derivative.originalAssetId,
      fileName: derivative.file.name,
      status: derivative.status,
      reworkNotes: derivative.reworkNotes,
    })),
    notice: 'Original files remain unchanged. This package contains user-approved selected files and the rendered share asset.',
  }, null, 2)
}

async function makeExportFiles(contents: ExportContents): Promise<Record<string, Uint8Array>> {
  const folder = fileStem(contents.projectName)
  const files: Record<string, Uint8Array> = {}
  const selectedAssets = contents.assets.filter((asset) => asset.selected)
  const manifest = createHandoffManifest(contents)

  await Promise.all(selectedAssets.map(async (asset, index) => {
    files[`${folder}/source/${String(index + 1).padStart(2, '0')}-${asset.file.name}`] = new Uint8Array(await asset.file.arrayBuffer())
  }))

  await Promise.all((contents.derivatives ?? []).filter((derivative) => derivative.status === 'approved').map(async (derivative, index) => {
    files[`${folder}/editor-results/approved/${String(index + 1).padStart(2, '0')}-${derivative.file.name}`] = new Uint8Array(await derivative.file.arrayBuffer())
  }))

  if (contents.shareImage) {
    files[`${folder}/share/${fileStem(contents.projectName)}-meme.png`] = new Uint8Array(await contents.shareImage.arrayBuffer())
    files[`${folder}/share/social-caption.txt`] = strToU8(contents.shareCaption.trim())
  }
  files[`${folder}/photo-plan.json`] = strToU8(JSON.stringify(contents.analysis, null, 2))
  files[`${folder}/manifest.json`] = strToU8(manifest)
  if (contents.receipt) {
    files[`${folder}/receipt.json`] = strToU8(JSON.stringify(contents.receipt, null, 2))
  }
  files[`${folder}/README.txt`] = strToU8('Created with PassionFlow. Source files remain unchanged in source/. Approved editor derivatives are separate files in editor-results/approved/. Use photo-plan.json for the reviewed edit plan and manifest.json for the decision record.')
  return files
}

export async function createExportZip(contents: ExportContents): Promise<{ blob: Blob; fileName: string }> {
  const files = await makeExportFiles(contents)
  return {
    blob: new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }),
    fileName: `${fileStem(contents.projectName)}-passionflow.zip`,
  }
}

export async function writeExportFolder(contents: ExportContents): Promise<string> {
  if (!window.showDirectoryPicker) {
    throw new Error('Folder delivery is not supported in this browser. Download the ZIP instead.')
  }

  const folder = await window.showDirectoryPicker({ id: 'passionflow-export', mode: 'readwrite', startIn: 'downloads' })
  const files = await makeExportFiles(contents)
  const root = await folder.getDirectoryHandle(fileStem(contents.projectName), { create: true })

  await Promise.all(Object.entries(files).map(async ([path, body]) => {
    const pathParts = path.split('/').slice(1)
    const name = pathParts.pop()
    if (!name) {
      return
    }

    let directory = root
    for (const part of pathParts) {
      directory = await directory.getDirectoryHandle(part, { create: true })
    }
    const handle = await directory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    const fileBytes = Uint8Array.from(body)
    await writable.write(fileBytes)
    await writable.close()
  }))

  return folder.name
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function sha256Hex(value: Blob | string): Promise<string> {
  const buffer = typeof value === 'string'
    ? new TextEncoder().encode(value).buffer
    : await value.arrayBuffer()
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
