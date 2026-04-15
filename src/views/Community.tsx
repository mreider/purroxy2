import { Users } from 'lucide-react'

export default function Community() {
  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Community</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Discover and install shared capabilities
        </p>
      </div>

      <div className="rounded-xl border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10 p-5">
        <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">Coming soon</h3>
        <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
          Community publishing, browsing, and installing are not available yet.
          Purroxy is currently a <strong>local-only</strong> tool &mdash; you can record and run
          capabilities on your own machine, but sharing them with others is still being built.
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-3">
          In the meantime, you can export capabilities from the Library and share them manually.{' '}
          <a href="https://github.com/KuvopLLC/purroxy2/issues" target="_blank" rel="noopener noreferrer"
            className="underline hover:no-underline">Follow progress on GitHub</a>.
        </p>
      </div>

      <div className="flex flex-col items-center text-center py-12 text-gray-400 dark:text-gray-600">
        <Users size={40} className="mb-4 opacity-30" />
        <p>Community features will be available in a future release</p>
      </div>
    </div>
  )
}
