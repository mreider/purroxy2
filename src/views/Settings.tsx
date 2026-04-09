import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check } from 'lucide-react'
import { useSettings } from '../stores/settings'

export default function Settings() {
  const { aiApiKey, loaded, load, setAiApiKey } = useSettings()

  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  useEffect(() => {
    if (loaded) setKeyInput(aiApiKey)
  }, [loaded, aiApiKey])

  const handleSaveKey = async () => {
    await setAiApiKey(keyInput.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const maskedKey = keyInput
    ? keyInput.slice(0, 7) + '...' + keyInput.slice(-4)
    : ''

  if (!loaded) return null

  return (
    <div className="p-8 max-w-xl">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      {/* API Key */}
      <section className="mb-8">
        <label className="block text-sm font-medium mb-2">Anthropic API Key</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 pr-10 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={keyInput.trim() === aiApiKey}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {saved ? <><Check size={14} /> Saved</> : 'Save'}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          Your key is stored locally and never sent to Purroxy servers.
        </p>
      </section>

      {/* Version info */}
      <section className="pt-4 border-t border-black/5 dark:border-white/5">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Purroxy v0.1.0
          {window.purroxy && (
            <> &middot; Electron {window.purroxy.versions.electron} &middot; {window.purroxy.platform}</>
          )}
        </p>
      </section>
    </div>
  )
}
