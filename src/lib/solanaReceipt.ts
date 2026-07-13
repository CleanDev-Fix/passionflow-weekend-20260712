import { Buffer } from 'buffer'
import { clusterApiUrl, Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import type { CreatorReceipt } from '../types'
import { getWalletProvider } from './walletProvider'

const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

export function createReceiptPayload(input: {
  creatorPublicKey: string
  finalImageSha256: string
  manifestSha256: string
  claimedUnixSeconds: number
}): string {
  const payload = `PF1|1|${input.creatorPublicKey}|${input.finalImageSha256.toLowerCase()}|${input.manifestSha256.toLowerCase()}|${input.claimedUnixSeconds}`
  if (!/^PF1\|1\|[1-9A-HJ-NP-Za-km-z]{32,44}\|[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9]{10}$/.test(payload)) {
    throw new Error('The public receipt fields were invalid. No transaction was created.')
  }
  return payload
}


export async function connectDevnetWallet(): Promise<string> {
  const provider = getWalletProvider()
  if (!provider) {
    throw new Error('A compatible Solana wallet is needed to create a devnet receipt. Your local handoff is still complete.')
  }

  const connection = await provider.connect()
  return connection.publicKey.toBase58()
}

export async function createDevnetCreatorReceipt(input: {
  creatorPublicKey: string
  finalImageSha256: string
  manifestSha256: string
}): Promise<CreatorReceipt> {
  const provider = getWalletProvider()
  if (!provider) {
    throw new Error('A compatible Solana wallet is needed to create a devnet receipt.')
  }

  const creator = provider.publicKey ?? (await provider.connect()).publicKey
  const creatorPublicKey = creator.toBase58()
  if (creatorPublicKey !== input.creatorPublicKey) {
    throw new Error('The connected wallet changed. Review the creator receipt again before continuing.')
  }

  const claimedUnixSeconds = Math.floor(Date.now() / 1_000)
  const payload = createReceiptPayload({
    creatorPublicKey,
    finalImageSha256: input.finalImageSha256,
    manifestSha256: input.manifestSha256,
    claimedUnixSeconds,
  })

  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const latestBlockhash = await connection.getLatestBlockhash('finalized')
  const transaction = new Transaction({
    feePayer: creator,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(new TransactionInstruction({
    programId: memoProgramId,
    keys: [{ pubkey: creator, isSigner: true, isWritable: false }],
    data: Buffer.from(payload, 'utf8'),
  }))

  const signedTransaction = await provider.signTransaction(transaction)
  const transactionSignature = await connection.sendRawTransaction(signedTransaction.serialize(), {
    preflightCommitment: 'confirmed',
    skipPreflight: false,
  })
  const confirmation = await connection.confirmTransaction({
    signature: transactionSignature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, 'finalized')
  if (confirmation.value.err) {
    throw new Error('Solana rejected the devnet receipt. No receipt was created.')
  }

  const confirmedTransaction = await connection.getTransaction(transactionSignature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  })
  if (!confirmedTransaction || confirmedTransaction.meta?.err) {
    throw new Error('The devnet transaction could not be independently confirmed. Check your wallet activity before retrying.')
  }

  return {
    transactionSignature,
    imageHash: input.finalImageSha256.toLowerCase(),
    manifestHash: input.manifestSha256.toLowerCase(),
    createdAt: new Date(claimedUnixSeconds * 1_000).toISOString(),
    network: 'devnet',
    creatorPublicKey,
    payload,
    explorerUrl: `https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`,
    blockTime: confirmedTransaction.blockTime ?? null,
  }
}
