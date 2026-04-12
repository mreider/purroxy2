import { ipcMain, shell, BrowserWindow, app } from 'electron'
import Store from 'electron-store'

declare const __BUILD_SECRET__: string

interface AccountSchema {
  token: string | null
  email: string | null
  userId: string | null
  plan: string | null // trial, monthly, contributor
  status: string | null // trial, active, canceled, contributor, expired
  trialEndsAt: string | null
  emailVerified: boolean
  apiUrl: string
}

const accountStore = new Store<AccountSchema>({
  name: 'account',
  defaults: {
    token: null,
    email: null,
    userId: null,
    plan: null,
    status: null,
    trialEndsAt: null,
    emailVerified: false,
    apiUrl: 'https://purroxy-api.mreider.workers.dev'
  }
})

function apiHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (__BUILD_SECRET__) headers['X-Build-Token'] = __BUILD_SECRET__
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

// Pre-release: all features are free. Subscription enforcement will be
// enabled when the app reaches v1.0.0.
const ALPHA = true

export function isLicenseValid(): boolean {
  if (ALPHA) return true

  const plan = accountStore.get('plan')
  const status = accountStore.get('status')

  if (!plan && !status) return false
  if (plan === 'contributor') return true
  if (plan === 'monthly' && (status === 'active' || status === 'trialing')) return true
  if (plan === 'trial') {
    const ends = accountStore.get('trialEndsAt')
    if (!ends) return false
    return new Date(ends) > new Date()
  }
  return false
}

export function getTrialDaysLeft(): number | null {
  const plan = accountStore.get('plan')
  if (plan !== 'trial') return null
  const ends = accountStore.get('trialEndsAt')
  if (!ends) return 0
  const diff = new Date(ends).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

function getAccountType(): string {
  const plan = accountStore.get('plan')
  const status = accountStore.get('status')
  if (!plan) return 'none'
  if (plan === 'contributor') return 'contributor'
  if (plan === 'monthly' && status === 'active') return 'subscribed'
  if (plan === 'monthly' && status === 'canceled') return 'cancelled'
  if (plan === 'trial') {
    const daysLeft = getTrialDaysLeft()
    if (daysLeft !== null && daysLeft > 0) return 'trial'
    return 'expired'
  }
  return 'expired'
}

async function refreshFromServer(): Promise<boolean> {
  const token = accountStore.get('token')
  if (!token) return false

  const apiUrl = accountStore.get('apiUrl')
  try {
    const res = await fetch(`${apiUrl}/api/stripe/status`, {
      headers: apiHeaders(token)
    })
    const data = await res.json() as any
    if (data.subscription) {
      accountStore.set('plan', data.subscription.plan)
      accountStore.set('status', data.subscription.status)
      accountStore.set('trialEndsAt', data.subscription.trialEndsAt)
    }
    return true
  } catch {
    return false
  }
}

export function setupAccount() {
  ipcMain.handle('account:getStatus', () => {
    return {
      loggedIn: !!accountStore.get('token'),
      email: accountStore.get('email'),
      plan: accountStore.get('plan'),
      status: accountStore.get('status'),
      trialEndsAt: accountStore.get('trialEndsAt'),
      trialDaysLeft: getTrialDaysLeft(),
      accountType: getAccountType(),
      emailVerified: accountStore.get('emailVerified'),
      apiUrl: accountStore.get('apiUrl')
    }
  })

  ipcMain.handle('account:signup', async (_event, email: string, password: string) => {
    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/signup`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ email, password })
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }

      accountStore.set('token', data.token)
      accountStore.set('email', data.user.email)
      accountStore.set('userId', data.user.id)
      accountStore.set('plan', 'trial')
      accountStore.set('status', 'trial')
      accountStore.set('trialEndsAt', data.trialEndsAt)
      accountStore.set('emailVerified', false)
      return { success: true, needsVerification: data.needsVerification }
    } catch (err: any) {
      return { error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.handle('account:login', async (_event, email: string, password: string) => {
    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/login`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ email, password })
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }

      accountStore.set('token', data.token)
      accountStore.set('email', data.user.email)
      accountStore.set('userId', data.user.id)
      accountStore.set('emailVerified', data.user.emailVerified || false)
      if (data.subscription) {
        accountStore.set('plan', data.subscription.plan)
        accountStore.set('status', data.subscription.status)
        accountStore.set('trialEndsAt', data.subscription.trial_ends_at)
      }
      return { success: true }
    } catch (err: any) {
      return { error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.handle('account:logout', () => {
    accountStore.set('token', null)
    accountStore.set('email', null)
    accountStore.set('userId', null)
    accountStore.set('plan', null)
    accountStore.set('status', null)
    accountStore.set('trialEndsAt', null)
    accountStore.set('emailVerified', false)
    return true
  })

  ipcMain.handle('account:validate', async () => {
    const token = accountStore.get('token')
    if (!token) return { valid: false }

    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/validate`, {
        headers: apiHeaders(token)
      })
      const data = await res.json() as any
      if (data.subscription) {
        accountStore.set('plan', data.subscription.plan)
        accountStore.set('status', data.subscription.status)
        accountStore.set('trialEndsAt', data.subscription.trialEndsAt)
      }
      return data
    } catch {
      // Offline — use cached status
      return { valid: isLicenseValid(), offline: true }
    }
  })

  ipcMain.handle('account:subscribe', async () => {
    const token = accountStore.get('token')
    if (!token) return { error: 'Not logged in' }

    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/stripe/create-checkout`, {
        method: 'POST',
        headers: apiHeaders(token)
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }
      if (data.url) {
        shell.openExternal(data.url)
        return { success: true }
      }
      return { error: 'No checkout URL returned' }
    } catch (err: any) {
      return { error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.handle('account:manageSubscription', async () => {
    const token = accountStore.get('token')
    if (!token) return { error: 'Not logged in' }

    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/stripe/portal`, {
        method: 'POST',
        headers: apiHeaders(token)
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }
      if (data.url) {
        shell.openExternal(data.url)
        return { success: true }
      }
      return { error: 'No portal URL returned' }
    } catch (err: any) {
      return { error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.handle('account:canUse', () => {
    if (ALPHA) return { allowed: true }

    const loggedIn = !!accountStore.get('token')
    if (!loggedIn) {
      return { allowed: false, reason: 'Please sign in to use Purroxy.' }
    }

    if (isLicenseValid()) {
      return { allowed: true }
    }

    const accountType = getAccountType()
    if (accountType === 'expired') {
      return {
        allowed: false,
        reason: 'Your free trial has ended. Subscribe or share a capability for free access.'
      }
    }
    if (accountType === 'cancelled') {
      return {
        allowed: false,
        reason: 'Your subscription has been cancelled. Resubscribe or share a capability for free access.'
      }
    }
    return {
      allowed: false,
      reason: 'A subscription is required. Subscribe or share a capability for free access.'
    }
  })

  ipcMain.handle('account:refresh', async () => {
    const success = await refreshFromServer()
    if (success) {
      return {
        success: true,
        plan: accountStore.get('plan'),
        status: accountStore.get('status'),
        accountType: getAccountType()
      }
    }
    return { success: false, error: 'Could not reach server' }
  })

  // Auto-refresh account status when window gains focus (catches post-checkout state)
  app.on('browser-window-focus', () => {
    if (accountStore.get('token')) {
      refreshFromServer()
    }
  })
}
