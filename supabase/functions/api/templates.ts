// @ts-nocheck
// Plantilla de invitación (editable desde el modal Usuarios) y utilidades de render/saneo.
export const VARIABLES = ['nombre', 'email', 'rol', 'empresa', 'link', 'vence', 'remitente'];

export const DEFAULT_INVITE = {
  asunto: 'Te invitaron a La Jamonera',
  html: `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f6f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2a44">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e1e5ec;border-radius:6px;overflow:hidden">
        <tr><td style="background:#1b4785;padding:28px 32px">
          <img src="https://www.lajamonera.online/IMG/La%20Jamonera%20Cerdito.webp" alt="La Jamonera" width="48" height="48" style="display:block;filter:brightness(0) invert(1)">
          <p style="margin:12px 0 0;font-size:22px;color:#ffffff"><span style="font-weight:400">La</span> <strong>Jamonera</strong></p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700">Hola {{nombre}}</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#55607f">Te dieron acceso al sistema de gestión de <strong>{{empresa}}</strong> con el rol <strong>{{rol}}</strong>. Tu usuario es <strong>{{email}}</strong>.</p>
          <p style="margin:24px 0"><a href="{{link}}" style="display:inline-block;background:#1f5fbf;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">Activar mi cuenta</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#55607f">El link vence el {{vence}} y sirve una sola vez. Si no esperabas este correo, ignoralo.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e1e5ec;font-size:12px;color:#55607f">
          Enviado por {{remitente}} · Software de <strong>Ninja Soft</strong>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
};

export function sanitizeHtml(html: string) {
  return String(html || '')
    .replace(/<\s*(script|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed)[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return String(tpl || '').replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (m, name) => {
    const key = name.toLowerCase();
    if (!(key in vars)) return m;
    return key === 'link' ? encodeURI(decodeURI(String(vars[key]))) : escapeHtml(vars[key]);
  });
}

export function validateTemplate(asunto: string, html: string) {
  if (!String(asunto || '').trim()) return 'asunto_requerido';
  if (!/\{\{\s*link\s*\}\}/i.test(String(html || ''))) return 'falta_variable_link';
  if (String(html).length > 200000) return 'plantilla_muy_grande';
  return '';
}

export const formatVence = (date: Date) => new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(date);
