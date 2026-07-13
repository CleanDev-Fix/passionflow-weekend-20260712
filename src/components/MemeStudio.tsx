import { useEffect, useRef, useState } from 'react'

import { generateMemeImage } from '../lib/memeClient'
import { renderShareCard } from '../lib/shareCard'

interface MemeStudioProps {
  apiKey: string
  onError: (message: string) => void
  onNotice: (message: string) => void
  onUseForReceipt: (image: Blob, caption: string) => void
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function MemeStudio({ apiKey, onError, onNotice, onUseForReceipt }: MemeStudioProps) {
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const renderedRef = useRef<HTMLElement>(null)
  const [subject, setSubject] = useState('')
  const [visualDirection, setVisualDirection] = useState('')
  const [tone, setTone] = useState('Playful')
  const [reference, setReference] = useState<File | null>(null)
  const [source, setSource] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [topText, setTopText] = useState('')
  const [bottomText, setBottomText] = useState('')
  const [caption, setCaption] = useState('')
  const [rendered, setRendered] = useState<Blob | null>(null)
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<'generate' | 'render' | null>(null)
  const [progress, setProgress] = useState('Ready for a visual brief.')
  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  }, [sourceUrl])
  useEffect(() => () => {
    if (renderedUrl) URL.revokeObjectURL(renderedUrl)
  }, [renderedUrl])
  useEffect(() => {
    if (sourceUrl) {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [sourceUrl])
  useEffect(() => {
    if (renderedUrl) {
      renderedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [renderedUrl])

  function chooseReference(file: File | undefined): void {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onError('Choose an image file for the optional Meme Studio reference.')
      return
    }
    setReference(file)
    onNotice(`${file.name} will guide the visual only. It will not be edited or posted.`)
  }

  async function generate(): Promise<void> {
    setBusy('generate')
    setProgress('Creating your source visual. Keep this page open while the image is being prepared.')
    onError('')
    try {
      const image = await generateMemeImage({ subject, visualDirection, tone, reference, apiKey })
      const nextSource = new File([image], 'passionflow-meme-source.jpg', { type: image.type || 'image/jpeg' })
      const nextUrl = URL.createObjectURL(nextSource)
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      if (renderedUrl) URL.revokeObjectURL(renderedUrl)
      setSource(nextSource)
      setSourceUrl(nextUrl)
      setRendered(null)
      setRenderedUrl(null)
      setProgress('Source visual ready. Review it in the center panel, then render your local caption.')
      onNotice('Source visual ready. Review it in the center panel, then add or revise the caption locally.')
    } catch (reason) {
      setProgress('Generation stopped. Adjust the brief and try again.')
      onError(reason instanceof Error ? reason.message : 'Gemini could not generate the meme visual.')
    } finally {
      setBusy(null)
    }
  }

  async function render(): Promise<void> {
    if (!source) return
    setBusy('render')
    setProgress('Rendering your caption locally. No image is being uploaded for this step.')
    onError('')
    try {
      const image = await renderShareCard(source, topText, bottomText)
      const nextUrl = URL.createObjectURL(image)
      if (renderedUrl) URL.revokeObjectURL(renderedUrl)
      setRendered(image)
      setRenderedUrl(nextUrl)
      setProgress('Captioned meme ready. Review the finished image below, then download it or prepare an optional receipt.')
      onNotice('Captioned meme ready. Review the finished image below before downloading or creating an optional receipt.')
    } catch (reason) {
      setProgress('Caption rendering stopped. Adjust the copy and try again.')
      onError(reason instanceof Error ? reason.message : 'The meme caption could not be rendered locally.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="meme-studio" id="meme-studio" aria-labelledby="meme-studio-heading">
      <div className="meme-studio-heading">
        <div>
          <span className="section-number">M/01</span>
          <h2 id="meme-studio-heading">Meme Studio</h2>
          <p>Start with words, an optional reference, or both. The studio creates the visual; you control every caption locally.</p>
        </div>
        <span className="meme-studio-tag">Optional creative output</span>
      </div>
      <div className={`meme-progress ${busy ? 'working' : 'ready'}`} role="status" aria-live="polite"><span aria-hidden="true"></span><strong>{busy === 'generate' ? 'Generating visual' : busy === 'render' ? 'Rendering caption' : 'Meme Studio status'}</strong><p>{progress}</p></div>

      <div className="meme-studio-grid">
        <section className="meme-brief" aria-label="Meme visual brief">
          <label htmlFor="meme-subject">What is the moment or idea?</label>
          <input id="meme-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A restored clock that finally works" maxLength={180} />
          <label htmlFor="meme-direction">What should it look like?</label>
          <textarea id="meme-direction" value={visualDirection} onChange={(event) => setVisualDirection(event.target.value)} placeholder="Warm repair bench, dramatic close-up, room for a bold caption" rows={4} maxLength={500} />
          <label htmlFor="meme-tone">Tone</label>
          <select id="meme-tone" value={tone} onChange={(event) => setTone(event.target.value)}>
            <option>Playful</option>
            <option>Proud</option>
            <option>Dry</option>
            <option>Wholesome</option>
            <option>Chaotic</option>
          </select>
          <input ref={referenceInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => chooseReference(event.target.files?.[0])} />
          <div className="meme-reference-row">
            <button type="button" className="button secondary" onClick={() => referenceInputRef.current?.click()}>{reference ? 'Replace reference' : 'Add optional reference'}</button>
            {reference ? <span>{reference.name}</span> : <span>Text-only works too.</span>}
          </div>
          <p className="meme-safety">Use only ideas and visuals you have permission to use. PassionFlow does not create token, investment, or financial claims.</p>
          <button type="button" className="button primary full" disabled={busy !== null || subject.trim().length < 3 || visualDirection.trim().length < 3} onClick={generate}>{busy === 'generate' ? 'Generating source visual…' : 'Generate meme visual'}</button>
        </section>

        <section className="meme-preview" ref={previewRef} aria-label="Meme visual preview">
          {sourceUrl ? <img src={sourceUrl} alt="Generated source visual for meme creation" /> : <div className="meme-empty"><span aria-hidden="true">✦</span><strong>Your source visual lands here.</strong><p>Text-only or reference-backed. No chat thread required.</p></div>}
          <div className="meme-preview-label"><span>Generated source visual</span><strong>{source ? 'Ready for your caption' : 'Waiting for your brief'}</strong></div>
        </section>

        <section className="meme-caption-editor" aria-label="Local meme caption editor">
          <span className="section-number">Local caption</span>
          <label htmlFor="meme-top-text">Top line</label>
          <input id="meme-top-text" value={topText} onChange={(event) => setTopText(event.target.value)} placeholder="WHEN THE CLOCK" maxLength={90} />
          <label htmlFor="meme-bottom-text">Bottom line</label>
          <input id="meme-bottom-text" value={bottomText} onChange={(event) => setBottomText(event.target.value)} placeholder="DECIDES TO LIVE" maxLength={90} />
          <label htmlFor="meme-caption">Post caption</label>
          <textarea id="meme-caption" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Write your own context for the moment." rows={4} maxLength={420} />
          <button type="button" className="button dark full" disabled={!source || busy !== null} onClick={render}>{busy === 'render' ? 'Rendering locally…' : 'Render captioned meme'}</button>
          {rendered && <div className="meme-output-actions"><button type="button" className="button primary" onClick={() => download(rendered, 'passionflow-meme.png')}>Download meme</button><button type="button" className="button secondary" onClick={() => onUseForReceipt(rendered, caption)}>Use for optional Solana receipt</button></div>}
        </section>
      </div>

      {renderedUrl && <section className="meme-rendered" ref={renderedRef} aria-label="Rendered meme preview"><img src={renderedUrl} alt="Rendered captioned meme" /><span>Rendered locally · review before sharing</span></section>}
    </section>
  )
}
