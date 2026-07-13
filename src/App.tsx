import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import './App.css'
import { MemeStudio } from './components/MemeStudio'
import { createExportZip, createHandoffManifest, sha256Hex, triggerDownload, writeExportFolder } from './lib/exportPackage'
import { clearEditorProvider, configureEditorProvider, getEditorProvider, submitEditorHandoff } from './lib/editorClient'
import { analyseProjectPhotos, createPhotoDerivative } from './lib/geminiClient'
import { normaliseMediaFile } from './lib/media'
import { connectDevnetWallet, createDevnetCreatorReceipt } from './lib/solanaReceipt'
import { isDevnetWalletAvailable } from './lib/walletProvider'
import { renderShareCard } from './lib/shareCard'
import type { CreatorReceipt, EditorProviderInfo, MediaAsset, MediaDerivative, PhotoAnalysis, WorkflowStage } from './types'

const stages: Array<{ id: WorkflowStage; number: string; label: string }> = [
  { id: 'capture', number: '01', label: 'Ingest' },
  { id: 'shape', number: '02', label: 'Review' },
  { id: 'share', number: '03', label: 'Deliver' },
]

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const derivativeInputRef = useRef<HTMLInputElement>(null)
  const assetsRef = useRef<MediaAsset[]>([])
  const derivativesRef = useRef<MediaDerivative[]>([])
  const geminiAbortRef = useRef<AbortController | null>(null)
  const [projectName, setProjectName] = useState('Vintage camera restoration')
  const [editBrief, setEditBrief] = useState({ desiredOutcome: '', preservationConstraints: '' })
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null)
  const [topText, setTopText] = useState('')
  const [bottomText, setBottomText] = useState('')
  const [shareCaption, setShareCaption] = useState('')
  const [shareImage, setShareImage] = useState<Blob | null>(null)
  const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null)
  const [heroAssetId, setHeroAssetId] = useState<string | null>(null)
  const [derivatives, setDerivatives] = useState<MediaDerivative[]>([])
  const [derivativeTargetId, setDerivativeTargetId] = useState<string | null>(null)
  const [comparisonAssetId, setComparisonAssetId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'gemini' | 'applyEdits' | 'zip' | 'folder' | 'receipt' | 'editorSetup' | null>(null)
  const [busy, setBusy] = useState<'upload' | 'gemini' | 'imageEdit' | 'batchImageEdit' | 'render' | 'export' | 'editor' | 'receipt' | null>(null)
  const [batchEditProgress, setBatchEditProgress] = useState<{ completed: number; total: number } | null>(null)
  const [deliveryComplete, setDeliveryComplete] = useState(false)
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<CreatorReceipt | null>(null)
  const [receiptDraft, setReceiptDraft] = useState<{ imageHash: string; manifestHash: string } | null>(null)
  const [editorProvider, setEditorProvider] = useState<EditorProviderInfo | null>(null)
  const [editorSetup, setEditorSetup] = useState({ label: '', url: '', token: '' })
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function invalidateDelivery(): void {
    setDeliveryComplete(false)
    setReceipt(null)
    setReceiptDraft(null)
  }

  function beginGeminiRequest(): AbortController {
    geminiAbortRef.current?.abort()
    const controller = new AbortController()
    geminiAbortRef.current = controller
    return controller
  }

  function finishGeminiRequest(controller: AbortController): void {
    if (geminiAbortRef.current === controller) {
      geminiAbortRef.current = null
      setBusy(null)
    }
  }

  function resetPhotoProject(): void {
    geminiAbortRef.current?.abort()
    geminiAbortRef.current = null
    assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl))
    derivativesRef.current.forEach((derivative) => URL.revokeObjectURL(derivative.previewUrl))
    if (sharePreviewUrl) {
      URL.revokeObjectURL(sharePreviewUrl)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ''
    }
    if (derivativeInputRef.current) {
      derivativeInputRef.current.value = ''
    }
    setProjectName('New passion project')
    setEditBrief({ desiredOutcome: '', preservationConstraints: '' })
    setGeminiApiKey('')
    setAssets([])
    setAnalysis(null)
    setTopText('')
    setBottomText('')
    setShareCaption('')
    setShareImage(null)
    setSharePreviewUrl(null)
    setHeroAssetId(null)
    setDerivatives([])
    setDerivativeTargetId(null)
    setComparisonAssetId(null)
    setPendingAction(null)
    setBusy(null)
    setBatchEditProgress(null)
    setDeliveryComplete(false)
    setWalletPublicKey(null)
    setReceipt(null)
    setReceiptDraft(null)
    setError(null)
    setNotice('New project ready. Add photos or take a new one to begin again.')
  }

  const selectedAssets = useMemo(() => assets.filter((asset) => asset.selected), [assets])
  const sourceAsset = assets.find((asset) => asset.id === heroAssetId && asset.selected) ?? selectedAssets[0] ?? null
  const recommendedEditorAssets = useMemo(() => assets.filter((asset) => analysis?.photoAssessments.find((assessment) => assessment.assetId === asset.id)?.keep), [analysis, assets])
  const activeDerivative = derivatives.find((derivative) => derivative.originalAssetId === comparisonAssetId) ?? null
  const comparisonOriginal = assets.find((asset) => asset.id === activeDerivative?.originalAssetId) ?? null
  const activeStage: WorkflowStage = shareImage ? 'share' : analysis ? 'shape' : 'capture'

  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  useEffect(() => {
    derivativesRef.current = derivatives
  }, [derivatives])

  useEffect(() => () => {
    assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl))
  }, [])

  useEffect(() => () => {
    derivativesRef.current.forEach((derivative) => URL.revokeObjectURL(derivative.previewUrl))
  }, [])

  useEffect(() => () => {
    if (sharePreviewUrl) {
      URL.revokeObjectURL(sharePreviewUrl)
    }
  }, [sharePreviewUrl])

  useEffect(() => {
    getEditorProvider().then(setEditorProvider).catch(() => setEditorProvider(null))
  }, [])

  async function handleIncomingFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) {
      return
    }

    setBusy('upload')
    setError(null)
    setNotice(null)
    try {
      const incoming = await Promise.all(files.map(async (file) => {
        if (file.size > 4 * 1024 * 1024) {
          throw new Error(`${file.name} is over the 4 MB processing limit.`)
        }
        const normalised = await normaliseMediaFile(file)
        return {
          id: crypto.randomUUID(),
          file: normalised.file,
          previewUrl: URL.createObjectURL(normalised.file),
          sourceKind: normalised.sourceKind,
          selected: true,
        } satisfies MediaAsset
      }))
      setAssets((current) => [...current, ...incoming])
      setAnalysis(null)
      setShareImage(null)
      invalidateDelivery()
      setNotice(`${incoming.length} ${incoming.length === 1 ? 'source is' : 'sources are'} ready for review.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The selected files could not be prepared.')
    } finally {
      setBusy(null)
    }
  }

  function removeAsset(assetId: string): void {
    setAssets((current) => {
      const removed = current.find((asset) => asset.id === assetId)
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
      }
      return current.filter((asset) => asset.id !== assetId)
    })
    setDerivatives((current) => {
      current.filter((derivative) => derivative.originalAssetId === assetId).forEach((derivative) => URL.revokeObjectURL(derivative.previewUrl))
      return current.filter((derivative) => derivative.originalAssetId !== assetId)
    })
    setAnalysis(null)
    setShareImage(null)
    invalidateDelivery()
    if (heroAssetId === assetId) {
      setHeroAssetId(null)
    }
    if (comparisonAssetId === assetId) {
      setComparisonAssetId(null)
    }
  }

  function toggleAsset(assetId: string): void {
    setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, selected: !asset.selected } : asset))
    setAnalysis(null)
    setShareImage(null)
    invalidateDelivery()
  }

  function setDeliverySelection(assetId: string, selected: boolean): void {
    setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, selected } : asset))
    if (!selected && heroAssetId === assetId) {
      setHeroAssetId(null)
    }
    setShareImage(null)
    invalidateDelivery()
  }

  function chooseSharePhoto(assetId: string): void {
    setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, selected: true } : asset))
    setHeroAssetId(assetId)
    setShareImage(null)
    invalidateDelivery()
  }

  function startDerivativeImport(originalAssetId: string): void {
    setDerivativeTargetId(originalAssetId)
    derivativeInputRef.current?.click()
  }

  function handleReturnedEditorFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !derivativeTargetId) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Choose an image returned by your editor for comparison.')
      return
    }

    const nextDerivative: MediaDerivative = {
      id: crypto.randomUUID(),
      originalAssetId: derivativeTargetId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'returned',
      reworkNotes: '',
    }
    setDerivatives((current) => {
      current.filter((derivative) => derivative.originalAssetId === derivativeTargetId).forEach((derivative) => URL.revokeObjectURL(derivative.previewUrl))
      return [...current.filter((derivative) => derivative.originalAssetId !== derivativeTargetId), nextDerivative]
    })
    setComparisonAssetId(derivativeTargetId)
    setDerivativeTargetId(null)
    invalidateDelivery()
    setNotice(`Editor result added for comparison. The original ${file.name} remains unchanged.`)
  }

  function storeDerivative(nextDerivative: MediaDerivative): void {
    setDerivatives((current) => {
      current.filter((derivative) => derivative.originalAssetId === nextDerivative.originalAssetId).forEach((derivative) => URL.revokeObjectURL(derivative.previewUrl))
      return [...current.filter((derivative) => derivative.originalAssetId !== nextDerivative.originalAssetId), nextDerivative]
    })
  }

  async function requestAiDerivative(asset: MediaAsset, instructions: string[], signal: AbortSignal): Promise<MediaDerivative> {
    const image = await createPhotoDerivative(asset, editBrief, instructions, geminiApiKey, signal)
    const extension = image.type.split('/')[1] || 'png'
    const file = new File([image], `${asset.file.name.replace(/\.[^.]+$/, '')}-ai-derivative.${extension}`, { type: image.type })
    return {
      id: crypto.randomUUID(),
      originalAssetId: asset.id,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'returned',
      reworkNotes: '',
    }
  }

  async function createAiDerivative(asset: MediaAsset): Promise<void> {
    const instructions = analysis?.editInstructions.find((candidate) => candidate.assetId === asset.id)?.instructions ?? []
    if (!editBrief.desiredOutcome.trim() || instructions.length === 0) {
      setError('Describe what you want changed and build a photo plan before creating an AI derivative.')
      return
    }

    const controller = beginGeminiRequest()
    setBusy('imageEdit')
    setError(null)
    try {
      const nextDerivative = await requestAiDerivative(asset, instructions, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      storeDerivative(nextDerivative)
      setComparisonAssetId(asset.id)
      invalidateDelivery()
      setNotice('AI derivative ready for comparison. The original file remains unchanged.')
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'The AI editor could not create a derivative. Your original remains local.')
      }
    } finally {
      finishGeminiRequest(controller)
    }
  }

  async function createPlannedAiDerivatives(): Promise<void> {
    setPendingAction(null)
    const instructionsByAssetId = new Map(analysis?.editInstructions.map((item) => [item.assetId, item.instructions]) ?? [])
    const targets = assets.filter((asset) => analysis?.photoAssessments.some((assessment) => assessment.assetId === asset.id && assessment.keep) && (instructionsByAssetId.get(asset.id)?.length ?? 0) > 0)
    if (!editBrief.desiredOutcome.trim() || targets.length === 0) {
      setError('Gemini did not recommend any photos with editable instructions. Revise the brief and build a new plan.')
      return
    }

    const controller = beginGeminiRequest()
    setBusy('batchImageEdit')
    setBatchEditProgress({ completed: 0, total: targets.length })
    setError(null)
    let completed = 0
    let lastDerivativeAssetId: string | null = null
    const failedNames: string[] = []
    try {
      for (const asset of targets) {
        if (controller.signal.aborted) {
          return
        }
        try {
          const nextDerivative = await requestAiDerivative(asset, instructionsByAssetId.get(asset.id) ?? [], controller.signal)
          if (controller.signal.aborted) {
            return
          }
          storeDerivative(nextDerivative)
          completed += 1
          lastDerivativeAssetId = asset.id
        } catch {
          if (controller.signal.aborted) {
            return
          }
          failedNames.push(asset.file.name)
        } finally {
          if (!controller.signal.aborted) {
            setBatchEditProgress({ completed: completed + failedNames.length, total: targets.length })
          }
        }
      }
      setBatchEditProgress(null)
      if (completed > 0) {
        setComparisonAssetId(lastDerivativeAssetId)
        invalidateDelivery()
        setNotice(`${completed} AI ${completed === 1 ? 'derivative is' : 'derivatives are'} ready for review. Originals remain unchanged.`)
      }
      if (failedNames.length > 0) {
        setError(`Could not create ${failedNames.length} AI ${failedNames.length === 1 ? 'derivative' : 'derivatives'}: ${failedNames.join(', ')}. Other completed derivatives remain available.`)
      }
    } finally {
      finishGeminiRequest(controller)
    }
  }

  function setDerivativeDecision(derivativeId: string, status: MediaDerivative['status']): void {
    setDerivatives((current) => current.map((derivative) => derivative.id === derivativeId ? { ...derivative, status } : derivative))
    invalidateDelivery()
  }

  function updateDerivativeNotes(derivativeId: string, reworkNotes: string): void {
    setDerivatives((current) => current.map((derivative) => derivative.id === derivativeId ? { ...derivative, reworkNotes } : derivative))
  }

  function applyGeminiPlanToQueue(): void {
    if (!analysis) {
      return
    }

    const assessments = new Map(analysis.photoAssessments.map((assessment) => [assessment.assetId, assessment]))
    const suggestedHero = analysis.photoAssessments.find((assessment) => assessment.keep && assessment.role === 'hero')
      ?? analysis.photoAssessments.find((assessment) => assessment.keep)

    setAssets((current) => current.map((asset) => {
      const assessment = assessments.get(asset.id)
      return assessment ? { ...asset, selected: assessment.keep } : asset
    }))
    setHeroAssetId(suggestedHero?.assetId ?? null)
    if (sharePreviewUrl) {
      URL.revokeObjectURL(sharePreviewUrl)
    }
    setShareImage(null)
    setSharePreviewUrl(null)
    invalidateDelivery()
    setNotice(`Updated the editor queue with Gemini’s plan: ${analysis.photoAssessments.filter((assessment) => assessment.keep).length} photos are queued. Create AI derivatives separately when you are ready to spend your own API quota.`)
  }

  async function runGeminiAnalysis(): Promise<void> {
    const controller = beginGeminiRequest()
    setPendingAction(null)
    setBusy('gemini')
    setError(null)
    setNotice(null)
    try {
      const result = await analyseProjectPhotos(projectName, assets, editBrief, geminiApiKey, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setAnalysis({ ...result, userEditBrief: editBrief })
      const suggestedHero = result.photoAssessments.find((assessment) => assessment.keep && assessment.role === 'hero')
        ?? result.photoAssessments.find((assessment) => assessment.keep)
      setHeroAssetId(suggestedHero?.assetId ?? null)
      invalidateDelivery()
      const concept = result.memeConcepts[0]
      if (concept) {
        setTopText(concept.topText)
        setBottomText(concept.bottomText)
        setShareCaption(concept.caption)
      }
      setNotice('Gemini review is ready. Every suggestion remains editable.')
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Gemini review was unavailable.')
      }
    } finally {
      finishGeminiRequest(controller)
    }
  }

  async function renderCard(): Promise<void> {
    if (!sourceAsset) {
      setError('Select one source image for the share card first.')
      return
    }

    setBusy('render')
    setError(null)
    try {
      const nextImage = await renderShareCard(sourceAsset.file, topText, bottomText)
      if (sharePreviewUrl) {
        URL.revokeObjectURL(sharePreviewUrl)
      }
      setShareImage(nextImage)
      setSharePreviewUrl(URL.createObjectURL(nextImage))
      invalidateDelivery()
      setNotice('Share card rendered locally. Review it before you export or create a receipt.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The share card could not be rendered.')
    } finally {
      setBusy(null)
    }
  }

  function removeRenderedCard(): void {
    if (!sharePreviewUrl) {
      return
    }
    URL.revokeObjectURL(sharePreviewUrl)
    setShareImage(null)
    setSharePreviewUrl(null)
    invalidateDelivery()
    setNotice('Rendered share card removed. Your source photo and caption stay in place for another render.')
  }

  async function completeExport(): Promise<void> {
    if (!pendingAction || selectedAssets.length === 0) {
      return
    }

    const mode = pendingAction
    setPendingAction(null)
    setBusy('export')
    setError(null)
    try {
      const contents = { projectName, assets, analysis, shareImage, shareCaption, receipt, derivatives }
      if (mode === 'folder') {
        const folderName = await writeExportFolder(contents)
        setNotice(`Sent ${selectedAssets.length} queued originals, the photo plan, and any approved editor results to ${folderName}.`)
      } else {
        const archive = await createExportZip(contents)
        triggerDownload(archive.blob, archive.fileName)
        setNotice('Your editor-ready ZIP download has started.')
      }
      setDeliveryComplete(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The export could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  async function sendToConfiguredEditor(): Promise<void> {
    if (!editorProvider?.configured || selectedAssets.length === 0) {
      return
    }

    setBusy('editor')
    setError(null)
    try {
      const manifest = JSON.parse(createHandoffManifest({ projectName, assets, analysis, shareImage, shareCaption, receipt, derivatives })) as Record<string, unknown>
      const result = await submitEditorHandoff(projectName, selectedAssets, manifest)
      setNotice(`Sent ${selectedAssets.length} originals and their approved instructions to ${result.provider.label}${result.jobId ? ` · job ${result.jobId}` : ''}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The editor connector could not accept this handoff.')
    } finally {
      setBusy(null)
    }
  }

  function openEditorSetup(): void {
    setError(null)
    setEditorSetup((current) => ({
      ...current,
      label: current.label || (editorProvider?.configured ? editorProvider.label : 'My editor'),
    }))
    setPendingAction('editorSetup')
  }

  async function saveEditorProvider(): Promise<void> {
    setBusy('editor')
    setError(null)
    try {
      const provider = await configureEditorProvider(editorSetup)
      setEditorProvider(provider)
      setEditorSetup((current) => ({ ...current, token: '' }))
      setPendingAction(null)
      setNotice(`${provider.label} is ready for approved photo handoffs in this local server session.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The editor API could not be configured.')
    } finally {
      setBusy(null)
    }
  }

  async function removeEditorProvider(): Promise<void> {
    setBusy('editor')
    setError(null)
    try {
      const provider = await clearEditorProvider()
      setEditorProvider(provider)
      setEditorSetup((current) => ({ ...current, token: '' }))
      setNotice(provider.configured ? `Removed the temporary setup. ${provider.label} remains available from the server environment.` : 'Editor API setup removed from this local server session.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The editor API configuration could not be cleared.')
    } finally {
      setBusy(null)
    }
  }

  async function connectCreatorWallet(): Promise<void> {
    setBusy('receipt')
    setError(null)
    try {
      const publicKey = await connectDevnetWallet()
      setWalletPublicKey(publicKey)
      setNotice('Devnet wallet connected. Review the public receipt fields before you authorize a transaction.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Wallet connection was canceled. No receipt was created.')
    } finally {
      setBusy(null)
    }
  }

  async function prepareReceipt(): Promise<void> {
    if (!shareImage || !walletPublicKey) {
      return
    }

    setBusy('receipt')
    setError(null)
    try {
      const contents = { projectName, assets, analysis, shareImage, shareCaption, receipt: null, derivatives }
      const [imageHash, manifestHash] = await Promise.all([
        sha256Hex(shareImage),
        sha256Hex(createHandoffManifest(contents)),
      ])
      setReceiptDraft({ imageHash, manifestHash })
      setPendingAction('receipt')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The public receipt fields could not be prepared.')
    } finally {
      setBusy(null)
    }
  }

  async function completeReceipt(): Promise<void> {
    if (!walletPublicKey || !receiptDraft) {
      return
    }

    setPendingAction(null)
    setBusy('receipt')
    setError(null)
    try {
      const nextReceipt = await createDevnetCreatorReceipt({
        creatorPublicKey: walletPublicKey,
        finalImageSha256: receiptDraft.imageHash,
        manifestSha256: receiptDraft.manifestHash,
      })
      setReceipt(nextReceipt)
      setNotice('Devnet creator receipt confirmed. Download the updated editor pack to include receipt.json.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No devnet receipt was created. Your local handoff is unchanged.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PassionFlow home">
          <span className="brand-mark" aria-hidden="true"><span className="flowfinder-iris"></span><span className="flowfinder-notch notch-one"></span><span className="flowfinder-notch notch-two"></span><span className="flowfinder-focus"></span></span>
          <span>PassionFlow</span>
        </a>
        <nav className="mode-nav" aria-label="PassionFlow modes"><a href="#photo-flow">Photo Flow</a><a href="#meme-studio">Meme Studio</a></nav>
        <span className="local-status"><span aria-hidden="true"></span> Local-first</span>
      </header>
      <section className="hero" id="top">
        <div className="eyebrow">The optical bench</div>
        <h1>Make the image. Keep the decision.</h1>
        <p>Run a deliberate photo workflow, or turn a moment into a meme visual—without turning your work into a chat thread.</p>
      </section>

      <nav className="stage-nav" aria-label="Workflow steps">
        {stages.map((stage) => (
          <div className={`stage ${activeStage === stage.id ? 'active' : ''}`} key={stage.id}>
            <span>{stage.number}</span>
            <strong>{stage.label}</strong>
          </div>
        ))}
      </nav>

      <section className="project-bar" aria-label="Project details">
        <div>
          <label htmlFor="project-name">Passion project</label>
          <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={80} />
        </div>
        <div className="project-actions">
          <p>Nothing leaves this device until you confirm analysis, an export, or an optional receipt.</p>
          <button type="button" className="button secondary" onClick={resetPhotoProject}>Start new project</button>
        </div>
      </section>

      {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
      {error && <div className="notice error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      <section className="work-grid" id="photo-flow">
        <section className="panel capture-panel" aria-labelledby="sources-heading">
          <div className="panel-heading">
            <div>
              <span className="section-number">01</span>
              <h2 id="sources-heading">Gather your source material</h2>
            </div>
            <span className="asset-count">{selectedAssets.length} selected</span>
          </div>
          <p className="panel-description">Choose photos, screenshots, or a PDF. PDFs are converted locally to their first page for this demo.</p>

          <div className="upload-actions">
            <button type="button" className="button primary" onClick={() => fileInputRef.current?.click()} disabled={busy === 'upload'}>
              {busy === 'upload' ? 'Preparing files…' : 'Choose files'}
            </button>
            <button type="button" className="button secondary" onClick={() => cameraInputRef.current?.click()} disabled={busy === 'upload'}>
              Take a photo
            </button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*,application/pdf" multiple onChange={handleIncomingFiles} />
            <input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={handleIncomingFiles} />
            <input ref={derivativeInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleReturnedEditorFile} />
          </div>

          {assets.length === 0 ? (
            <div className="empty-sources">
              <div className="empty-orbit" aria-hidden="true"></div>
              <strong>Start with a moment from your project.</strong>
              <p>Restoration, studio session, collection, garden, or whatever you care about making.</p>
            </div>
          ) : (
            <ul className="asset-grid" aria-label="Selected sources">
              {assets.map((asset) => (
                <li className={`asset-card ${asset.selected ? 'selected' : ''}`} key={asset.id}>
                  <img src={asset.previewUrl} alt={`Preview of ${asset.file.name}`} />
                  <div className="asset-card-actions">
                    <label><input type="checkbox" checked={asset.selected} onChange={() => toggleAsset(asset.id)} /> Include</label>
                    <button type="button" onClick={() => removeAsset(asset.id)} aria-label={`Remove ${asset.file.name}`}>×</button>
                  </div>
                  <span>{asset.sourceKind === 'pdf' ? 'PDF · Page 1' : 'Image'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="panel insight-panel" aria-labelledby="insight-heading">
          <div className="panel-heading">
            <div>
              <span className="section-number">02</span>
              <h2 id="insight-heading">AI editorial plan</h2>
            </div>
            <span className="gemini-badge">Photo reasoning</span>
          </div>
          <p className="panel-description">Describe the outcome first. The planner turns your request into photo roles, safeguards, and an editable brief.</p>
          <div className="photo-edit-brief">
            <label htmlFor="desired-outcome">What would you like done?</label>
            <textarea id="desired-outcome" value={editBrief.desiredOutcome} onChange={(event) => { setEditBrief((current) => ({ ...current, desiredOutcome: event.target.value })); if (analysis) setAnalysis(null) }} placeholder="Clean listing photos with even light and a simple background." rows={3} maxLength={420} />
            <label htmlFor="preservation-constraints">What must stay true?</label>
            <textarea id="preservation-constraints" value={editBrief.preservationConstraints} onChange={(event) => { setEditBrief((current) => ({ ...current, preservationConstraints: event.target.value })); if (analysis) setAnalysis(null) }} placeholder="Keep colors, labels, wear, and all meaningful details honest." rows={3} maxLength={420} />
          </div>
          <div className="api-key-entry">
            <label htmlFor="gemini-api-key">Your Gemini API key <span>required for public use</span></label>
            <input id="gemini-api-key" type="password" autoComplete="off" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder="Used only for this request" maxLength={1024} />
            <p>Kept only in this tab’s memory. It is not saved, exported, logged, or shared with other users. A local development server can use its separately configured key.</p>
          </div>
          <button type="button" className="button primary full" disabled={selectedAssets.length === 0 || busy === 'gemini'} onClick={() => setPendingAction('gemini')}>
            {busy === 'gemini' ? 'Building photo plan…' : 'Build photo plan'}
          </button>
          <p className="consent-hint">Only the selected sources and your project name are sent after you confirm.</p>
          {busy === 'gemini' && <div className="analysis-pending" role="status">Building a plan for {selectedAssets.length} selected {selectedAssets.length === 1 ? 'photo' : 'photos'}… your local queue stays editable.</div>}
          {batchEditProgress && <div className="analysis-pending" role="status">Creating AI derivatives: {batchEditProgress.completed} of {batchEditProgress.total} complete. Originals remain unchanged.</div>}

          {analysis ? (
            <div className="analysis-result">
              <p className="analysis-summary">{analysis.photoAssessments.filter((assessment) => assessment.keep).length} of {analysis.photoAssessments.length} photos are recommended for the editor queue.</p>
              <p className="editor-needed-summary"><strong>Needs editor work · {recommendedEditorAssets.length}</strong>{recommendedEditorAssets.length > 0 ? <span>{recommendedEditorAssets.map((asset) => asset.file.name).join(' · ')}</span> : <span>No photos are recommended for editor handoff.</span>}</p>
              <button type="button" className="button secondary full" disabled={busy === 'batchImageEdit'} onClick={applyGeminiPlanToQueue}>Apply plan to editor queue</button>
              <button type="button" className="button primary full" disabled={busy === 'imageEdit' || busy === 'batchImageEdit'} onClick={() => setPendingAction('applyEdits')}>{busy === 'batchImageEdit' ? 'Creating planned AI derivatives…' : 'Create AI derivatives from plan'}</button>
              <p className="consent-hint">The queue action only selects originals for handoff. Creating derivatives is a separate, confirmed request that uses your own Gemini API quota; originals are never changed.</p>
              {analysis.privacyNotice && <p className="privacy-note">{analysis.privacyNotice}</p>}
            </div>
          ) : (
            <div className="manual-path"><strong>Gemini is your photo planner.</strong><p>It evaluates every selected image, then you decide what is sent to your editor.</p></div>
          )}
        </aside>
      </section>

      {analysis && (
        <section className="triage-workbench panel" aria-labelledby="triage-heading">
          <div className="workspace-intro">
            <div>
              <span className="section-number">02.1</span>
              <h2 id="triage-heading">Review every photo before it leaves your device.</h2>
            </div>
            <div className="triage-actions">
              <p>Green is Gemini’s editing recommendation. Blue is the current export queue. Queueing originals does not create an edit; use the confirmed derivative action when you want generated results.</p>
              <button type="button" className="button primary" disabled={busy === 'batchImageEdit'} onClick={applyGeminiPlanToQueue}>Apply plan to queue</button>
            </div>
          </div>

          <div className="triage-grid">
            {assets.map((asset) => {
              const assessment = analysis.photoAssessments.find((candidate) => candidate.assetId === asset.id)
              const instructions = analysis.editInstructions.find((candidate) => candidate.assetId === asset.id)?.instructions ?? []
              const derivative = derivatives.find((candidate) => candidate.originalAssetId === asset.id)
              const isHero = sourceAsset?.id === asset.id
              const needsEditorWork = Boolean(assessment?.keep)
              return (
                <article className={`triage-card ${asset.selected ? 'queued' : 'skipped'} ${needsEditorWork ? 'needs-editor-work' : 'no-editor-work'} ${isHero ? 'hero-selected' : ''}`} key={asset.id}>
                  <div className="triage-image">
                    <img src={asset.previewUrl} alt={`Review ${asset.file.name}`} />
                    {isHero && <span className="hero-chip">Share photo</span>}
                  </div>
                  <div className="triage-card-body">
                    <div className="triage-card-heading">
                      <span className={`role-badge ${assessment?.role ?? 'supporting'}`}>{assessment?.role ?? 'unreviewed'}</span>
                      <span className={`edit-status ${needsEditorWork ? 'needs-edit' : 'leave-local'}`}>{needsEditorWork ? asset.selected ? 'Needs editor work' : 'Needs editor work · not queued' : 'Keep local'}</span>
                      <span className={`queue-badge ${asset.selected ? 'ready' : 'skip'}`}>{asset.selected ? 'Current queue' : 'Not queued'}</span>
                    </div>
                    <p className="triage-reason">{assessment?.reason ?? 'No Gemini recommendation yet.'}</p>
                    {assessment?.issue && assessment.issue !== 'none' && <p className="triage-issue">Watch for: {assessment.issue}</p>}
                    {instructions.length > 0 && (
                      <ul className="edit-instructions">
                        {instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                      </ul>
                    )}
                    <div className="triage-controls">
                      <button type="button" className="button secondary" onClick={() => chooseSharePhoto(asset.id)}>{isHero ? 'Share photo selected' : 'Use as share photo'}</button>
                      <button type="button" className="text-action" onClick={() => setDeliverySelection(asset.id, !asset.selected)}>{asset.selected ? 'Skip from editor handoff' : 'Queue for editor'}</button>
                      {needsEditorWork && <button type="button" className="button dark" disabled={busy === 'imageEdit' || busy === 'batchImageEdit'} onClick={() => createAiDerivative(asset)}>{busy === 'imageEdit' ? 'Creating AI derivative…' : 'Create AI derivative'}</button>}
                      {derivative ? (
                        <button type="button" className="text-action" onClick={() => setComparisonAssetId(asset.id)}>Review returned edit · {derivative.status.replace('_', ' ')}</button>
                      ) : (
                        <button type="button" className="text-action" onClick={() => startDerivativeImport(asset.id)}>Add editor result for comparison</button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {activeDerivative && comparisonOriginal && (
        <section className="comparison-workbench panel" aria-labelledby="comparison-heading">
          <div className="workspace-intro">
            <div>
              <span className="section-number">02.2</span>
              <h2 id="comparison-heading">Compare the original with the editor result.</h2>
            </div>
            <p>The source never changes. Approve the derivative, keep the original, or request another pass with notes.</p>
          </div>
          <div className="comparison-grid">
            <figure>
              <img src={comparisonOriginal.previewUrl} alt={`Original ${comparisonOriginal.file.name}`} />
              <figcaption>Original · preserved</figcaption>
            </figure>
            <figure>
              <img src={activeDerivative.previewUrl} alt={`Editor result for ${comparisonOriginal.file.name}`} />
              <figcaption>Editor result · {activeDerivative.status.replace('_', ' ')}</figcaption>
            </figure>
          </div>
          <div className="comparison-actions">
            <label htmlFor="rework-notes">Notes for the next pass</label>
            <textarea id="rework-notes" value={activeDerivative.reworkNotes} onChange={(event) => updateDerivativeNotes(activeDerivative.id, event.target.value)} placeholder="Explain exactly what should change. Originals remain untouched." rows={3} maxLength={420} />
            <div className="decision-actions">
              <button type="button" className="button primary" onClick={() => { setDerivativeDecision(activeDerivative.id, 'approved'); setNotice('Derivative approved. The original remains preserved in the handoff.') }}>Approve derivative</button>
              <button type="button" className="button secondary" onClick={() => { setDerivativeDecision(activeDerivative.id, 'keep_original'); setNotice('Original kept. The returned derivative remains available for comparison.') }}>Keep original</button>
              <button type="button" className="button secondary" onClick={() => { setDerivativeDecision(activeDerivative.id, 'rework_requested'); setNotice('Rework requested. Export or send the notes to your connected editor for the next pass.') }}>Send back with notes</button>
              <button type="button" className="text-action" onClick={() => startDerivativeImport(comparisonOriginal.id)}>Import a new editor result</button>
            </div>
          </div>
        </section>
      )}

      <section className="share-workspace panel" aria-labelledby="share-heading">
        <div className="workspace-intro">
          <div>
            <span className="section-number">03</span>
            <h2 id="share-heading">Optional: turn the selected photo into a share card.</h2>
          </div>
          <p>This is a secondary output. The actual workflow outcome is the editor queue above.</p>
        </div>

        <div className="share-grid">
          <section className="copy-editor" aria-label="Share card copy">
            {analysis?.memeConcepts.length ? (
              <div className="concept-row">
                {analysis.memeConcepts.slice(0, 3).map((concept) => (
                  <button type="button" className="concept-chip" key={concept.id} onClick={() => {
                    setTopText(concept.topText)
                    setBottomText(concept.bottomText)
                    setShareCaption(concept.caption)
                  }}>{concept.title}</button>
                ))}
              </div>
            ) : null}
            <label htmlFor="top-text">Top line</label>
            <input id="top-text" value={topText} onChange={(event) => setTopText(event.target.value)} placeholder="WHEN THE PROJECT FINALLY…" maxLength={90} />
            <label htmlFor="bottom-text">Bottom line</label>
            <input id="bottom-text" value={bottomText} onChange={(event) => setBottomText(event.target.value)} placeholder="…STARTS LOOKING LIKE A PLAN" maxLength={90} />
            <label htmlFor="social-caption">Post caption</label>
            <textarea id="social-caption" value={shareCaption} onChange={(event) => setShareCaption(event.target.value)} placeholder="Tell the project story in your own words." rows={5} maxLength={420} />
            <button type="button" className="button dark full" disabled={!sourceAsset || busy === 'render'} onClick={renderCard}>
              {busy === 'render' ? 'Rendering share card…' : 'Render share card'}
            </button>
            {sharePreviewUrl && <button type="button" className="button secondary full" onClick={removeRenderedCard}>Remove rendered card</button>}
          </section>

          <section className="share-preview" aria-label="Rendered share card preview">
            {sharePreviewUrl ? <img src={sharePreviewUrl} alt="Rendered project share card" /> : sourceAsset ? <img className="source-preview" src={sourceAsset.previewUrl} alt={`Selected source: ${sourceAsset.file.name}`} /> : <div className="preview-placeholder"><span>PF</span><p>Your finished project update lands here.</p></div>}
            <div className="preview-label"><span>Share card</span><strong>{projectName || 'Untitled project'}</strong></div>
          </section>
        </div>
      </section>

      <MemeStudio
        apiKey={geminiApiKey}
        onError={setError}
        onNotice={setNotice}
        onUseForReceipt={(image, caption) => {
          setShareImage(image)
          setShareCaption(caption)
          invalidateDelivery()
          setNotice('Meme selected for an optional Solana Devnet creator receipt. Complete a local handoff first; the receipt is never required.')
        }}
      />

      <section className="delivery-strip" aria-labelledby="delivery-heading">
        <div>
          <span className="section-number">04</span>
          <h2 id="delivery-heading">Hand off the approved photo queue.</h2>
          <p>{selectedAssets.length} original {selectedAssets.length === 1 ? 'photo is' : 'photos are'} queued. Approved editor results stay separate; originals are always preserved.</p>
        </div>
        <div className="delivery-actions">
          <button type="button" className="button secondary" disabled={selectedAssets.length === 0 || busy === 'export'} onClick={() => setPendingAction('folder')}>Send queue to folder</button>
          <button type="button" className="button primary" disabled={selectedAssets.length === 0 || busy === 'export'} onClick={() => setPendingAction('zip')}>Download editor queue</button>
          {editorProvider?.configured && <button type="button" className="button primary" disabled={selectedAssets.length === 0 || busy === 'editor'} onClick={sendToConfiguredEditor}>{busy === 'editor' ? `Sending to ${editorProvider.label}…` : `Send to ${editorProvider.label}`}</button>}
          <button type="button" className="button secondary" disabled={busy === 'editor'} onClick={openEditorSetup}>{editorProvider?.configured ? 'Change editor API' : 'Set up editor API'}</button>
          <span className="api-slot">{editorProvider?.configured ? `${editorProvider.label} is configured for this local server session.` : 'Connect a custom editor endpoint. Tokens are held only by this local server.'}</span>
        </div>
      </section>

      {deliveryComplete && (
        <section className="receipt-panel" aria-labelledby="receipt-heading">
          <div>
            <span className="section-number">Optional provenance</span>
            <h2 id="receipt-heading">Create a devnet creator receipt.</h2>
            <p>A public Devnet receipt can bind your wallet authorization to hashes of this final share image and handoff manifest. It never uploads your image, caption, project name, prompt, or private key.</p>
          </div>
          {receipt ? (
            <div className="receipt-success">
              <strong>Devnet receipt confirmed</strong>
              <code>{receipt.transactionSignature}</code>
              <div className="receipt-actions">
                <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">View public transaction</a>
                <button type="button" onClick={() => triggerDownload(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }), `${projectName.trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'passionflow'}-receipt.json`)}>Download receipt.json</button>
              </div>
            </div>
          ) : walletPublicKey ? (
            <div className="receipt-action">
              <span>Connected: {walletPublicKey.slice(0, 6)}…{walletPublicKey.slice(-4)} · Devnet</span>
              <button type="button" className="button secondary" disabled={busy === 'receipt'} onClick={prepareReceipt}>{busy === 'receipt' ? 'Preparing receipt…' : 'Review public receipt'}</button>
            </div>
          ) : isDevnetWalletAvailable() ? (
            <div className="receipt-action">
              <span>Experimental and optional. Your local handoff is already complete.</span>
              <button type="button" className="button secondary" disabled={busy === 'receipt'} onClick={connectCreatorWallet}>Connect devnet wallet</button>
            </div>
          ) : (
            <p className="receipt-unavailable">A compatible browser wallet is needed for an optional Devnet receipt. Your local handoff is complete without one.</p>
          )}
        </section>
      )}

      <footer className="footer-note"><span>PassionFlow</span><p>Built for the work you care enough to share.</p></footer>

      {pendingAction === 'gemini' && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gemini-consent-title">
            <span className="modal-kicker">Confirm Gemini review</span>
            <h2 id="gemini-consent-title">Send {selectedAssets.length} selected {selectedAssets.length === 1 ? 'source' : 'sources'} for analysis?</h2>
            <p>Gemini receives the selected images and project name to suggest photo roles, a non-destructive edit brief, and share ideas. Do not include confidential documents, private identifiers, or images you do not have permission to process.</p>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPendingAction(null)}>Keep local</button><button type="button" className="button primary" onClick={runGeminiAnalysis}>Continue to Gemini</button></div>
          </section>
        </div>
      )}

      {pendingAction === 'applyEdits' && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="apply-edits-title">
            <span className="modal-kicker">Confirm AI derivatives</span>
            <h2 id="apply-edits-title">Create Gemini derivatives for the planned photos?</h2>
            <p>PassionFlow will send each photo Gemini marked for editing, its plan, and your preservation constraints. This uses your Gemini API quota and creates separate derivatives; originals stay unchanged.</p>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPendingAction(null)}>Keep originals only</button><button type="button" className="button primary" onClick={createPlannedAiDerivatives}>Create AI derivatives</button></div>
          </section>
        </div>
      )}

      {(pendingAction === 'zip' || pendingAction === 'folder') && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="export-consent-title">
            <span className="modal-kicker">Confirm delivery</span>
            <h2 id="export-consent-title">Create your editor-ready package?</h2>
            <p>This includes {selectedAssets.length} selected source {selectedAssets.length === 1 ? 'file' : 'files'}, the rendered share card, your caption, and the approved brief. Original photos are not modified.</p>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPendingAction(null)}>Cancel</button><button type="button" className="button primary" onClick={completeExport}>{pendingAction === 'folder' ? 'Choose folder' : 'Download ZIP'}</button></div>
          </section>
        </div>
      )}

      {pendingAction === 'editorSetup' && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal editor-api-modal" role="dialog" aria-modal="true" aria-labelledby="editor-api-title">
            <span className="modal-kicker">Editor connection</span>
            <h2 id="editor-api-title">Set up your editor API.</h2>
            <p>PassionFlow sends approved originals, the photo plan, and the handoff manifest to this endpoint. The endpoint must accept the <code>passionflow-editor-handoff/v1</code> JSON payload.</p>
            <div className="editor-api-form">
              <label htmlFor="editor-name">Editor name<input id="editor-name" value={editorSetup.label} onChange={(event) => setEditorSetup((current) => ({ ...current, label: event.target.value }))} placeholder="e.g. My PhotoRoom adapter" maxLength={80} /></label>
              <label htmlFor="editor-url">API endpoint URL<input id="editor-url" type="url" value={editorSetup.url} onChange={(event) => setEditorSetup((current) => ({ ...current, url: event.target.value }))} placeholder="https://your-editor-adapter.example/handoff" maxLength={2000} /></label>
              <label htmlFor="editor-token">Bearer API token <span>optional</span><input id="editor-token" type="password" autoComplete="off" value={editorSetup.token} onChange={(event) => setEditorSetup((current) => ({ ...current, token: event.target.value }))} placeholder="Stored only in this local server process" maxLength={4096} /></label>
            </div>
            <p className="api-safety-note">This does not save the token in the browser, project files, or downloads. Temporary setup resets when the local server restarts.</p>
            <div className="modal-actions">
              {editorProvider?.configured && <button type="button" className="text-action" disabled={busy === 'editor'} onClick={removeEditorProvider}>Remove temporary setup</button>}
              <button type="button" className="button secondary" disabled={busy === 'editor'} onClick={() => setPendingAction(null)}>Cancel</button>
              <button type="button" className="button primary" disabled={busy === 'editor' || !editorSetup.label.trim() || !editorSetup.url.trim()} onClick={saveEditorProvider}>{busy === 'editor' ? 'Saving editor API…' : 'Save editor API'}</button>
            </div>
          </section>
        </div>
      )}

      {pendingAction === 'receipt' && receiptDraft && walletPublicKey && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-consent-title">
            <span className="modal-kicker">Optional Devnet provenance</span>
            <h2 id="receipt-consent-title">Create this Devnet creator receipt?</h2>
            <p>Your wallet will ask you to authorize one Devnet transaction. It records only the public fields below. It does not upload a photo, prompt, caption, project title, or private key.</p>
            <dl className="receipt-fields">
              <div><dt>Creator address</dt><dd>{walletPublicKey}</dd></div>
              <div><dt>Final image SHA-256</dt><dd>{receiptDraft.imageHash}</dd></div>
              <div><dt>Manifest SHA-256</dt><dd>{receiptDraft.manifestHash}</dd></div>
              <div><dt>Format</dt><dd>PF1 · Version 1 · Solana Devnet</dd></div>
            </dl>
            <p className="devnet-note">Devnet is an experimental public test network; records may not be permanent and have no financial value.</p>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPendingAction(null)}>Skip receipt</button><button type="button" className="button primary" onClick={completeReceipt}>Create Devnet receipt</button></div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
