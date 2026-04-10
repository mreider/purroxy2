import { useEffect, useState } from 'react'
import { Search, Download, Upload, Globe, Users, Loader2, CheckCircle } from 'lucide-react'

interface CommunityCapability {
  id: string
  name: string
  description: string
  hostname: string
  authorEmail: string
  installCount: number
  createdAt: string
}

export default function Community() {
  const [capabilities, setCapabilities] = useState<CommunityCapability[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())

  const loadCapabilities = async (query = '') => {
    setLoading(true); setError('')
    try {
      const status = await window.purroxy.account.getStatus()
      if (!status.loggedIn) {
        setError('Log in to browse community capabilities (Settings → Account)')
        setLoading(false)
        return
      }
      const apiUrl = (status as any).apiUrl || 'https://purroxy-api.your-domain.workers.dev'
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      const res = await fetch(`${apiUrl}/api/community?${params}`)
      const data = await res.json() as any
      setCapabilities(data.capabilities || [])
    } catch (err: any) {
      setError('Could not connect to community server. It may not be deployed yet.')
    }
    setLoading(false)
  }

  useEffect(() => { loadCapabilities() }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadCapabilities(search)
  }

  const handleInstall = async (cap: CommunityCapability) => {
    setInstalling(cap.id)
    try {
      const status = await window.purroxy.account.getStatus()
      const apiUrl = (status as any).apiUrl || 'https://purroxy-api.your-domain.workers.dev'

      const res = await fetch(`${apiUrl}/api/community/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cap.id })
      })
      const data = await res.json() as any

      if (data.error) { setError(data.error); return }

      // Create local site profile and capability
      const site = await window.purroxy.sites.create(`https://${data.hostname}`, '', '')
      await window.purroxy.capabilities.create({
        siteProfileId: site.id,
        name: data.name,
        description: data.description,
        actions: data.actions,
        parameters: data.parameters,
        extractionRules: data.extractionRules,
        viewport: data.viewport
      })

      setInstalled(prev => new Set([...prev, cap.id]))
    } catch (err: any) {
      setError(`Install failed: ${err.message}`)
    }
    setInstalling(null)
  }

  const handlePublish = async () => {
    // Get capabilities to publish
    const allCaps = await window.purroxy.capabilities.getAll()
    if (allCaps.length === 0) {
      setError('No capabilities to publish. Build one first!')
      return
    }
    // For now, show a simple message. Full publish flow would let you pick which one.
    setError('Publishing coming soon! For now, capabilities are shared via the community server.')
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Community</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Discover and install capabilities built by others
          </p>
        </div>
        <button onClick={handlePublish}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
          <Upload size={14} /> Publish
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search capabilities..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>
      </form>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 text-xs text-amber-800 dark:text-amber-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : capabilities.length === 0 ? (
        <div className="flex flex-col items-center text-center py-12 text-gray-400 dark:text-gray-600">
          <Users size={40} className="mb-4 opacity-30" />
          <p>No community capabilities yet</p>
          <p className="text-sm mt-1">Be the first to publish one!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {capabilities.map(cap => (
            <div key={cap.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/8 dark:hover:bg-white/8 transition-colors">
              <Globe size={14} className="text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{cap.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cap.hostname} &middot; {cap.description}</p>
                <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                  <span>by {cap.authorEmail.split('@')[0]}</span>
                  <span>{cap.installCount} installs</span>
                </div>
              </div>
              <button onClick={() => handleInstall(cap)} disabled={installing === cap.id || installed.has(cap.id)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50
                  bg-accent hover:bg-accent-light text-white disabled:bg-green-500">
                {installed.has(cap.id) ? (
                  <><CheckCircle size={12} /> Installed</>
                ) : installing === cap.id ? (
                  <><Loader2 size={12} className="animate-spin" /> Installing</>
                ) : (
                  <><Download size={12} /> Install</>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
