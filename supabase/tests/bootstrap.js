// Alta del admin inicial + secretos de Firebase → Supabase (Vault). Lee Firebase sólo lectura.
const fs = require('fs'); const path = require('path');
const lj = require('C:/Users/Lucas/Documents/GitHub/La-Jamonera/tools/facturas/lj.js');
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.la-jamonera-supabase-local.json'), 'utf8'));
(async () => {
  const ai = (await lj.get('/_secure/ai')) || {};
  const email = (await lj.get('/_secure/email')) || {};
  const theme = await lj.get('/userPreferences/dVqvWmyjROhsJgnPvBPjvVgXkFZ2/theme').catch(() => null);
  const body = {
    token: cfg.bootstrapToken,
    ai: ai.apiKey ? { apiKey: ai.apiKey, textModel: ai.textModel, imageModel: ai.imageModel, updatedAt: ai.updatedAt, updatedBy: ai.updatedBy } : null,
    email: { apiKey: email.apiKey || '', fromEmail: email.fromEmail || '', fromName: email.fromName || 'La Jamonera', updatedAt: email.updatedAt, updatedBy: email.updatedBy },
    adminUser: process.env.LJ_ADMIN_PASS ? { email: 'lajamonera@abr.com', password: process.env.LJ_ADMIN_PASS, nombre: 'La Jamonera', theme: typeof theme === 'string' ? theme : null } : null,
    finish: process.argv.includes('--finish')
  };
  console.log('Firebase:', { ai: Boolean(ai.apiKey), aiModels: [ai.textModel, ai.imageModel], resendKey: Boolean(email.apiKey), fromEmail: Boolean(email.fromEmail), theme });
  const r = await fetch(`${cfg.url}/functions/v1/api/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.anonKey}` }, body: JSON.stringify(body) });
  console.log(r.status, await r.text());
})().catch((e) => { console.error('FALLA', e.message); process.exit(1); });
