import { useEffect, useState } from 'react'
import { Trash2, ShieldCheck, Globe, ChevronDown, ChevronRight, Zap, Play, Loader2, X, CheckCircle, AlertTriangle, Eye } from 'lucide-react'

interface TestResult {
  success: boolean
  data: Record<string, unknown>
  error?: string
  errorType?: string
  durationMs: number
  screenshot?: string
}

export default function Library() {
  const [sites, setSites] = useState<SiteProfile[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityData[]>([])
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [testing, setTesting] = useState<string | null>(null) // capabilityId being tested
  const [testResult, setTestResult] = useState<{ capId: string; result: TestResult } | null>(null)

  const loadData = async () => {
    const [allSites, allCaps] = await Promise.all([
      window.purroxy.sites.getAll(),
      window.purroxy.capabilities.getAll()
    ])
    setSites(allSites)
    setCapabilities(allCaps)
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
    if (testResult?.capId === id) setTestResult(null)
    loadData()
  }

  const handleTest = async (capId: string, visible = false) => {
    setTesting(capId)
    setTestResult(null)
    const result = await window.purroxy.executor.test(capId, {}, { visible })
    setTestResult({ capId, result })
    setTesting(null)
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
                <div className="flex items-center gap-3 p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => toggleSite(site.id)}>
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
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteSite(site.id) }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors" title="Delete site">
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
                          <div key={cap.id}>
                            <div className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                              <Zap size={14} className="text-accent flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{cap.name}</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cap.description}</p>
                                <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                                  <span>{cap.actions.length} actions</span>
                                  <span>{cap.parameters.length} params</span>
                                  <span className={cap.healthStatus === 'healthy' ? 'text-green-500' : cap.healthStatus === 'degraded' ? 'text-amber-500' : 'text-red-500'}>
                                    {cap.healthStatus}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => handleTest(cap.id)} disabled={testing === cap.id}
                                  className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-accent hover:text-accent-light transition-colors disabled:opacity-50" title="Test (headless)">
                                  {testing === cap.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                </button>
                                <button onClick={() => handleTest(cap.id, true)} disabled={testing === cap.id}
                                  className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-accent transition-colors disabled:opacity-50" title="Test (visible browser)">
                                  <Eye size={14} />
                                </button>
                                <button onClick={() => handleDeleteCapability(cap.id)}
                                  className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>

                            {/* Test result */}
                            {testResult?.capId === cap.id && (() => {
                              const hasData = Object.keys(testResult.result.data).length > 0
                              const partial = !testResult.result.success && hasData
                              const colorClass = testResult.result.success
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/30'
                                : partial
                                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/30'
                                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30'
                              return (
                              <div className={`mx-4 mb-3 p-3 rounded-lg text-xs border ${colorClass}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    {testResult.result.success ? (
                                      <><CheckCircle size={12} className="text-green-600" /> <span className="font-medium text-green-800 dark:text-green-300">Test passed</span></>
                                    ) : partial ? (
                                      <><AlertTriangle size={12} className="text-amber-600" /> <span className="font-medium text-amber-800 dark:text-amber-300">Partial — got data but some steps failed</span></>
                                    ) : (
                                      <><AlertTriangle size={12} className="text-red-600" /> <span className="font-medium text-red-800 dark:text-red-300">Test failed</span></>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-400">{(testResult.result.durationMs / 1000).toFixed(1)}s</span>
                                    <button onClick={() => setTestResult(null)} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
                                  </div>
                                </div>

                                {testResult.result.error && (
                                  <p className="text-red-700 dark:text-red-400 mb-2">{testResult.result.error}</p>
                                )}

                                {Object.keys(testResult.result.data).length > 0 && (
                                  <div className="space-y-1">
                                    {(testResult.result.data as any)._pageContent ? (
                                      <>
                                        <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">Page content (CSS selectors missed, showing raw text):</p>
                                        <div className="selectable text-gray-700 dark:text-gray-300 bg-black/5 dark:bg-white/5 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">
                                          {String((testResult.result.data as any)._pageContent).slice(0, 2000)}
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">Extracted data:</p>
                                        {Object.entries(testResult.result.data).map(([key, val]) => (
                                          <div key={key} className="flex gap-2">
                                            <span className="text-gray-500 font-medium">{key}:</span>
                                            <span className="text-gray-700 dark:text-gray-300 truncate selectable">
                                              {Array.isArray(val) ? `[${val.length} items]` : String(val ?? 'null')}
                                            </span>
                                          </div>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                )}

                                {testResult.result.screenshot && (
                                  <details className="mt-2">
                                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                                      Screenshot
                                      <a href={`data:image/png;base64,${testResult.result.screenshot}`} download={`purroxy-test-${cap.name.replace(/\s+/g, '-').toLowerCase()}.png`} className="ml-2 text-[10px] text-accent hover:text-accent-light" onClick={e => e.stopPropagation()}>download</a>
                                    </summary>
                                    <img src={`data:image/png;base64,${testResult.result.screenshot}`} alt="Test result" className="mt-1 rounded border border-black/10 dark:border-white/10 max-w-full" />
                                  </details>
                                )}

                                {(testResult.result as any).log && (testResult.result as any).log.length > 0 && (
                                  <details className="mt-2">
                                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                                      Execution log ({(testResult.result as any).log.length} entries)
                                      <button className="ml-2 text-[10px] text-accent hover:text-accent-light" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText((testResult.result as any).log.join('\n')) }}>copy</button>
                                    </summary>
                                    <div className="mt-1 p-2 bg-black/5 dark:bg-white/5 rounded text-[10px] font-mono max-h-48 overflow-auto whitespace-pre-wrap">
                                      {(testResult.result as any).log.map((entry: string, i: number) => (
                                        <div key={i} className={entry.includes('FAILED') ? 'text-red-500' : entry.includes('OK') ? 'text-green-500' : ''}>{entry}</div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                              )})()}
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
