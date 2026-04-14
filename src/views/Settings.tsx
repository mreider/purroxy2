import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Eye, EyeOff, Check, CheckCircle, Loader2, Link2, Unlink, Lock, Download, RotateCw, RefreshCw } from 'lucide-react'
import { useSettings } from '../stores/settings'

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
      <div className="px-5 py-3.5 bg-black/[0.02] dark:bg-white/[0.03]">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-4 border-t border-black/5 dark:border-white/5">
        {children}
      </div>
    </section>
  )
}

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

  const handleSaveKey = async (e?: FormEvent) => {
    e?.preventDefault()
    if (keyInput.trim() === aiApiKey) return
    await setAiApiKey(keyInput.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!loaded) return null

  return (
    <div className="p-8 max-w-xl">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      <div className="space-y-5">
        <AccountSection />
        <ClaudeDesktopSection />
        <LockSection />

        <SectionCard title="Anthropic API Key" description="For the AI guide. Stored locally.">
          <form onSubmit={handleSaveKey} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 pr-10 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="submit"
              disabled={keyInput.trim() === aiApiKey}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {saved ? <><Check size={14} /> Saved</> : 'Save'}
            </button>
          </form>
        </SectionCard>

        <UpdateSection />
      </div>

      <div className="mt-6 pt-4 border-t border-black/5 dark:border-white/5">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Electron {window.purroxy.versions.electron} &middot; {window.purroxy.platform}
        </p>
      </div>
    </div>
  )
}

