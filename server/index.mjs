import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import express from 'express'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

const sourceAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  data: z.string().min(1),
})

const requestSchema = z.object({
  projectName: z.string().trim().min(1).max(80),
  assets: z.array(sourceAssetSchema).min(1).max(6),
  userEditBrief: z.object({
    desiredOutcome: z.string().trim().max(420),
    preservationConstraints: z.string().trim().max(420),
  }).optional(),
  apiKey: z.string().trim().min(1).max(1024).optional(),
})

const editorProviderSetupSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2_000).refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  }, 'Use an http or https editor API URL.'),
  token: z.string().max(4_096).optional(),
})

const memeImageSchema = z.object({
  subject: z.string().trim().min(3).max(180),
  visualDirection: z.string().trim().min(3).max(500),
  tone: z.string().trim().min(2).max(80),
  reference: sourceAssetSchema.optional(),
  apiKey: z.string().trim().min(1).max(1024).optional(),
})

const photoEditSchema = z.object({
  asset: sourceAssetSchema,
  desiredOutcome: z.string().trim().min(3).max(420),
  preservationConstraints: z.string().trim().max(420),
  instructions: z.array(z.string().trim().min(1).max(100)).min(1).max(4),
  apiKey: z.string().trim().min(1).max(1024).optional(),
})

