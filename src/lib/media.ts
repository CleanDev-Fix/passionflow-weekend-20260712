import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl


export async function normaliseMediaFile(file: File): Promise<{ file: File; sourceKind: 'image' | 'pdf' }> {
  if (file.type !== 'application/pdf') {
    if (!file.type.startsWith('image/')) {
      throw new Error(`${file.name} is not an image or PDF.`)
    }
    return { file, sourceKind: 'image' }
  }

  const loadingTask = getDocument({ data: await file.arrayBuffer() })
  const pdfDocument = await loadingTask.promise
  try {
    const page = await pdfDocument.getPage(1)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = globalThis.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Your browser could not render this PDF page.')
    }

    await page.render({ canvas, canvasContext: context, viewport }).promise
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob: Blob | null) => (blob ? resolve(blob) : reject(new Error('Could not convert the PDF page to an image.'))), 'image/png')
    })

    return {
      file: new File(
        [png],
        `${file.name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'source'}-page-1.png`,
        { type: 'image/png' },
      ),
      sourceKind: 'pdf',
    }
  } finally {
    await loadingTask.destroy()
  }
}

