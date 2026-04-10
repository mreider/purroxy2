/**
 * Purroxy API — Cloudflare Worker
 * Handles auth, subscriptions, and license validation
 */

export interface Env {
  DB: D1Database
  TRIAL_DAYS: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  JWT_SECRET?: string
}

interface RequestContext {
  env: Env
  userId?: string
}

// Simple JWT-like token (for demo — use proper JWT in production)
function createToken(userId: string, secret: string): string {
  const payload = btoa(JSON.stringify({ sub: userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }))
  const sig = btoa(String(payload.length + secret.length)) // Simplified — use HMAC in production
  return `${payload}.${sig}`
}

function verifyToken(token: string, secret: string): string | null {
  try {
    const [payload] = token.split('.')
    const data = JSON.parse(atob(payload))
    if (data.exp < Date.now()) return null
    return data.sub
  } catch { return null }
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'purroxy-salt')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
}

function cors(): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors()

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Auth routes
      if (path === '/api/signup' && request.method === 'POST') {
        return handleSignup(request, env)
      }
      if (path === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env)
      }
      if (path === '/api/validate' && request.method === 'GET') {
        return handleValidate(request, env)
      }
      if (path === '/api/status' && request.method === 'GET') {
        return handleStatus(request, env)
      }

      return json({ error: 'Not found' }, 404)
    } catch (err: any) {
      return json({ error: err.message }, 500)
    }
  }
}

async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email: string; password: string }

  if (!email || !password) return json({ error: 'Email and password required' }, 400)
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)

  // Check if user exists
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first()
  if (existing) return json({ error: 'Email already registered' }, 409)

  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const trialDays = parseInt(env.TRIAL_DAYS || '14')
  const trialEnds = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()

  // Create user + trial subscription
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .bind(id, email.toLowerCase(), passwordHash),
    env.DB.prepare('INSERT INTO subscriptions (id, user_id, status, plan, trial_ends_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, 'trial', 'trial', trialEnds)
  ])

  const token = createToken(id, env.JWT_SECRET || 'dev-secret')
  return json({ token, user: { id, email: email.toLowerCase() }, trialEndsAt: trialEnds })
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email: string; password: string }

  if (!email || !password) return json({ error: 'Email and password required' }, 400)

  const user = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email.toLowerCase()).first<{ id: string; email: string; password_hash: string }>()

  if (!user) return json({ error: 'Invalid email or password' }, 401)

  const hash = await hashPassword(password)
  if (hash !== user.password_hash) return json({ error: 'Invalid email or password' }, 401)

  const token = createToken(user.id, env.JWT_SECRET || 'dev-secret')

  // Get subscription
  const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(user.id).first()

  return json({ token, user: { id: user.id, email: user.email }, subscription: sub })
}

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json({ valid: false, error: 'No token' }, 401)

  const userId = verifyToken(auth.slice(7), env.JWT_SECRET || 'dev-secret')
  if (!userId) return json({ valid: false, error: 'Invalid or expired token' }, 401)

  const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(userId).first<any>()

  if (!sub) return json({ valid: false, error: 'No subscription' }, 403)

  // Check if access is valid
  const now = new Date().toISOString()
  const isActive = sub.status === 'active' || sub.status === 'contributor' ||
    (sub.status === 'trial' && sub.trial_ends_at > now)

  return json({
    valid: isActive,
    subscription: {
      status: sub.status,
      plan: sub.plan,
      trialEndsAt: sub.trial_ends_at
    }
  })
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  return json({ status: 'ok', version: '0.1.0' })
}
