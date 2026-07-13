import type { PublicKey, Transaction } from '@solana/web3.js'

export interface BrowserWalletProvider {
  publicKey?: PublicKey
  connect: () => Promise<{ publicKey: PublicKey }>
  signTransaction: (transaction: Transaction) => Promise<Transaction>
}

declare global {
  interface Window {
    phantom?: { solana?: BrowserWalletProvider }
    solana?: BrowserWalletProvider
  }
}

export function getWalletProvider(): BrowserWalletProvider | null {
  return window.phantom?.solana ?? window.solana ?? null
}

export function isDevnetWalletAvailable(): boolean {
  return getWalletProvider() !== null
}
