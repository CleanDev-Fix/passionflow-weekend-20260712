function drawCaption(context: CanvasRenderingContext2D, text: string, y: number, maxWidth: number, lineHeight: number, direction: 'top' | 'bottom'): void {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return
  }

  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) {
    lines.push(line)
  }

  const startY = direction === 'top' ? y : y - ((lines.length - 1) * lineHeight)
  lines.forEach((captionLine, index) => {
    const x = context.canvas.width / 2
    const lineY = startY + (index * lineHeight)
    context.strokeText(captionLine, x, lineY)
    context.fillText(captionLine, x, lineY)
  })
}

export async function renderShareCard(source: File, topText: string, bottomText: string): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(source)
  const image = new Image()
  image.src = sourceUrl
  await image.decode()

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1080
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Your browser could not create the share image.')
    }

    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)

    context.fillStyle = '#0c0e0de6'
    context.fillRect(0, 0, canvas.width, 170)
    context.fillRect(0, canvas.height - 170, canvas.width, 170)

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '900 64px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'
    context.lineJoin = 'round'
    context.lineWidth = 11
    context.strokeStyle = '#0c111b'
    context.fillStyle = '#ffffff'
    drawCaption(context, topText, 88, 940, 76, 'top')
    drawCaption(context, bottomText, 992, 940, 76, 'bottom')

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the share image.'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
