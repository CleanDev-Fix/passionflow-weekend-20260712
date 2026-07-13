import { describe, expect, it } from 'vitest'

import { createHandoffManifest, sha256Hex } from './exportPackage'
import { createReceiptPayload } from './solanaReceipt'
import type { MediaAsset, MediaDerivative } from '../types'

function sourceAsset(id: string, name: string, selected: boolean): MediaAsset {
  return {
    id,
    file: new File(['photo-bytes'], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
    sourceKind: 'image',
    selected,
  }
}

describe('PassionFlow export package', () => {
  it('creates a stable, selected-source-only handoff manifest without receipt metadata', () => {
    const manifest = JSON.parse(createHandoffManifest({
      projectName: 'Camera restoration',
      assets: [sourceAsset('selected', 'hero.png', true), sourceAsset('excluded', 'draft.png', false)],
      analysis: null,
      shareImage: new Blob(['rendered-image'], { type: 'image/png' }),
      shareCaption: 'A patient restoration update.',
    }))

    expect(manifest).toMatchObject({
      format: 'PassionFlow handoff',
      formatVersion: 1,
      projectName: 'Camera restoration',
      shareCaption: 'A patient restoration update.',
      sourceFileCount: 1,
      selectedSources: [{ fileName: 'hero.png', mimeType: 'image/png', sourceKind: 'image' }],
    })
    expect(manifest).not.toHaveProperty('receipt')
  })

  it('records editor outcomes separately from untouched original sources', () => {
    const derivative: MediaDerivative = {
      id: 'returned-edit',
      originalAssetId: 'selected',
      file: new File(['edited-bytes'], 'hero-edited.png', { type: 'image/png' }),
      previewUrl: 'blob:returned-edit',
      status: 'approved',
      reworkNotes: '',
    }
    const manifest = JSON.parse(createHandoffManifest({
      projectName: 'Camera restoration',
      assets: [sourceAsset('selected', 'hero.png', true)],
      analysis: null,
      shareImage: null,
      shareCaption: '',
      derivatives: [derivative],
    }))

    expect(manifest.editorResults).toEqual([{
      originalAssetId: 'selected',
      fileName: 'hero-edited.png',
      status: 'approved',
      reworkNotes: '',
    }])
    expect(manifest.selectedSources[0].fileName).toBe('hero.png')
  })

  it('hashes the exact final bytes with SHA-256', async () => {
    await expect(sha256Hex('PassionFlow')).resolves.toBe('26c02d9807246ff05f194b727d844057cd0e94f0f7899acdee88e7902e11cba1')
  })
})

describe('Solana Devnet receipt', () => {
  it('uses the fixed public-only PF1 receipt format', () => {
    expect(createReceiptPayload({
      creatorPublicKey: '11111111111111111111111111111111',
      finalImageSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      claimedUnixSeconds: 1_783_877_600,
    })).toBe(`PF1|1|11111111111111111111111111111111|${'a'.repeat(64)}|${'b'.repeat(64)}|1783877600`)
  })
})
