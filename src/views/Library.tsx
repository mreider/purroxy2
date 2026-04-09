import { useEffect, useState } from 'react'
import { Trash2, ShieldCheck, Globe } from 'lucide-react'

export default function Library() {
  const [sites, setSites] = useState<SiteProfile[]>([])
  const [loaded, setLoaded] = useState(false)

  const loadSites = async () => {
    const all = await window.purroxy.sites.getAll()
    setSites(all)
    setLoaded(true)
  }

  useEffect(() => {
    loadSites()
  }, [])

  const handleDelete = async (id: string) => {
    await window.purroxy.sites.delete(id)
    loadSites()
  }

  if (!loaded) return null

  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold mb-4">Capability Library</h2>

      {sites.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center text-gray-400 dark:text-gray-600">
          <div className="text-5xl mb-4">📂</div>
          <p>No sites yet</p>
          <p className="text-sm mt-1">
            Navigate to a website from Home to create your first site profile
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => (
            <div
              key={site.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/8 dark:hover:bg-white/8 transition-colors"
            >
              <div className="w-8 h-8 rounded-md bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                {site.faviconUrl ? (
                  <img src={site.faviconUrl} alt="" className="w-5 h-5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <Globe size={16} className="text-gray-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{site.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{site.hostname}</p>
              </div>

              {site.sessionEncrypted && (
                <ShieldCheck size={16} className="text-green-500 flex-shrink-0" title="Session saved" />
              )}

              <button
                onClick={() => handleDelete(site.id)}
                className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                title="Delete site"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
