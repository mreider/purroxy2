import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check, CheckCircle, XCircle, Loader2, Link2, Unlink, Lock } from 'lucide-react'
import { useSettings } from '../stores/settings'

export default function Settings() {
  const { aiApiKey, loaded, load, setAiApiKey } = useSettings()

  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  // Claude Desktop status
  const [claudeStatus, setClaudeStatus] = useState<{ installed: boolean; connected: boolean; configPath?: string } | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!loaded) load()
    checkClaudeStatus()
  }, [loaded, load])

  useEffect(() => {
    if (loaded) setKeyInput(aiApiKey)
  }, [loaded, aiApiKey])

  const checkClaudeStatus = async () => {
    const status = await window.purroxy.claude.getStatus()
    setClaudeStatus(status)
  }

  const handleSaveKey = async () => {
    await setAiApiKey(keyInput.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleConnect = async () => {
    setConnecting(true)
    const result = await window.purroxy.claude.connect()
    if (result.success) {
      await checkClaudeStatus()
    }
    setConnecting(false)
  }

  const handleDisconnect = async () => {
    await window.purroxy.claude.disconnect()
    await checkClaudeStatus()
  }

  if (!loaded) return null

  return (
    <div className="p-8 max-w-xl">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      {/* Account */}
      <AccountSection />

      {/* Claude Desktop Integration */}
      <section className="mb-8">
        <label className="block text-sm font-medium mb-2">Claude Desktop</label>

        {claudeStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" /> Checking...
          </div>
        ) : !claudeStatus.installed ? (
          <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">Claude Desktop is not installed.</p>
            <a href="https://claude.ai/download" target="_blank" className="text-sm text-accent hover:text-accent-light font-medium">
              Download Claude Desktop
            </a>
          </div>
        ) : claudeStatus.connected ? (
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-800 dark:text-green-300">Connected</span>
              </div>
              <button onClick={handleDisconnect} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                <Unlink size={12} /> Disconnect
              </button>
            </div>
            <p className="text-xs text-green-700 dark:text-green-400/80 mt-1">
              Your capabilities are available in Claude Desktop. Restart Claude Desktop if you just connected.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              Connect Purroxy so Claude Desktop can run your capabilities.
            </p>
            <button onClick={handleConnect} disabled={connecting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors disabled:opacity-60">
              {connecting ? (
                <><Loader2 size={14} className="animate-spin" /> Connecting...</>
              ) : (
                <><Link2 size={14} /> Connect to Claude Desktop</>
              )}
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Purroxy must be running for Claude to use your capabilities.
            </p>
          </div>
        )}
      </section>

      {/* App Lock */}
      <LockSettings />

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
          Used for the AI guide when building capabilities. Stored locally.
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

function AccountSection() {
  const [status, setStatus] = useState<{ loggedIn: boolean; email: string | null; plan: string | null; trialDaysLeft: number | null } | null>(null)
  const [showAuth, setShowAuth] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.purroxy.account.getStatus().then(setStatus)
  }, [])

  const handleAuth = async (mode: 'login' | 'signup') => {
    if (!email.trim() || !password.trim()) return
    setLoading(true); setError('')
    const result = mode === 'signup'
      ? await window.purroxy.account.signup(email, password)
      : await window.purroxy.account.login(email, password)
    if (result.error) { setError(result.error) }
    else { setShowAuth(null); setEmail(''); setPassword(''); window.purroxy.account.getStatus().then(setStatus) }
    setLoading(false)
  }

  const handleLogout = async () => {
    await window.purroxy.account.logout()
    window.purroxy.account.getStatus().then(setStatus)
  }

  if (!status) return null

  return (
    <section className="mb-8">
      <label className="block text-sm font-medium mb-2">Account</label>

      {status.loggedIn ? (
        <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{status.email}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {status.plan === 'trial' && status.trialDaysLeft !== null
                  ? `Trial — ${status.trialDaysLeft} days left`
                  : status.plan === 'monthly' ? 'Monthly subscription'
                  : status.plan === 'contributor' ? 'Contributor access'
                  : status.plan || 'Active'}
              </p>
            </div>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Log out
            </button>
          </div>
        </div>
      ) : showAuth ? (
        <div className="space-y-2 p-3 rounded-lg border border-accent/30 bg-accent/5">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoFocus
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (8+ chars)"
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAuth(null); setError('') }} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Cancel</button>
            <button onClick={() => handleAuth(showAuth)} disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light disabled:opacity-40">
              {loading ? 'Loading...' : showAuth === 'signup' ? 'Create Account' : 'Log In'}
            </button>
          </div>
          <p className="text-xs text-center text-gray-400">
            {showAuth === 'login' ? (
              <>No account? <button onClick={() => setShowAuth('signup')} className="text-accent">Sign up</button></>
            ) : (
              <>Have an account? <button onClick={() => setShowAuth('login')} className="text-accent">Log in</button></>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            Create an account for license management and community features.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setShowAuth('signup')} className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
              Sign Up
            </button>
            <button onClick={() => setShowAuth('login')} className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-black/10 dark:hover:bg-white/15 transition-colors">
              Log In
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function LockSettings() {
  const [config, setConfig] = useState<{ enabled: boolean; timeoutMinutes: number; hasPin: boolean; isLocked: boolean } | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [disablePin, setDisablePin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.purroxy.lock.getConfig().then(setConfig)
  }, [])

  const handleSetPin = async () => {
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
    if (pin !== confirmPin) { setError('PINs don\'t match'); return }
    await window.purroxy.lock.setPin(pin)
    setPin(''); setConfirmPin(''); setShowSetup(false); setError('')
    window.purroxy.lock.getConfig().then(setConfig)
  }

  const handleDisable = async () => {
    const result = await window.purroxy.lock.disable(disablePin)
    if (result.error) { setError(result.error); return }
    setDisablePin(''); setError('')
    window.purroxy.lock.getConfig().then(setConfig)
  }

  const handleTimeout = async (minutes: number) => {
    await window.purroxy.lock.setTimeout(minutes)
    window.purroxy.lock.getConfig().then(setConfig)
  }

  if (!config) return null

  return (
    <section className="mb-8">
      <label className="block text-sm font-medium mb-2">App Lock</label>

      {config.enabled ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-green-600" />
                <span className="text-sm font-medium text-green-800 dark:text-green-300">Enabled</span>
              </div>
              <button onClick={() => window.purroxy.lock.lockNow()}
                className="text-xs text-accent hover:text-accent-light font-medium">
                Lock now
              </button>
            </div>
            <p className="text-xs text-green-700 dark:text-green-400/80 mt-1">
              Auto-locks after {config.timeoutMinutes} minutes of inactivity. MCP blocked while locked.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Timeout:</span>
            {[1, 5, 15, 30].map(m => (
              <button key={m} onClick={() => handleTimeout(m)}
                className={`px-2 py-1 rounded text-xs transition-colors ${config.timeoutMinutes === m ? 'bg-accent text-white' : 'bg-black/5 dark:bg-white/10 text-gray-500 hover:bg-black/10 dark:hover:bg-white/15'}`}>
                {m}m
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input type="password" inputMode="numeric" pattern="[0-9]*" value={disablePin}
              onChange={e => { setDisablePin(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="Enter PIN to disable" maxLength={8}
              className="flex-1 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50" />
            <button onClick={handleDisable} disabled={!disablePin}
              className="px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-40 transition-colors">
              Disable
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : showSetup ? (
        <div className="space-y-2 p-3 rounded-lg border border-accent/30 bg-accent/5">
          <input type="password" inputMode="numeric" pattern="[0-9]*" value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
            placeholder="Set a PIN (4+ digits)" maxLength={8} autoFocus
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          <input type="password" inputMode="numeric" pattern="[0-9]*" value={confirmPin}
            onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setError('') }}
            placeholder="Confirm PIN" maxLength={8}
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowSetup(false); setPin(''); setConfirmPin(''); setError('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Cancel</button>
            <button onClick={handleSetPin}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light">Enable</button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            Set a PIN to auto-lock Purroxy after inactivity. All capability execution is blocked while locked.
          </p>
          <button onClick={() => setShowSetup(true)}
            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
            Set up PIN
          </button>
        </div>
      )}
    </section>
  )
}
