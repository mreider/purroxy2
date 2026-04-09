import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Home from './views/Home'
import Library from './views/Library'
import Settings from './views/Settings'
import Builder from './views/Builder'

export default function App() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Titlebar drag region */}
      <div className="drag-region fixed top-0 left-0 right-0 h-11 z-50" />

      <Sidebar />

      <main className="flex-1 overflow-auto pt-11">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/builder" element={<Builder />} />
        </Routes>
      </main>
    </div>
  )
}
