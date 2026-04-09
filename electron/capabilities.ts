import Store from 'electron-store'
import { randomUUID } from 'crypto'

export interface Parameter {
  name: string
  description: string
  actionIndex: number
  field: 'value' | 'url'
  defaultValue: string
  required: boolean
}

export interface ExtractionRule {
  name: string
  selector: string
  attribute: string // 'text', 'href', 'value', 'innerHTML'
  multiple: boolean
  sensitive: boolean
}

export interface Capability {
  id: string
  siteProfileId: string
  name: string
  description: string
  actions: Array<Record<string, unknown>>
  parameters: Parameter[]
  extractionRules: ExtractionRule[]
  preferredEngine: 'playwright' | 'puppeteer' | 'cdp'
  healthStatus: 'healthy' | 'degraded' | 'broken'
  consecutiveFailures: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  createdAt: string
  updatedAt: string
}

interface CapabilitiesSchema {
  capabilities: Capability[]
}

const capStore = new Store<CapabilitiesSchema>({
  name: 'capabilities',
  defaults: { capabilities: [] }
})

export function getAllCapabilities(): Capability[] {
  return capStore.get('capabilities')
}

export function getCapabilitiesForSite(siteProfileId: string): Capability[] {
  return getAllCapabilities().filter(c => c.siteProfileId === siteProfileId)
}

export function getCapability(id: string): Capability | undefined {
  return getAllCapabilities().find(c => c.id === id)
}

export function createCapability(data: {
  siteProfileId: string
  name: string
  description: string
  actions: Array<Record<string, unknown>>
  parameters: Parameter[]
  extractionRules: ExtractionRule[]
}): Capability {
  const cap: Capability = {
    id: randomUUID(),
    siteProfileId: data.siteProfileId,
    name: data.name,
    description: data.description,
    actions: data.actions,
    parameters: data.parameters,
    extractionRules: data.extractionRules,
    preferredEngine: 'playwright',
    healthStatus: 'healthy',
    consecutiveFailures: 0,
    lastRunAt: null,
    lastSuccessAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const caps = getAllCapabilities()
  caps.push(cap)
  capStore.set('capabilities', caps)
  return cap
}

export function deleteCapability(id: string): void {
  const caps = getAllCapabilities().filter(c => c.id !== id)
  capStore.set('capabilities', caps)
}

export function updateCapability(id: string, updates: Partial<Capability>): Capability | undefined {
  const caps = getAllCapabilities()
  const idx = caps.findIndex(c => c.id === id)
  if (idx === -1) return undefined
  caps[idx] = { ...caps[idx], ...updates, updatedAt: new Date().toISOString() }
  capStore.set('capabilities', caps)
  return caps[idx]
}
