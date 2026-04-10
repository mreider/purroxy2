import { useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import logo from '../assets/logo.png'

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim()) return
    setLoading(true)
    setError('')
    const result = await window.purroxy.lock.unlock(pin)
    if (result.error) {
      setError(result.error)
      setPin('')
    } else {
      onUnlock()
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col items-center w-72">
        <img src={logo} alt="Purroxy" className="w-16 h-16 rounded-2xl mb-4" />
        <h1 className="text-lg font-semibold mb-1">Purroxy is locked</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6 text-center">
          Enter your PIN to unlock. All capabilities are blocked while locked.
        </p>

        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
            placeholder="Enter PIN"
            maxLength={8}
            autoFocus
            className="w-full px-4 py-3 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          {error && <p className="text-xs text-red-500 text-center">{error}</p>}
          <button type="submit" disabled={!pin.trim() || loading}
            className="w-full py-3 rounded-lg bg-accent hover:bg-accent-light text-white font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            Unlock
          </button>
        </form>
      </div>
    </div>
  )
}
