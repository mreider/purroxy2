import { useEffect, useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, Lock } from 'lucide-react'

interface VaultItem {
  id: string
  key: string
  hasValue: boolean
  createdAt: string
  updatedAt: string
}

export default function Vault() {
  const [entries, setEntries] = useState<VaultItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [peeking, setPeeking] = useState<Record<string, string>>({})

  const loadEntries = async () => {
    const list = await window.purroxy.vault.list()
    setEntries(list)
    setLoaded(true)
  }

  useEffect(() => { loadEntries() }, [])

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return
    await window.purroxy.vault.set(newKey.trim(), newValue.trim())
    setNewKey('')
    setNewValue('')
    setAdding(false)
    loadEntries()
  }

  const handleDelete = async (key: string) => {
    await window.purroxy.vault.delete(key)
    loadEntries()
  }

  const handlePeek = async (key: string) => {
    if (peeking[key]) {
      setPeeking(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      const masked = await window.purroxy.vault.peek(key)
      setPeeking(prev => ({ ...prev, [key]: masked || '****' }))
    }
  }

  if (!loaded) return null

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Vault</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Encrypted storage for sensitive data. Never sent to Claude.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-4 p-3 rounded-lg border border-accent/30 bg-accent/5 space-y-2">
          <input
            type="text"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="Key (e.g. credit_card, ssn_last4, account_id)"
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            autoFocus
          />
          <input
            type="password"
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            placeholder="Value (encrypted at rest)"
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setNewKey(''); setNewValue('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
            <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()}
              className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 && !adding ? (
        <div className="mt-12 flex flex-col items-center text-center text-gray-400 dark:text-gray-600">
          <Lock size={40} className="mb-4 opacity-30" />
          <p>No vault entries yet</p>
          <p className="text-sm mt-1">Store passwords, API keys, and other secrets</p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/8 dark:hover:bg-white/8 transition-colors">
              <Lock size={14} className="text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium font-mono">{entry.key}</p>
                {peeking[entry.key] ? (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{peeking[entry.key]}</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">••••••••</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => handlePeek(entry.key)}
                  className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 transition-colors" title="Peek at value">
                  {peeking[entry.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => handleDelete(entry.key)}
                  className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
