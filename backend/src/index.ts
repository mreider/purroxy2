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

      // Community library
      if (path === '/api/community' && request.method === 'GET') {
        return handleCommunityList(request, env)
      }
      if (path === '/api/community/publish' && request.method === 'POST') {
        return handleCommunityPublish(request, env)
      }
      if (path.startsWith('/api/community/') && request.method === 'GET') {
        const id = path.split('/').pop()
        return handleCommunityGet(id!, env)
      }
      if (path === '/api/community/install' && request.method === 'POST') {
        return handleCommunityInstall(request, env)
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

// Community Library

async function handleCommunityList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const search = url.searchParams.get('q') || ''
  const hostname = url.searchParams.get('hostname') || ''

  let query = 'SELECT c.*, u.email as author_email FROM community_capabilities c JOIN users u ON c.user_id = u.id WHERE c.status = ?'
  const params: string[] = ['approved']

  if (search) {
    query += ' AND (c.name LIKE ? OR c.description LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  if (hostname) {
    query += ' AND c.hostname = ?'
    params.push(hostname)
  }

  query += ' ORDER BY c.install_count DESC, c.created_at DESC LIMIT 50'

  const stmt = env.DB.prepare(query)
  const results = await stmt.bind(...params).all()

  return json({
    capabilities: results.results.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      hostname: r.hostname,
      authorEmail: r.author_email,
      installCount: r.install_count,
      createdAt: r.created_at
    }))
  })
}

async function handleCommunityPublish(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Login required' }, 401)
  const userId = verifyToken(auth.slice(7), env.JWT_SECRET || 'dev-secret')
  if (!userId) return json({ error: 'Invalid token' }, 401)

  const body = await request.json() as any
  const { name, description, hostname, actions, parameters, extractionRules, viewport } = body

  if (!name || !hostname || !actions) return json({ error: 'Missing required fields' }, 400)

  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO community_capabilities (id, user_id, name, description, hostname, actions_json, parameters_json, extraction_rules_json, viewport_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, name, description || '', hostname,
    JSON.stringify(actions), JSON.stringify(parameters || []),
    JSON.stringify(extractionRules || []), JSON.stringify(viewport || null)
  ).run()

  // Grant contributor access
  const existingSub = await env.DB.prepare('SELECT id, plan FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(userId).first<any>()
  if (existingSub && existingSub.plan === 'trial') {
    await env.DB.prepare('UPDATE subscriptions SET plan = ?, status = ? WHERE id = ?')
      .bind('contributor', 'contributor', existingSub.id).run()
  }

  return json({ id, status: 'pending', message: 'Submitted for review. Publishing grants free contributor access!' })
}

async function handleCommunityGet(id: string, env: Env): Promise<Response> {
  const cap = await env.DB.prepare(
    'SELECT c.*, u.email as author_email FROM community_capabilities c JOIN users u ON c.user_id = u.id WHERE c.id = ?'
  ).bind(id).first<any>()

  if (!cap) return json({ error: 'Not found' }, 404)

  return json({
    id: cap.id,
    name: cap.name,
    description: cap.description,
    hostname: cap.hostname,
    authorEmail: cap.author_email,
    actions: JSON.parse(cap.actions_json),
    parameters: JSON.parse(cap.parameters_json),
    extractionRules: JSON.parse(cap.extraction_rules_json),
    viewport: JSON.parse(cap.viewport_json || 'null'),
    installCount: cap.install_count,
    status: cap.status,
    createdAt: cap.created_at
  })
}

async function handleCommunityInstall(request: Request, env: Env): Promise<Response> {
  const { id } = await request.json() as { id: string }
  if (!id) return json({ error: 'Missing capability ID' }, 400)

  const cap = await env.DB.prepare('SELECT * FROM community_capabilities WHERE id = ? AND status = ?')
    .bind(id, 'approved').first<any>()
  if (!cap) return json({ error: 'Capability not found or not approved' }, 404)

  // Increment install count
  await env.DB.prepare('UPDATE community_capabilities SET install_count = install_count + 1 WHERE id = ?').bind(id).run()

  return json({
    name: cap.name,
    description: cap.description,
    hostname: cap.hostname,
    actions: JSON.parse(cap.actions_json),
    parameters: JSON.parse(cap.parameters_json),
    extractionRules: JSON.parse(cap.extraction_rules_json),
    viewport: JSON.parse(cap.viewport_json || 'null')
  })
}
