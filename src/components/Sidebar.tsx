import { NavLink } from 'react-router-dom'
import { Home, Library, Lock, Users, Settings } from 'lucide-react'
import logo from '../assets/logo.png'

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/vault', icon: Lock, label: 'Vault' },
  { to: '/community', icon: Users, label: 'Community' },
  { to: '/settings', icon: Settings, label: 'Settings' }
]

export default function Sidebar() {
  return (
    <aside className="w-20 bg-white/5 dark:bg-white/5 flex flex-col items-center pt-12 pb-4 gap-2 border-r border-black/5 dark:border-white/5">
      {/* Logo */}
      <div className="mb-4" title="Purroxy">
        <img src={logo} alt="Purroxy" className="w-9 h-9 rounded-lg" />
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `no-drag w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? 'bg-accent text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
              }`
            }
            title={label}
          >
            <Icon size={20} />
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
