(function emailSenderModule() {
  // La clave de Resend vive en la Cloud Function (Configuración → Correo electrónico),
  // ya no en el navegador. Este modulo solo arma el pedido y lo manda al proxy
  // (https://southamerica-east1-fg-lj-d6325.cloudfunctions.net/api/email).

  const ensureConfigLoaded = async () => {
    if (window.laJamoneraReady) {
      try { await window.laJamoneraReady; } catch (error) { /* sin auth: el proxy rechazara */ }
    }
    return {};
  };

  async function sendEmail(Name, Subject, htmlBody, nombre, email) {
    try {
      if (!window.laJamoneraProxy) {
        return { ok: false, error: new Error('proxy_no_disponible') };
      }

      const response = await window.laJamoneraProxy.postJson('/email', {
        name: String(Name || ''),
        subject: String(Subject || ''),
        html: String(htmlBody || ''),
        toName: String(nombre || ''),
        toEmail: String(email || '')
      });

      const result = await response.json().catch(() => null);
      // La function devuelve { ok, id } (o { ok:false, error }).
      if (result && typeof result.ok === 'boolean') return result;
      return { ok: false, result };
    } catch (error) {
      console.error('Error al enviar el email:', error);
      return { ok: false, error };
    }
  }

  window.laJamoneraEmailSender = {
    ensureConfigLoaded,
    sendEmail
  };
})();