const photoAnalysisSchema = z.object({
  projectSummary: z.string().trim().min(1).max(160),
  photoAssessments: z.array(z.object({
    assetId: z.string().uuid(),
    role: z.enum(['hero', 'detail', 'process', 'before', 'after', 'supporting']),
    keep: z.boolean(),
    issue: z.enum(['blur', 'duplicate', 'exposure', 'privacy', 'none']),
    reason: z.string().trim().min(1).max(120),
  })).min(1).max(6),
  editInstructions: z.array(z.object({
    assetId: z.string().uuid(),
    instructions: z.array(z.string().trim().min(1).max(100)).min(1).max(2),
  })).min(1).max(6),
  memeConcepts: z.array(z.object({
    id: z.string().trim().min(1).max(20),
    title: z.string().trim().min(1).max(32),
    topText: z.string().trim().max(60),
    bottomText: z.string().trim().max(60),
    caption: z.string().trim().min(1).max(180),
    tone: z.string().trim().min(1).max(32),
  })).min(1).max(3),
  accessibilityAltText: z.string().trim().min(1).max(180),
  privacyNotice: z.string().trim().max(160).optional(),
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const ai = new GoogleGenAI({})

function hasLocalGeminiAccess() {
  return process.env.PASSIONFLOW_ALLOW_SERVER_GEMINI === 'local-development'
    && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

function getGeminiClient(apiKey) {
  if (apiKey) {
    return new GoogleGenAI({ apiKey })
  }
  return hasLocalGeminiAccess() ? ai : null
}

app.use(express.json({ limit: '30mb' }))

const editorHandoffSchema = requestSchema.extend({
  manifest: z.record(z.string(), z.unknown()),
})

const environmentEditorConnector = process.env.EDITOR_CONNECTOR_URL ? {
  url: process.env.EDITOR_CONNECTOR_URL,
  label: process.env.EDITOR_CONNECTOR_LABEL || 'Connected editor',
  token: process.env.EDITOR_CONNECTOR_TOKEN,
} : null
let sessionEditorConnector = null

function getEditorConnector() {
  return sessionEditorConnector || environmentEditorConnector
}

function editorProviderStatus() {
  const connector = getEditorConnector()
  return {
    id: 'custom_http',
    label: connector?.label || 'Custom editor API',
    mode: 'api',
    configured: Boolean(connector),
  }
}

app.get('/api/editor-provider', (_request, response) => {
  response.json(editorProviderStatus())
})

app.post('/api/editor-provider', (request, response) => {
  const parsedRequest = editorProviderSetupSchema.safeParse(request.body)
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Enter an editor name and a valid http or https API URL.' })
    return
  }

  const { label, url, token } = parsedRequest.data
  sessionEditorConnector = { label, url, token: token?.trim() || undefined }
  response.status(200).json(editorProviderStatus())
})

app.delete('/api/editor-provider', (_request, response) => {
  sessionEditorConnector = null
  response.status(200).json(editorProviderStatus())
})

app.post('/api/editor-handoff', async (request, response) => {
  const parsedRequest = editorHandoffSchema.safeParse(request.body)
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Choose one to six supported editor files and a valid handoff manifest.' })
    return
  }
  const connector = getEditorConnector()
  if (!connector) {
    response.status(503).json({ error: 'No editor API is configured. Use the local folder or ZIP handoff instead.' })
    return
  }

  try {
    const connectorResponse = await fetch(connector.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(connector.token ? { Authorization: `Bearer ${connector.token}` } : {}),
      },
      body: JSON.stringify({
        protocol: 'passionflow-editor-handoff/v1',
        projectName: parsedRequest.data.projectName,
        assets: parsedRequest.data.assets,
        manifest: parsedRequest.data.manifest,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!connectorResponse.ok) {
      console.error('Editor connector rejected handoff', connectorResponse.status)
      response.status(502).json({ error: 'The configured editor connector rejected the handoff. Your originals remain local.' })
      return
    }

    const connectorBody = await connectorResponse.json().catch(() => ({}))
    response.status(202).json({
      status: 'submitted',
      provider: { id: 'custom_http', label: connector.label },
      jobId: typeof connectorBody.jobId === 'string' ? connectorBody.jobId : null,
    })
  } catch (error) {
    console.error('Editor connector handoff failure', error instanceof Error ? error.message : error)
    response.status(502).json({ error: 'The configured editor connector is unavailable. Your originals remain local.' })
  }
})

app.post('/api/generate-meme-image', async (request, response) => {
  const parsedRequest = memeImageSchema.safeParse(request.body)
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Describe a subject, visual direction, and tone for the meme image.' })
    return
  }
  const { subject, visualDirection, tone, reference, apiKey } = parsedRequest.data
  const gemini = getGeminiClient(apiKey)
  if (!gemini) {
    response.status(503).json({ error: 'Enter your own Gemini API key to generate an image. This deployment does not use a shared server key.' })
    return
  }
  if (reference && Buffer.byteLength(reference.data, 'base64') > 4 * 1024 * 1024) {
    response.status(413).json({ error: 'The optional reference image must be 4 MB or smaller.' })
    return
  }
  try {
    const prompt = `Create one original, high-quality square visual for a general-audience meme or share card. Subject: ${subject}. Visual direction: ${visualDirection}. Tone: ${tone}. ${reference ? 'Use the supplied reference as inspiration only; preserve no identifying person, brand mark, or copied artwork.' : ''} Do not render words, signs, labels, logos, tickers, financial claims, investment promises, copied characters, or any real person's likeness. Leave clean, high-contrast space at the top and bottom for PassionFlow to add the user's editable caption locally.`
    const interaction = await gemini.interactions.create({
      model: 'gemini-3.1-flash-image',
      store: false,
      input: reference ? [{ type: 'text', text: prompt }, { type: 'image', data: reference.data, mime_type: reference.mimeType }] : prompt,
    })
    if (!interaction.output_image?.data) {
      response.status(502).json({ error: 'Gemini did not return a usable meme image. Adjust the direction and try again.' })
      return
    }

    response.status(200).json({
      image: {
        data: interaction.output_image.data,
        mimeType: interaction.output_image.mime_type || 'image/png',
      },
    })
  } catch (error) {
    console.error('Gemini meme image generation failed')
    response.status(502).json({ error: 'Gemini could not generate the meme image. Nothing was posted or saved remotely.' })
  }
})

app.post('/api/create-photo-derivative', async (request, response) => {
  const parsedRequest = photoEditSchema.safeParse(request.body)
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Choose a photo, desired outcome, and at least one edit instruction.' })
    return
  }
  const { asset, desiredOutcome, preservationConstraints, instructions, apiKey } = parsedRequest.data
  const gemini = getGeminiClient(apiKey)
  if (!gemini) {
    response.status(503).json({ error: 'Enter your own Gemini API key to create an AI derivative. This deployment does not use a shared server key.' })
    return
  }
  if (Buffer.byteLength(asset.data, 'base64') > 4 * 1024 * 1024) {
    response.status(413).json({ error: 'This source image is too large for the current AI editing preview. Use an image under 4 MB.' })
    return
  }
  try {
    const prompt = `Edit this user-owned photo into a separate derivative. Desired outcome: ${desiredOutcome}. Apply only these approved instructions: ${instructions.map((instruction) => `- ${instruction}`).join(' ')}. Preserve exactly: ${preservationConstraints || 'all visible identity, labels, colors, texture, wear, and meaningful detail'}. Do not add text, logos, watermarks, new objects, fictional details, or claims. Return only the edited image.`
    const interaction = await gemini.interactions.create({
      model: 'gemini-3.1-flash-image',
      store: false,
      input: [{ type: 'text', text: prompt }, { type: 'image', data: asset.data, mime_type: asset.mimeType }],
    })
    if (!interaction.output_image?.data) {
      response.status(502).json({ error: 'The AI editor did not return a usable derivative. Your original remains local.' })
      return
    }

    response.status(200).json({
      image: {
        data: interaction.output_image.data,
        mimeType: interaction.output_image.mime_type || 'image/png',
      },
    })
  } catch (error) {
    console.error('Gemini photo derivative generation failed')
    response.status(502).json({ error: 'The AI editor could not create a derivative. Your original remains local.' })
  }
})

