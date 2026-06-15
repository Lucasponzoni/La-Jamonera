(function emailSenderModule() {
  // Las credenciales MailUp (Username/Secret) viven en la Cloud Function,
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
      // La function ya devuelve { ok, result }.
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
