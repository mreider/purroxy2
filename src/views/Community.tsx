import { useEffect, useState } from 'react'
import { Search, Download, Upload, Globe, Users, Loader2, CheckCircle, ExternalLink, Clock, XCircle } from 'lucide-react'

interface CommunityCapability {
  id: string
  name: string
  description: string
  hostname: string
  authorEmail: string
  installCount: number
  createdAt: string
}

interface Submission {
  id: string
  capabilityName: string
  hostname: string
  status: string
  githubPrUrl: string | null
  rejectionReason: string | null
  createdAt: string
}

export default function Community() {
  const [capabilities, setCapabilities] = useState<CommunityCapability[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())

  // Publish state
  const [showPublish, setShowPublish] = useState(false)
  const [localCaps, setLocalCaps] = useState<CapabilityData[]>([])
  const [selectedCapId, setSelectedCapId] = useState<string>('')
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ success?: boolean; message?: string; prUrl?: string } | null>(null)

  // Submissions
  const [submissions, setSubmissions] = useState<Submission[]>([])

  const loadCapabilities = async (query = '') => {
    setLoading(true); setError('')
    try {
      const status = await window.purroxy.account.getStatus()
      if (!status.loggedIn) {
        setError('Log in to browse community capabilities (Settings > Account)')
        setLoading(false)
        return
      }
      const apiUrl = status.apiUrl || 'https://purroxy-api.mreider.workers.dev'
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      const res = await fetch(`${apiUrl}/api/community?${params}`)
      const data = await res.json() as any
      setCapabilities(data.capabilities || [])
    } catch {
      setError('Could not connect to community server. It may not be deployed yet.')
    }
    setLoading(false)
  }

  const loadSubmissions = async () => {
    try {
      const status = await window.purroxy.account.getStatus()
      if (!status.loggedIn) return
      const apiUrl = status.apiUrl
      const accountStatus = await window.purroxy.account.getStatus()
      const token = (accountStatus as any).token // Will use validate endpoint instead
      const res = await fetch(`${apiUrl}/api/submissions`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json() as any
        setSubmissions(data.submissions || [])
      }
    } catch {
      // Submissions loading is best-effort
    }
  }

  useEffect(() => {
    loadCapabilities()
    loadSubmissions()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadCapabilities(search)
  }

  const handleInstall = async (cap: CommunityCapability) => {
    setInstalling(cap.id)
    try {
      const status = await window.purroxy.account.getStatus()
      const apiUrl = status.apiUrl || 'https://purroxy-api.mreider.workers.dev'

      const res = await fetch(`${apiUrl}/api/community/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cap.id })
      })
      const data = await res.json() as any

      if (data.error) { setError(data.error); return }

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

  const handleOpenPublish = async () => {
    const allCaps = await window.purroxy.capabilities.getAll()
    if (allCaps.length === 0) {
      setError('No capabilities to publish. Build one first!')
      return
    }
    setLocalCaps(allCaps)
    setSelectedCapId(allCaps[0].id)
    setShowPublish(true)
    setPublishResult(null)
  }

  const handlePublish = async () => {
    const cap = localCaps.find(c => c.id === selectedCapId)
    if (!cap) return

    setPublishing(true); setError('')
    try {
      const status = await window.purroxy.account.getStatus()
      if (!status.loggedIn) {
        setError('Log in to publish (Settings > Account)')
        setPublishing(false)
        return
      }

      const apiUrl = status.apiUrl
      const validateResult = await window.purroxy.account.validate()
      if (!validateResult.valid && !validateResult.offline) {
        setError('Session expired. Please log in again.')
        setPublishing(false)
        return
      }

      // Get sites to find hostname
      const sites = await window.purroxy.sites.getAll()
      const site = sites.find(s => s.id === cap.siteProfileId)

      const res = await fetch(`${apiUrl}/api/submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(status as any).token || ''}`
        },
        body: JSON.stringify({
          name: cap.name,
          description: cap.description,
          hostname: site?.hostname || 'unknown',
          actions: cap.actions,
          parameters: cap.parameters,
          extractionRules: cap.extractionRules,
          viewport: (cap as any).viewport || null
        })
      })
      const data = await res.json() as any

      if (data.error) {
        setError(data.error)
      } else {
        setPublishResult({
          success: true,
          message: data.message,
          prUrl: data.githubPr?.url
        })
        // Refresh account status (may have been upgraded to contributor)
        await window.purroxy.account.refresh()
        loadSubmissions()
      }
    } catch (err: any) {
      setError(`Publish failed: ${err.message}`)
    }
    setPublishing(false)
  }

  const selectedCap = localCaps.find(c => c.id === selectedCapId)

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Community</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Discover and install shared capabilities
          </p>
        </div>
        <button onClick={handleOpenPublish}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
          <Upload size={14} /> Publish
        </button>
      </div>

      {/* Publish panel */}
      {showPublish && (
        <div className="mb-6 p-4 rounded-lg border border-accent/30 bg-accent/5">
          {publishResult?.success ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Submitted for review!</p>
              <p className="text-xs text-gray-600 dark:text-gray-300">{publishResult.message}</p>
              {publishResult.prUrl && (
                <a href={publishResult.prUrl} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-light font-medium">
                  <ExternalLink size={12} /> View PR on GitHub
                </a>
              )}
              <button onClick={() => { setShowPublish(false); setPublishResult(null) }}
                className="block text-xs text-gray-400 hover:text-gray-600 mt-2">Close</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Choose a capability to share</label>
                <select value={selectedCapId} onChange={e => setSelectedCapId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50">
                  {localCaps.map(cap => (
                    <option key={cap.id} value={cap.id}>{cap.name}</option>
                  ))}
                </select>
              </div>
              {selectedCap && (
                <p className="text-xs text-gray-500">{selectedCap.description || 'No description'}</p>
              )}
              <p className="text-[10px] text-gray-400">
                Creates a review PR. Approved submissions get free access.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowPublish(false)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Cancel</button>
                <button onClick={handlePublish} disabled={publishing}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light disabled:opacity-50">
                  {publishing ? 'Submitting...' : 'Publish'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submissions history */}
      {submissions.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium text-gray-500 mb-2">Your submissions</h3>
          <div className="space-y-1">
            {submissions.map(sub => (
              <div key={sub.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-xs">
                {sub.status === 'pending' && <Clock size={12} className="text-amber-500" />}
                {sub.status === 'approved' && <CheckCircle size={12} className="text-green-500" />}
                {sub.status === 'rejected' && <XCircle size={12} className="text-red-500" />}
                <span className="font-medium flex-1">{sub.capabilityName}</span>
                <span className="text-gray-400">{sub.hostname}</span>
                {sub.githubPrUrl && (
                  <a href={sub.githubPrUrl} target="_blank" rel="noopener" className="text-accent hover:text-accent-light">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
