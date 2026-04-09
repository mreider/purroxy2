import { useEffect, useState, useRef, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Loader2, Circle, Square, MousePointerClick, Type, Navigation, List, ArrowDown, Clock, Save, ShieldCheck, CheckCircle, ChevronRight } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'

const ACTION_ICONS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick, type: Type, navigate: Navigation,
  select: List, scroll: ArrowDown, wait: Clock
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  hidden?: boolean // hidden from display but sent to AI
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

  const [sessionSaved, setSessionSaved] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [actions, setActions] = useState<RecordedAction[]>([])
  const [tab, setTab] = useState<'chat' | 'recording'>('chat')
  const [capabilitySaved, setCapabilitySaved] = useState(false)

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [autoAnalyzed, setAutoAnalyzed] = useState(false)
  // Track which buttons have been clicked (by message index + button type)
  const [clickedButtons, setClickedButtons] = useState<Set<string>>(new Set())

  const actionsRef = useRef<RecordedAction[]>([])
  actionsRef.current = actions

  useEffect(() => {
    if (initialUrl) openSite(initialUrl)
    return () => { window.purroxy.browser.close() }
  }, [])

  useEffect(() => {
    const unsubUrl = window.purroxy.browser.onUrlChanged((newUrl) => {
      setUrl(newUrl); setUrlInput(newUrl)
    })
    const unsubTitle = window.purroxy.browser.onTitleChanged(setTitle)
    const unsubLoading = window.purroxy.browser.onLoading(setLoading)
    return () => { unsubUrl(); unsubTitle(); unsubLoading() }
  }, [])

  useEffect(() => {
    const unsub = window.purroxy.recorder.onAction((action) => {
      setActions(prev => [...prev, action])
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!browserOpen || autoAnalyzed || loading) return
    const timer = setTimeout(async () => {
      if (autoAnalyzed) return
      setAutoAnalyzed(true)
      await sendAIMessage('Check this page. If it requires login, tell me to log in and show the Done button. If I\'m already logged in, suggest capabilities I could build.')
    }, 1500)
    return () => clearTimeout(timer)
  }, [browserOpen, loading, autoAnalyzed])

  const sendAIMessage = useCallback(async (userMessage: string, opts?: { isSystem?: boolean; hidden?: boolean }) => {
    setChatLoading(true)
    const newMsg: ChatMessage = {
      role: opts?.isSystem ? 'system' : 'user',
      content: userMessage,
      hidden: opts?.hidden
    }

    setChatMessages(prev => {
      const updated = [...prev, newMsg]
      doChat(updated)
      return updated
    })
  }, [])

  const doChat = async (messages: ChatMessage[]) => {
    // Build API messages — include hidden ones for context
    const apiMessages = messages.map(m => ({
      role: (m.role === 'system' ? 'user' : m.role) as 'user' | 'assistant',
      content: m.content
    }))

    const pageContent = await window.purroxy.ai.getPageContent()
    let context = pageContent
    const currentActions = actionsRef.current
    if (currentActions.length > 0) {
      const recent = currentActions.slice(-20)
      context += `\n\nRecorded actions (${currentActions.length} total, last ${recent.length}):\n${JSON.stringify(recent, null, 2)}`
    }

    const result = await window.purroxy.ai.chat(apiMessages, context)
    if (result.error) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.error}` }])
    } else if (result.content) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: result.content }])
    }
    setChatLoading(false)
  }

  const openSite = async (targetUrl: string) => {
    const normalized = targetUrl.includes('://') ? targetUrl : 'https://' + targetUrl
    await window.purroxy.browser.open(normalized)
    setBrowserOpen(true); setUrl(normalized); setUrlInput(normalized)
  }

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) openSite(urlInput.trim())
  }

  const handleSaveSession = async () => {
    const pageInfo = await window.purroxy.browser.getPageInfo()
    const session = await window.purroxy.browser.captureSession()
    if (!pageInfo || !session) return
    const site = await window.purroxy.sites.create(pageInfo.url, pageInfo.title, pageInfo.faviconUrl)
    await window.purroxy.sites.saveSession(site.id, session)
    setSessionSaved(true)
    // Notify AI
    await sendAIMessage('[Session saved successfully. The user is now logged in.]', { isSystem: true, hidden: true })
  }

  const handleStartRecording = async () => {
    setActions([])
    const ok = await window.purroxy.recorder.start()
    if (ok) {
      setIsRecording(true)
      setChatMessages(prev => [...prev, {
        role: 'system',
        content: '🔴 **Recording started.** Explore the site freely — click, navigate, fill forms. You can\'t go wrong. Mistakes are fine, I\'ll figure out what matters. The more you show me, the better.\n\n{{STOP_RECORDING}}'
      }])
    }
  }

  const handleStopRecording = async () => {
    await window.purroxy.recorder.stop()
    setIsRecording(false)
    const count = actionsRef.current.length
    // Show clean message to user
    setChatMessages(prev => [...prev, {
      role: 'system',
      content: `Recording stopped — **${count} actions** captured.`
    }])
    // Send full actions to AI as hidden context
    await sendAIMessage(
      `[RECORDING STOPPED — ${count} actions captured]\n\nActions:\n${JSON.stringify(actionsRef.current, null, 2)}`,
      { isSystem: true, hidden: true }
    )
  }

  const handleSaveCapability = async () => {
    // Get or create site profile
    const pageInfo = await window.purroxy.browser.getPageInfo()
    if (!pageInfo) return

    const site = await window.purroxy.sites.create(pageInfo.url, pageInfo.title, pageInfo.faviconUrl)

    // Show saving status
    setChatMessages(prev => [...prev, {
      role: 'system',
      content: 'Analyzing your recording and generating capability definition...'
    }])
    setChatLoading(true)

    // AI generates structured capability from recorded actions + chat context
    const chatContext = chatMessages
      .filter(m => !m.hidden)
      .map(m => ({ role: m.role, content: m.content }))

    const result = await window.purroxy.ai.generateCapability(actionsRef.current, chatContext)

    if (result.error) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Failed to save: ${result.error}` }])
      setChatLoading(false)
      return
    }

    const cap = result.capability!

    // Save the capability
    const saved = await window.purroxy.capabilities.create({
      siteProfileId: site.id,
      name: cap.name,
      description: cap.description,
      actions: actionsRef.current,
      parameters: cap.parameters,
      extractionRules: cap.extractionRules
    })

    setCapabilitySaved(true)
    setChatLoading(false)

    // Show summary
    const paramList = cap.parameters.length > 0
      ? cap.parameters.map(p => `- **${p.name}**: ${p.description}`).join('\n')
      : '- None (all values are fixed)'

    const extractList = cap.extractionRules.length > 0
      ? cap.extractionRules.map(e => `- **${e.name}**${e.sensitive ? ' (sensitive)' : ''}`).join('\n')
      : '- None defined'

    setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: `**"${cap.name}"** saved!\n\n${cap.description}\n\n**Parameters** (vary each run):\n${paramList}\n\n**Data extracted**:\n${extractList}\n\nThis capability is now in your Library and ready to use.\n\n{{BUILD_ANOTHER}}`
    }])
  }

  const handleBuildAnother = async () => {
    setActions([])
    setCapabilitySaved(false)
    setClickedButtons(new Set())
    await sendAIMessage('I want to build another capability on this site. What do you suggest?')
  }

  const handleClose = async () => {
    if (isRecording) await window.purroxy.recorder.stop()
    await window.purroxy.browser.close()
    setBrowserOpen(false); navigate('/')
  }

  const markButtonClicked = (key: string) => {
    setClickedButtons(prev => new Set([...prev, key]))
  }

  return (
    <div className="flex flex-col h-full" style={{ width: 380 }}>
      {/* Navigation bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-black/5 dark:border-white/5">
        <button onClick={() => window.purroxy.browser.back()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Back"><ArrowLeft size={16} /></button>
        <button onClick={() => window.purroxy.browser.forward()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Forward"><ArrowRight size={16} /></button>
        <button onClick={() => window.purroxy.browser.reload()} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Reload">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
        </button>
        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
          <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Enter a website URL..." className="w-full px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </form>
        <button onClick={handleClose} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400" title="Close"><X size={16} /></button>
      </div>

      {/* Tab bar */}
      {browserOpen && (
        <div className="flex border-b border-black/5 dark:border-white/5">
          <button onClick={() => setTab('chat')} className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'chat' ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            Chat {chatLoading && <Loader2 size={10} className="inline ml-1 animate-spin" />}
          </button>
          <button onClick={() => setTab('recording')} className={`flex-1 py-2 text-xs font-medium transition-colors relative ${tab === 'recording' ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
            Recording
            {actions.length > 0 && <span className="ml-1 text-[10px] bg-accent/20 text-accent px-1.5 rounded-full">{actions.length}</span>}
            {isRecording && <span className="ml-1 w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />}
          </button>
        </div>
      )}

      {/* Panel content */}
      <div className="flex-1 flex flex-col min-h-0">
        {!browserOpen ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Enter a website URL above to get started.</p>
          </div>
        ) : tab === 'chat' ? (
          <ChatPanel
            messages={chatMessages}
            loading={chatLoading}
            input={chatInput}
            onInputChange={setChatInput}
            onSend={(msg) => { setChatInput(''); sendAIMessage(msg) }}
            isRecording={isRecording}
            sessionSaved={sessionSaved}
            capabilitySaved={capabilitySaved}
            clickedButtons={clickedButtons}
            onButtonClick={markButtonClicked}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onSaveSession={handleSaveSession}
            onSaveCapability={handleSaveCapability}
            onBuildAnother={handleBuildAnother}
          />
        ) : (
          <RecordingPanel isRecording={isRecording} actions={actions} onStart={handleStartRecording} onStop={handleStopRecording} />
        )}
      </div>
    </div>
  )
}

/* ============ Chat Panel ============ */

function ChatPanel({ messages, loading, input, onInputChange, onSend, isRecording, sessionSaved, capabilitySaved, clickedButtons, onButtonClick, onStartRecording, onStopRecording, onSaveSession, onSaveCapability, onBuildAnother }: {
  messages: ChatMessage[]
  loading: boolean
  input: string
  onInputChange: (val: string) => void
  onSend: (msg: string) => void
  isRecording: boolean
  sessionSaved: boolean
  capabilitySaved: boolean
  clickedButtons: Set<string>
  onButtonClick: (key: string) => void
  onStartRecording: () => Promise<void>
  onStopRecording: () => Promise<void>
  onSaveSession: () => Promise<void>
  onSaveCapability: () => Promise<void>
  onBuildAnother: () => Promise<void>
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !loading) onSend(input.trim())
  }

  const renderButton = (type: string, msgIndex: number, partIndex: number) => {
    const key = `${msgIndex}-${type}`
    const wasClicked = clickedButtons.has(key)

    if (type === 'START_RECORDING') {
      // Hide if recording or was clicked
      if (isRecording || wasClicked) return null
      return (
        <button key={`btn-${key}-${partIndex}`} onClick={async () => { onButtonClick(key); await onStartRecording() }}
          className="my-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition-colors">
          <Circle size={12} className="fill-current" /> Start Recording
        </button>
      )
    }
    if (type === 'STOP_RECORDING') {
      // Only show if recording
      if (!isRecording) return null
      return (
        <button key={`btn-${key}-${partIndex}`} onClick={async () => { onButtonClick(key); await onStopRecording() }}
          className="my-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium transition-colors">
          <Square size={10} className="fill-current" /> Stop Recording
        </button>
      )
    }
    if (type === 'SAVE_SESSION' || type === 'DONE') {
      if (wasClicked || sessionSaved) return null
      return (
        <button key={`btn-${key}-${partIndex}`} onClick={async () => { onButtonClick(key); await onSaveSession() }}
          className="my-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
          <ShieldCheck size={12} /> Done
        </button>
      )
    }
    if (type === 'SAVE_CAPABILITY') {
      if (wasClicked || capabilitySaved) return null
      return (
        <button key={`btn-${key}-${partIndex}`} onClick={async () => { onButtonClick(key); await onSaveCapability() }}
          className="my-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors">
          <CheckCircle size={12} /> Save Capability
        </button>
      )
    }
    if (type === 'BUILD_ANOTHER') {
      if (wasClicked) return null
      return (
        <button key={`btn-${key}-${partIndex}`} onClick={async () => { onButtonClick(key); await onBuildAnother() }}
          className="my-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors">
          <ChevronRight size={12} /> Build Another Capability
        </button>
      )
    }
    return null
  }

  const renderContent = (content: string, msgIndex: number) => {
    const parts = content.split(/({{START_RECORDING}}|{{STOP_RECORDING}}|{{SAVE_SESSION}}|{{DONE}}|{{SAVE_CAPABILITY}}|{{BUILD_ANOTHER}})/)

    return parts.map((part, i) => {
      const match = part.match(/^{{(\w+)}}$/)
      if (match) return renderButton(match[1], msgIndex, i)
      if (!part.trim()) return null
      return (
        <ReactMarkdown key={`md-${msgIndex}-${i}`}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="leading-snug">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em: ({ children }) => <em>{children}</em>,
            code: ({ children }) => <code className="bg-black/10 dark:bg-white/10 px-1 rounded text-[11px]">{children}</code>,
          }}
        >
          {part}
        </ReactMarkdown>
      )
    })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 dark:text-gray-500">Analyzing the page...</p>
          </div>
        )}
        {messages.filter(m => !m.hidden).map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right' : ''}`}>
            {msg.role === 'user' ? (
              <div className="inline-block bg-accent text-white rounded-lg px-3 py-2 max-w-[90%] text-left text-xs">{msg.content}</div>
            ) : msg.role === 'system' ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-lg px-3 py-2 text-xs text-red-800 dark:text-red-300">
                {renderContent(msg.content, i)}
              </div>
            ) : (
              <div className="bg-black/5 dark:bg-white/5 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 text-xs leading-relaxed">
                {renderContent(msg.content, i)}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={12} className="animate-spin" /> Thinking...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex-shrink-0 p-3 border-t border-black/5 dark:border-white/5">
        <div className="flex gap-2">
          <input type="text" value={input} onChange={(e) => onInputChange(e.target.value)}
            placeholder={isRecording ? 'Recording... interact with the site' : 'Ask the guide...'}
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50" />
          <button type="submit" disabled={!input.trim() || loading}
            className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Send
          </button>
        </div>
      </form>
    </div>
  )
}

/* ============ Recording Panel ============ */

function RecordingPanel({ isRecording, actions, onStart, onStop }: {
  isRecording: boolean; actions: RecordedAction[]; onStart: () => void; onStop: () => void
}) {
  const listEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [actions.length])

  return (
    <div className="flex flex-col flex-1 min-h-0">
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
                  <div className="mt-0.5"><Icon size={12} className="text-gray-400" /></div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium capitalize">{action.type}</span>
                    {action.label && <span className="text-gray-400 dark:text-gray-500 ml-1">{action.label.length > 40 ? action.label.slice(0, 40) + '...' : action.label}</span>}
                    {action.type === 'type' && <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">{action.sensitive ? '••••••' : action.value}</div>}
                    {action.type === 'navigate' && <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">{action.url}</div>}
                    {action.type === 'select' && action.value && <div className="text-gray-400 dark:text-gray-500 mt-0.5 truncate">{action.value}</div>}
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