function AccountSection() {
  const [status, setStatus] = useState<{
    loggedIn: boolean; email: string | null; plan: string | null; status: string | null;
    trialEndsAt: string | null; trialDaysLeft: number | null; accountType: string;
    emailVerified: boolean; apiUrl: string
  } | null>(null)
  const [showAuth, setShowAuth] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refreshStatus = () => window.purroxy.account.getStatus().then(setStatus)

  useEffect(() => {
    refreshStatus()
    const onFocus = () => refreshStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault()
    if (!showAuth || !email.trim() || !password.trim()) return
    setLoading(true)
    setError('')
    const result = showAuth === 'signup'
      ? await window.purroxy.account.signup(email, password)
      : await window.purroxy.account.login(email, password)
    if (result.error) {
      setError(result.error)
    } else {
      setShowAuth(null)
      setEmail('')
      setPassword('')
      refreshStatus()
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    await window.purroxy.account.logout()
    refreshStatus()
  }

  if (!status) return null

  return (
    <SectionCard title="Account" description="Free during pre-release. Early signups are grandfathered.">
      {status.loggedIn ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{status.email}</p>
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800/30">
                Pre-release
              </span>
            </div>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Log out
            </button>
          </div>

          <div className="rounded-lg bg-green-50/50 dark:bg-green-900/10 border border-green-200/50 dark:border-green-800/20 p-3">
            <p className="text-xs text-green-800 dark:text-green-300">
              All features are free during pre-release.
            </p>
          </div>

          {!status.emailVerified && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Check your email to verify your account.
            </p>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : showAuth ? (
        <form onSubmit={handleAuth} className="space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoFocus
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (8+ chars)"
            className="w-full px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-gray-400">
              {showAuth === 'login' ? (
                <>No account? <button type="button" onClick={() => { setShowAuth('signup'); setError('') }} className="text-accent hover:text-accent-light">Sign up</button></>
              ) : (
                <>Have an account? <button type="button" onClick={() => { setShowAuth('login'); setError('') }} className="text-accent hover:text-accent-light">Log in</button></>
              )}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowAuth(null); setError(''); setEmail(''); setPassword('') }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={loading || !email.trim() || !password.trim()}
                className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light disabled:opacity-40 transition-colors">
                {loading ? 'Loading...' : showAuth === 'signup' ? 'Create Account' : 'Log In'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All features are free during pre-release.
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
    </SectionCard>
  )
}

function ClaudeDesktopSection() {
  const [status, setStatus] = useState<{ installed: boolean; connected: boolean; configPath?: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkStatus = async () => {
    const s = await window.purroxy.claude.getStatus()
    setStatus(s)
  }

  useEffect(() => { checkStatus() }, [])

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    const result = await window.purroxy.claude.connect()
    if (result.success) {
      await checkStatus()
    } else {
      setError(result.error || 'Connection failed')
    }
    setConnecting(false)
  }

  const handleDisconnect = async () => {
    setError(null)
    const result = await window.purroxy.claude.disconnect()
    if (result.error) {
      setError(result.error)
    }
    await checkStatus()
  }

  return (
    <SectionCard title="Claude Desktop" description="Connect so Claude can use your capabilities.">
      {status === null ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Checking...
        </div>
      ) : !status.installed ? (
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Claude Desktop is not installed.</p>
          <a href="https://claude.ai/download" target="_blank" rel="noreferrer"
            className="text-sm text-accent hover:text-accent-light font-medium mt-1 inline-block">
            Download Claude Desktop
          </a>
        </div>
      ) : status.connected ? (
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">Connected</span>
            </div>
            <button onClick={handleDisconnect}
              className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors">
              <Unlink size={12} /> Disconnect
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Restart Claude Desktop to pick up changes.
          </p>
        </div>
      ) : (
        <div>
          <button onClick={handleConnect} disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors disabled:opacity-60">
            {connecting ? (
              <><Loader2 size={14} className="animate-spin" /> Connecting...</>
            ) : (
              <><Link2 size={14} /> Connect to Claude Desktop</>
            )}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Purroxy must be running for Claude to connect.
          </p>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-500 mt-2">{error}</p>
      )}
    </SectionCard>
  )
}

function LockSection() {
  const [config, setConfig] = useState<{ enabled: boolean; timeoutMinutes: number; hasPin: boolean; isLocked: boolean } | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [showDisable, setShowDisable] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [disablePin, setDisablePin] = useState('')
  const [error, setError] = useState('')

  const refreshConfig = () => window.purroxy.lock.getConfig().then(setConfig)

  useEffect(() => { refreshConfig() }, [])

  const handleSetPin = async (e: FormEvent) => {
    e.preventDefault()
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
    if (pin !== confirmPin) { setError("PINs don't match"); return }
    await window.purroxy.lock.setPin(pin)
    setPin(''); setConfirmPin(''); setShowSetup(false); setError('')
    refreshConfig()
  }

  const handleDisable = async (e: FormEvent) => {
    e.preventDefault()
    if (!disablePin) return
    const result = await window.purroxy.lock.disable(disablePin)
    if (result.error) { setError(result.error); return }
    setDisablePin(''); setShowDisable(false); setError('')
    refreshConfig()
  }

  const handleTimeout = async (minutes: number) => {
    await window.purroxy.lock.setTimeout(minutes)
    refreshConfig()
  }

  if (!config) return null

  return (
    <SectionCard title="App Lock" description="Prevent capabilities from running when locked.">
      {config.enabled ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-green-600" />
              <span className="text-sm font-medium">Enabled</span>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => window.purroxy.lock.lockNow()}
                className="text-xs text-accent hover:text-accent-light font-medium transition-colors">
                Lock now
              </button>
              <button type="button" onClick={() => { setShowDisable(!showDisable); setDisablePin(''); setError('') }}
                className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors">
                Disable
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Auto-lock after</span>
            <div className="flex gap-1.5">
              {[1, 5, 15, 30].map(m => (
                <button key={m} type="button" onClick={() => handleTimeout(m)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    config.timeoutMinutes === m
                      ? 'bg-accent text-white'
                      : 'bg-black/5 dark:bg-white/10 text-gray-500 hover:bg-black/10 dark:hover:bg-white/15'
                  }`}>
                  {m}m
                </button>
              ))}
            </div>
          </div>

          {showDisable && (
            <form onSubmit={handleDisable} className="flex items-center gap-2 pt-3 border-t border-black/5 dark:border-white/5">
              <input type="password" inputMode="numeric" pattern="[0-9]*" value={disablePin}
                onChange={e => { setDisablePin(e.target.value.replace(/\D/g, '')); setError('') }}
                placeholder="Enter PIN to disable" maxLength={8} autoFocus
                className="flex-1 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50" />
              <button type="submit" disabled={!disablePin}
                className="px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-40 transition-colors">
                Confirm
              </button>
            </form>
          )}

          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      ) : showSetup ? (
        <form onSubmit={handleSetPin} className="space-y-3">
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
            <button type="button" onClick={() => { setShowSetup(false); setPin(''); setConfirmPin(''); setError('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light transition-colors">
              Enable
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">PIN lock is not configured</p>
          <button type="button" onClick={() => setShowSetup(true)}
            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
            Set up PIN
          </button>
        </div>
      )}
    </SectionCard>
  )
}

function UpdateSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.purroxy.updates.getVersion().then(setVersion)
    const unsub = window.purroxy.updates.onStatus((s: UpdateStatus) => {
      setStatus(s)
      if (s.state !== 'checking') setChecking(false)
    })
    return unsub
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setStatus(null)
    await window.purroxy.updates.check()
  }

  const handleDownload = async () => {
    await window.purroxy.updates.download()
  }

  const handleInstall = async () => {
    await window.purroxy.updates.install()
  }

  return (
    <SectionCard title="Updates" description="Check for new versions.">
      <div className="space-y-3">
        {/* Current version + check button */}
        {(!status || status.state === 'not-available' || status.state === 'error' || status.state === 'checking') && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {version ? `v${version}` : '...'}
              {status?.state === 'not-available' && (
                <span className="text-xs text-gray-400 ml-2">Up to date</span>
              )}
            </p>
            <button type="button" onClick={handleCheck} disabled={checking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-black/10 dark:hover:bg-white/15 transition-colors disabled:opacity-40">
              {checking ? (
                <><Loader2 size={12} className="animate-spin" /> Checking...</>
              ) : (
                <><RefreshCw size={12} /> Check for updates</>
              )}
            </button>
          </div>
        )}

        {status?.state === 'error' && (
          <p className="text-xs text-red-500">{status.message}</p>
        )}

        {/* Update available */}
        {status?.state === 'available' && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">v{status.version} available</p>
              <p className="text-xs text-gray-400">Current: v{version}</p>
            </div>
            <button type="button" onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
              <Download size={12} /> Download
            </button>
          </div>
        )}

        {/* Downloading */}
        {status?.state === 'downloading' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600 dark:text-gray-300">Downloading update...</p>
              <span className="text-xs text-gray-400">{status.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${status.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Downloaded — ready to install */}
        {status?.state === 'downloaded' && (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">v{status.version} ready to install</p>
              <button type="button" onClick={handleInstall}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
                <RotateCw size={12} /> Restart &amp; update
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Claude Desktop will reconnect automatically.
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