app.post('/api/analyse-photos', async (request, response) => {
  const parsedRequest = requestSchema.safeParse(request.body)
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Choose one to six supported images and a project name.' })
    return
  }

  const { projectName, assets, userEditBrief, apiKey } = parsedRequest.data
  const gemini = getGeminiClient(apiKey)
  if (!gemini) {
    response.status(503).json({ error: 'Enter your own Gemini API key to build an AI photo plan. This deployment does not use a shared server key.' })
    return
  }
  if (assets.some((asset) => Buffer.byteLength(asset.data, 'base64') > 4 * 1024 * 1024)) {
    response.status(413).json({ error: 'Each selected image must be 4 MB or smaller for a responsive review.' })
    return
  }

  try {
    const assetIndex = assets.map((asset) => `${asset.id}: ${asset.name}`).join('\n')
    const userBrief = [
      userEditBrief?.desiredOutcome ? `The user wants this outcome: ${userEditBrief.desiredOutcome}` : '',
      userEditBrief?.preservationConstraints ? `The user requires these protections: ${userEditBrief.preservationConstraints}` : '',
    ].filter(Boolean).join('\n')
    const interaction = await gemini.interactions.create({
      model: 'gemini-3.5-flash',
      store: false,
      input: [
        {
          type: 'text',
          text: `You are a concise creative-photo workflow planner. Analyze only visible details in the user-owned project images below. Do not invent facts, people, locations, brands, or outcomes. Preserve visible product/project integrity: never suggest hiding flaws, labels, logos, handmade texture, or meaningful wear. The project is “${projectName}”. ${userBrief ? `\n\n${userBrief}\nTreat the user requirements as constraints on every recommendation.` : ''}\n\nReturn one assessment and one short edit-instruction list for every asset ID. Pick one strongest hero where possible. Mark apparent duplicates or weak shots as keep=false. Keep every field terse: projectSummary <=25 words, reason <=16 words, and each instruction <=14 words. Return exactly one optional project-update concept; never make claims about a person or event.\n\nAsset IDs:\n${assetIndex}`,
        },
        ...assets.map((asset) => ({ type: 'image', data: asset.data, mime_type: asset.mimeType })),
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: z.toJSONSchema(photoAnalysisSchema),
      },
    })

    if (!interaction.output_text) {
      throw new Error('Gemini returned no structured photo plan.')
    }

    const analysis = photoAnalysisSchema.parse(JSON.parse(interaction.output_text))
    const requestedIds = new Set(assets.map((asset) => asset.id))
    const reviewedIds = new Set(analysis.photoAssessments.map((assessment) => assessment.assetId))
    const briefIds = new Set(analysis.editInstructions.map((brief) => brief.assetId))
    if (reviewedIds.size !== requestedIds.size || briefIds.size !== requestedIds.size || [...requestedIds].some((id) => !reviewedIds.has(id) || !briefIds.has(id))) {
      throw new Error('Gemini returned an incomplete photo plan. Please try again.')
    }

    response.json(analysis)
  } catch (error) {
    console.error('Gemini photo-plan generation failed')
    const status = Number(error?.status)
    if (status === 429 || status === 500 || status === 503 || status === 504) {
      response.status(503).json({ error: 'Gemini is temporarily busy. Your files remain local; please try again in a moment.' })
      return
    }
    response.status(502).json({ error: 'Gemini could not create a valid photo plan. Your files remain local; try again or continue without AI.' })
  }
})

const distDirectory = path.resolve(__dirname, '../dist')
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory))
  app.get('{*path}', (_request, response) => response.sendFile(path.join(distDirectory, 'index.html')))
}

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  console.log(`PassionFlow server listening on http://localhost:${port}`)
})
