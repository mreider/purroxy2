import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { encrypt, decrypt } from './crypto'

export interface SiteSession {
  cookies: Array<Record<string, unknown>>
  localStorage: Record<string, string>
}

export interface SiteProfile {
  id: string
  url: string
  hostname: string
  name: string
  faviconUrl: string
  sessionEncrypted: string | null
  createdAt: string
  updatedAt: string
}

interface SitesSchema {
  siteProfiles: SiteProfile[]
}

const sitesStore = new Store<SitesSchema>({
  name: 'sites',
  defaults: { siteProfiles: [] }
})

export function getAllSites(): SiteProfile[] {
  return sitesStore.get('siteProfiles')
}

export function getSite(id: string): SiteProfile | undefined {
  return getAllSites().find((s) => s.id === id)
}

export function getSiteByHostname(hostname: string): SiteProfile | undefined {
  return getAllSites().find((s) => s.hostname === hostname)
}

export function createSite(url: string, name: string, faviconUrl: string): SiteProfile {
  const hostname = new URL(url.includes('://') ? url : 'https://' + url).hostname
  const existing = getSiteByHostname(hostname)
  if (existing) return existing

  const site: SiteProfile = {
    id: randomUUID(),
    url,
    hostname,
    name: name || hostname,
    faviconUrl,
    sessionEncrypted: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const sites = getAllSites()
  sites.push(site)
  sitesStore.set('siteProfiles', sites)
  return site
}

export function saveSession(siteId: string, session: SiteSession): void {
  const sites = getAllSites()
  const idx = sites.findIndex((s) => s.id === siteId)
  if (idx === -1) throw new Error('Site not found')

  sites[idx].sessionEncrypted = encrypt(JSON.stringify(session))
  sites[idx].updatedAt = new Date().toISOString()
  sitesStore.set('siteProfiles', sites)
}

export function getSession(siteId: string): SiteSession | null {
  const site = getSite(siteId)
  if (!site?.sessionEncrypted) return null
  const json = decrypt(site.sessionEncrypted)
  return JSON.parse(json)
}

export function deleteSite(id: string): void {
  const sites = getAllSites().filter((s) => s.id !== id)
  sitesStore.set('siteProfiles', sites)
}
