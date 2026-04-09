import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Loader2, Shield, ShieldCheck, Save, Circle, Square, MousePointerClick, Type, Navigation, List, ArrowDown, Clock } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const ACTION_ICONS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick,
  type: Type,
  navigate: Navigation,
  select: List,
  scroll: ArrowDown,
  wait: Clock
}

export default function Builder() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialUrl = searchParams.get('url') || ''

  const [url, setUrl] = useState(initialUrl)
  const [urlInput, setUrlInput] = useState(initialUrl)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  // Auth state
  const [loginDetected, setLoginDetected] = useState(false)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null)
  const [saving, setSaving] = useState(false)

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [actions, setActions] = useState<RecordedAction[]>([])
  const [tab, setTab] = useState<'session' | 'recording'>('session')

  useEffect(() => {
    if (initialUrl) openSite(initialUrl)
    return () => { window.purroxy.browser.close() }
  }, [])

  useEffect(() => {
    const unsubUrl = window.purroxy.browser.onUrlChanged((newUrl) => {
      setUrl(newUrl)
      setUrlInput(newUrl)
      checkForLogin()
    })
    const unsubTitle = window.purroxy.browser.onTitleChanged(setTitle)
    const unsubLoading = window.purroxy.browser.onLoading((l) => {
      setLoading(l)
      if (!l) setTimeout(checkForLogin, 500)
    })
    return () => { unsubUrl(); unsubTitle(); unsubLoading() }
  }, [])

  // Listen for recorded actions
  useEffect(() => {
    const unsub = window.purroxy.recorder.onAction((action) => {
      setActions((prev) => [...prev, action])
    })
    return unsub
  }, [])

  const checkForLogin = async () => {
    try {
      const result = await window.purroxy.browser.detectLogin()
      setLoginDetected(result.hasLogin)
    } catch {}
  }

  const openSite = async (targetUrl: string) => {
    const normalized = targetUrl.includes('://') ? targetUrl : 'https://' + targetUrl
    await window.purroxy.browser.open(normalized)
    setBrowserOpen(true)
    setUrl(normalized)
    setUrlInput(normalized)
  }

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) openSite(urlInput.trim())
  }

  const handleSaveSession = async () => {
    setSaving(true)
    try {
      const pageInfo = await window.purroxy.browser.getPageInfo()
      const session = await window.purroxy.browser.captureSession()
      if (!pageInfo || !session) return
      const site = await window.purroxy.sites.create(pageInfo.url, pageInfo.title, pageInfo.faviconUrl)
      await window.purroxy.sites.saveSession(site.id, session)
      setSiteProfile(site)
      setSessionSaved(true)
    } catch (err) {
      console.error('Failed to save session:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleStartRecording = async () => {
    setActions([])
    const ok = await window.purroxy.recorder.start()
    if (ok) {
      setIsRecording(true)
      setTab('recording')
    }
  }

  const handleStopRecording = async () => {
    await window.purroxy.recorder.stop()
    setIsRecording(false)
  }

  const handleClose = async () => {
    if (isRecording) await window.purroxy.recorder.stop()
    await window.purroxy.browser.close()
    setBrowserOpen(false)
    navigate('/')
  }

  return (
    <div className="flex flex-col h-full" style={{ width: 380 }}>
      {/* Navigation bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-black/5 dark:border-white/5">
        <button onClick={() => window.purroxy.browser.back()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Back">
          <ArrowLeft size={16} />
        </button>
        <button onClick={() => window.purroxy.browser.forward()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Forward">
          <ArrowRight size={16} />
        </button>
        <button onClick={() => window.purroxy.browser.reload()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Reload">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
        </button>
        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
          <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Enter a website URL..." className="w-full px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </form>
        <button onClick={handleClose} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      {browserOpen && (
        <div className="flex border-b border-black/5 dark:border-white/5">
          <button onClick={() => setTab('session')} className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'session' ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            Session
          </button>
          <button onClick={() => setTab('recording')} className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'recording' ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            Recording {actions.length > 0 && <span className="ml-1 text-[10px] bg-accent/20 text-accent px-1.5 rounded-full">{actions.length}</span>}
          </button>
        </div>
      )}

      {/* Panel content */}
      <div className="flex-1 flex flex-col min-h-0">
        {!browserOpen ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Enter a website URL above to get started.</p>
          </div>
        ) : tab === 'session' ? (
          /* Session tab */
          <div className="p-4 space-y-4 overflow-auto">
            <div>
              <p className="text-sm font-medium mb-0.5">{title || 'Loading...'}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{url}</p>
            </div>

            {sessionSaved ? (
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck size={16} className="text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">Session saved</p>
                </div>
                <p className="text-xs text-green-700 dark:text-green-400/80">
                  Encrypted and stored locally. Capabilities for {siteProfile?.hostname} can now run without re-authenticating.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
                    {loginDetected ? (
                      <><Shield size={14} className="inline text-amber-500 mr-1" />Login form detected — log in first, then save.</>
                    ) : (
                      <>If this site requires login, log in now in the browser. Then save your session.</>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Your credentials stay in the browser — Purroxy never sees them.</p>
                </div>
                <button onClick={handleSaveSession} disabled={saving} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors disabled:opacity-60">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save Session</>}
                </button>
              </>
            )}
          </div>
        ) : (
          /* Recording tab */
          <RecordingPanel
            isRecording={isRecording}
            actions={actions}
            onStart={handleStartRecording}
            onStop={handleStopRecording}
          />
        )}
      </div>
    </div>
  )
}

function RecordingPanel({ isRecording, actions, onStart, onStop }: {
  isRecording: boolean
  actions: RecordedAction[]
  onStart: () => void
  onStop: () => void
}) {
  const listEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new actions arrive
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [actions.length])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Sticky controls */}
      <div className="flex-shrink-0 p-4 pb-2 space-y-2 border-b border-black/5 dark:border-white/5">
        <div className="flex gap-2">
          {!isRecording ? (
            <button onClick={onStart} className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
              <Circle size={14} className="fill-current" /> Start Recording
            </button>
          ) : (
            <button onClick={onStop} className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium transition-colors">
              <Square size={12} className="fill-current" /> Stop Recording
            </button>
          )}
        </div>
        {isRecording && (
          <div className="flex items-center gap-2 text-xs text-red-500">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Recording — {actions.length} action{actions.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Scrollable action list */}
      <div className="flex-1 overflow-auto p-4 pt-2">
        {actions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {isRecording ? 'Waiting for interactions...' : 'Hit "Start Recording" then interact with the site.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {actions.map((action, i) => {
              const Icon = ACTION_ICONS[action.type] || MousePointerClick
              return (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-black/5 dark:bg-white/5 text-xs">
                  <div className="mt-0.5">
                    <Icon size={12} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium capitalize">{action.type}</span>
                    {action.label && (
                      <span className="text-gray-400 dark:text-gray-500 ml-1">
                        {action.label.length > 40 ? action.label.slice(0, 40) + '...' : action.label}
                      </span>
                    )}
                    {action.type === 'type' && (
                      <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                        {action.sensitive ? '••••••' : action.value}
                      </div>
                    )}
                    {(action.type === 'navigate') && (
                      <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">{action.url}</div>
                    )}
                    {(action.type === 'select') && action.value && (
                      <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">{action.value}</div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={listEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
