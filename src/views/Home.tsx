import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe } from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) {
      navigate(`/builder?url=${encodeURIComponent(url.trim())}`)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <h1 className="text-3xl font-bold mb-2">Purroxy</h1>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-md mb-8">
        Record what you do on any website. Securely automate it forever.
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-md">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter a website URL to get started..."
              className="w-full pl-9 pr-3 py-3 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim()}
            className="px-5 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Go
          </button>
        </div>
      </form>

      <div className="mt-12 text-sm text-gray-400 dark:text-gray-600">
        {window.purroxy && (
          <span>
            Electron {window.purroxy.versions.electron} &middot;{' '}
            {window.purroxy.platform}
          </span>
        )}
      </div>
    </div>
  )
}
