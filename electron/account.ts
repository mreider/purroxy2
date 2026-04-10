import { ipcMain } from 'electron'
import Store from 'electron-store'

interface AccountSchema {
  token: string | null
  email: string | null
  userId: string | null
  plan: string | null // trial, monthly, contributor
  trialEndsAt: string | null
  apiUrl: string
}

const accountStore = new Store<AccountSchema>({
  name: 'account',
  defaults: {
    token: null,
    email: null,
    userId: null,
    plan: null,
    trialEndsAt: null,
    apiUrl: 'https://purroxy-api.your-domain.workers.dev' // Replace when deployed
  }
})

export function isLicenseValid(): boolean {
  const plan = accountStore.get('plan')
  if (!plan) return true // No account = no enforcement yet (dev mode)
  if (plan === 'monthly' || plan === 'contributor') return true
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

export function setupAccount() {
  ipcMain.handle('account:getStatus', () => {
    return {
      loggedIn: !!accountStore.get('token'),
      email: accountStore.get('email'),
      plan: accountStore.get('plan'),
      trialEndsAt: accountStore.get('trialEndsAt'),
      trialDaysLeft: getTrialDaysLeft(),
      apiUrl: accountStore.get('apiUrl')
    }
  })

  ipcMain.handle('account:signup', async (_event, email: string, password: string) => {
    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }

      accountStore.set('token', data.token)
      accountStore.set('email', data.user.email)
      accountStore.set('userId', data.user.id)
      accountStore.set('plan', 'trial')
      accountStore.set('trialEndsAt', data.trialEndsAt)
      return { success: true }
    } catch (err: any) {
      return { error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.handle('account:login', async (_event, email: string, password: string) => {
    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json() as any
      if (data.error) return { error: data.error }

      accountStore.set('token', data.token)
      accountStore.set('email', data.user.email)
      accountStore.set('userId', data.user.id)
      if (data.subscription) {
        accountStore.set('plan', data.subscription.plan)
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
    accountStore.set('trialEndsAt', null)
    return true
  })

  ipcMain.handle('account:validate', async () => {
    const token = accountStore.get('token')
    if (!token) return { valid: false }

    const apiUrl = accountStore.get('apiUrl')
    try {
      const res = await fetch(`${apiUrl}/api/validate`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json() as any
      if (data.subscription) {
        accountStore.set('plan', data.subscription.plan)
        accountStore.set('trialEndsAt', data.subscription.trialEndsAt)
      }
      return data
    } catch {
      // Offline — use cached status
      return { valid: isLicenseValid(), offline: true }
    }
  })
}
