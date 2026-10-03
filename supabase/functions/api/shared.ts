// @ts-nocheck
// Utilidades comunes de la Edge Function `api`: CORS, cliente admin, autenticación por JWT de Supabase,
// secretos en Vault (sólo service_role) y envío por Resend.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Cliente con service_role: salta RLS. Nunca sale de la función.
export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ALLOWED_ORIGINS = ['https://www.lajamonera.online', 'https://lajamonera.online', 'https://lucasponzoni.github.io'];
export const SITE_URL = 'https://www.lajamonera.online';
const isAllowedOrigin = (origin: string) => !origin
  || ALLOWED_ORIGINS.includes(origin)
  || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export const corsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) && origin ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
};

export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
});

export const bearer = (req: Request) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

// Usuario que llama (JWT de Supabase Auth) + su perfil. null si el token no es de un usuario.
export async function getCaller(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { user: data.user, profile: profile || null };
}

export async function requireActive(req: Request) {
  const caller = await getCaller(req);
  if (!caller) throw new HttpError(401, 'invalid_token');
  if (!caller.profile || !caller.profile.activo) throw new HttpError(403, 'usuario_inactivo');
  return caller;
}

export async function requireAdmin(req: Request) {
  const caller = await requireActive(req);
  if (caller.profile.role !== 'admin') throw new HttpError(403, 'admin_required');
  return caller;
}

// ---------- Vault ----------
export async function secretGet(name: string): Promise<string> {
  const { data, error } = await admin.rpc('secret_get', { p_name: name });
  if (error) throw new HttpError(500, `vault_${error.message}`);
  return str(data);
}
export async function secretSet(name: string, value: string) {
  const { error } = await admin.rpc('secret_set', { p_name: name, p_value: value });
  if (error) throw new HttpError(500, `vault_${error.message}`);
}
export async function secretDelete(name: string) {
  const { error } = await admin.rpc('secret_delete', { p_name: name });
  if (error) throw new HttpError(500, `vault_${error.message}`);
}

// ---------- Config no secreta (app_config, sólo admin la modifica) ----------
export async function configGet(key: string) {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  return (data && data.value) || {};
}
export async function configPatch(key: string, patch: Record<string, unknown>, userId?: string) {
  const current = await configGet(key);
  const value = { ...current, ...patch };
  const { error } = await admin.from('app_config').upsert({ key, value, solo_admin: true, updated_at: new Date().toISOString(), updated_by: userId || null });
  if (error) throw new HttpError(500, error.message);
  return value;
}

export const maskKey = (key: string) => {
  const k = str(key);
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••••${k.slice(-4)}`;
};

export async function audit(actor: string | null, accion: string, objetivo: string, detalle: unknown) {
  await admin.from('admin_audit').insert({ actor, accion, objetivo, detalle: detalle ?? null });
}

// ---------- Correo (Resend) ----------
export const cleanName = (value: unknown) => str(value).replace(/["<>\r\n]/g, '').trim();

export async function readEmailConfig() {
  const cfg = await configGet('_email');
  return {
    apiKey: await secretGet('resend_api_key'),
    fromEmail: str(cfg.fromEmail),
    fromName: str(cfg.fromName) || 'La Jamonera',
    updatedAt: Number(cfg.updatedAt || 0),
    updatedBy: str(cfg.updatedBy)
  };
}

export async function sendResend(cfg, { fromName, to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ from: `${cleanName(fromName) || cfg.fromName} <${cfg.fromEmail}>`, to: [to], subject, html })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, out.message || out.name || `resend_${res.status}`);
  return out;
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
