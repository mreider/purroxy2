import { useEffect, useState } from 'react'
import { Trash2, ShieldCheck, Globe, ChevronDown, ChevronRight, Zap, Settings2 } from 'lucide-react'

export default function Library() {
  const [sites, setSites] = useState<SiteProfile[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityData[]>([])
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  const loadData = async () => {
    const [allSites, allCaps] = await Promise.all([
      window.purroxy.sites.getAll(),
      window.purroxy.capabilities.getAll()
    ])
    setSites(allSites)
    setCapabilities(allCaps)
    // Auto-expand sites that have capabilities
    const withCaps = new Set(allCaps.map(c => c.siteProfileId))
    setExpandedSites(withCaps)
    setLoaded(true)
  }

  useEffect(() => { loadData() }, [])

  const toggleSite = (id: string) => {
    setExpandedSites(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleDeleteSite = async (id: string) => {
    await window.purroxy.sites.delete(id)
    loadData()
  }

  const handleDeleteCapability = async (id: string) => {
    await window.purroxy.capabilities.delete(id)
    loadData()
  }

  const capsForSite = (siteId: string) => capabilities.filter(c => c.siteProfileId === siteId)

  if (!loaded) return null

  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold mb-4">Capability Library</h2>

      {sites.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center text-gray-400 dark:text-gray-600">
          <div className="text-5xl mb-4">📂</div>
          <p>No sites yet</p>
          <p className="text-sm mt-1">Navigate to a website from Home to create your first site profile</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sites.map(site => {
            const siteCaps = capsForSite(site.id)
            const expanded = expandedSites.has(site.id)

            return (
              <div key={site.id} className="rounded-lg border border-black/5 dark:border-white/5 overflow-hidden">
                {/* Site header */}
                <div
                  className="flex items-center gap-3 p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => toggleSite(site.id)}
                >
                  <div className="text-gray-400">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                  <div className="w-7 h-7 rounded-md bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                    {site.faviconUrl ? (
                      <img src={site.faviconUrl} alt="" className="w-4 h-4" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <Globe size={14} className="text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{site.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{site.hostname}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {site.sessionEncrypted && <ShieldCheck size={14} className="text-green-500" title="Session saved" />}
                    {siteCaps.length > 0 && (
                      <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">{siteCaps.length}</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSite(site.id) }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete site"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Capabilities */}
                {expanded && (
                  <div className="border-t border-black/5 dark:border-white/5">
                    {siteCaps.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500">No capabilities yet for this site</p>
                    ) : (
                      <div className="divide-y divide-black/5 dark:divide-white/5">
                        {siteCaps.map(cap => (
                          <div key={cap.id} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                            <Zap size={14} className="text-accent flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{cap.name}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cap.description}</p>
                              <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                                <span>{cap.actions.length} actions</span>
                                <span>{cap.parameters.length} params</span>
                                <span>{cap.extractionRules.length} extractions</span>
                                <span className={`${cap.healthStatus === 'healthy' ? 'text-green-500' : cap.healthStatus === 'degraded' ? 'text-amber-500' : 'text-red-500'}`}>
                                  {cap.healthStatus}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteCapability(cap.id)}
                              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                              title="Delete capability"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
