export type WorkflowStage = 'capture' | 'shape' | 'share'

export type AnalysisIssue = 'blur' | 'duplicate' | 'exposure' | 'privacy' | 'none'

export interface MediaAsset {
  id: string
  file: File
  previewUrl: string
  sourceKind: 'image' | 'pdf'
  selected: boolean
}

export interface PhotoAssessment {
  assetId: string
  role: 'hero' | 'detail' | 'process' | 'before' | 'after' | 'supporting'
  keep: boolean
  issue: AnalysisIssue
  reason: string
}

export interface EditInstruction {
  assetId: string
  instructions: string[]
}

export interface UserEditBrief {
  desiredOutcome: string
  preservationConstraints: string
}

export interface PhotoAnalysis {
  projectSummary: string
  photoAssessments: PhotoAssessment[]
  editInstructions: EditInstruction[]
  memeConcepts: MemeConcept[]
  accessibilityAltText: string
  privacyNotice?: string
  userEditBrief?: UserEditBrief
}

export interface MemeConcept {
  id: string
  title: string
  topText: string
  bottomText: string
  caption: string
  tone: string
}

export interface CreatorReceipt {
  transactionSignature: string
  imageHash: string
  manifestHash: string
  createdAt: string
  network: 'devnet'
  creatorPublicKey: string
  payload: string
  explorerUrl: string
  blockTime: number | null
}

export type DerivativeStatus = 'returned' | 'approved' | 'keep_original' | 'rework_requested'

export interface MediaDerivative {
  id: string
  originalAssetId: string
  file: File
  previewUrl: string
  status: DerivativeStatus
  reworkNotes: string
}

export interface EditorProviderInfo {
  id: 'local_folder' | 'zip' | 'custom_http'
  label: string
  mode: 'local' | 'api'
  configured: boolean
}
