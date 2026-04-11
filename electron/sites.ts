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

function friendlyHostname(hostname: string): string {
  // Turn "bluezoneexperience.guestyowners.com" into "Guesty Owners (bluezoneexperience)"
  // Turn "mail.google.com" into "Google Mail"
  // Turn "github.com" into "GitHub"
  const parts = hostname.replace(/^www\./, '').split('.')
  // Remove TLD
  if (parts.length > 1) parts.pop()

  if (parts.length >= 2) {
    // subdomain.domain format
    const domain = parts[parts.length - 1]
    const subdomain = parts.slice(0, -1).join('.')
    // Capitalize and humanize
    const domainName = domain.charAt(0).toUpperCase() + domain.slice(1)
    return `${domainName} (${subdomain})`
  }
  // Single part — just capitalize
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
}

export function createSite(url: string, name: string, faviconUrl: string): SiteProfile {
  const hostname = new URL(url.includes('://') ? url : 'https://' + url).hostname
  const existing = getSiteByHostname(hostname)
  if (existing) return existing

  const site: SiteProfile = {
    id: randomUUID(),
    url,
    hostname,
    name: friendlyHostname(hostname),
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
  const site = getSite(id)

  // Clear session cookies from Electron's session cache
  if (site?.hostname) {
    try {
      const { session } = require('electron')
      const ses = session.defaultSession
      ses.cookies.get({}).then((cookies: any[]) => {
        const domain = site.hostname.split('.').slice(-2).join('.')
        for (const cookie of cookies) {
          if (cookie.domain && (
            cookie.domain === site.hostname ||
            cookie.domain === '.' + site.hostname ||
            cookie.domain === '.' + domain ||
            site.hostname.endsWith(cookie.domain.replace(/^\./, ''))
          )) {
            const protocol = cookie.secure ? 'https' : 'http'
            const cookieUrl = `${protocol}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`
            ses.cookies.remove(cookieUrl, cookie.name).catch(() => {})
          }
        }
      }).catch(() => {})

      // Clear site-specific storage data
      ses.clearStorageData({
        origin: `https://${site.hostname}`,
        storages: ['localstorage', 'cachestorage', 'indexdb', 'serviceworkers']
      }).catch(() => {})
    } catch {}
  }

  const sites = getAllSites().filter((s) => s.id !== id)
  sitesStore.set('siteProfiles', sites)
}
