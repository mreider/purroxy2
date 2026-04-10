import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import LockScreen from './components/LockScreen'
import Home from './views/Home'
import Library from './views/Library'
import Settings from './views/Settings'
import Vault from './views/Vault'
import Community from './views/Community'
import Builder from './views/Builder'

export default function App() {
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    // Check initial lock state
    window.purroxy.lock.getConfig().then(config => {
      if (config.isLocked) setLocked(true)
    })

    // Listen for lock state changes
    const unsub = window.purroxy.lock.onStateChanged(setLocked)

    // Track user activity for auto-lock timeout
    const trackActivity = () => { window.purroxy.lock.activity() }
    window.addEventListener('mousemove', trackActivity, { passive: true })
    window.addEventListener('keydown', trackActivity, { passive: true })
    window.addEventListener('click', trackActivity, { passive: true })

    return () => {
      unsub()
      window.removeEventListener('mousemove', trackActivity)
      window.removeEventListener('keydown', trackActivity)
      window.removeEventListener('click', trackActivity)
    }
  }, [])

  if (locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="drag-region fixed top-0 left-0 right-0 h-11 z-50" />
      <Sidebar />
      <main className="flex-1 overflow-auto pt-11">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/community" element={<Community />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/builder" element={<Builder />} />
        </Routes>
      </main>
    </div>
  )
}
