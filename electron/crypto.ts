import { safeStorage } from 'electron'

export function encrypt(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption not available')
  }
  const buffer = safeStorage.encryptString(plaintext)
  return buffer.toString('base64')
}

export function decrypt(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption not available')
  }
  const buffer = Buffer.from(encrypted, 'base64')
  return safeStorage.decryptString(buffer)
}
