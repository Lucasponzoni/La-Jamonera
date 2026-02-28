(function emailSenderModule() {
  const FALLBACK_CONFIG = {
    SMTP_USERNAME_E3: '',
    SMTP_SECRET_E3: '',
    EMAIL_API_URL_E3: '',
    CORS_API_KEY_E3: '',
    EMAIL_FROM_NAME_E3: 'Novogar',
    EMAIL_FROM_ADDRESS_E3: 'posventa@novogar.com.ar',
    EMAIL_CHARSET_E3: 'utf-8'
  };

  const state = {
    config: { ...FALLBACK_CONFIG },
    loaded: false,
    loadingPromise: null
  };

  const normalizeConfig = (value) => {
    if (!value || typeof value !== 'object') {
      return { ...FALLBACK_CONFIG };
    }
    return {
      SMTP_USERNAME_E3: String(value.SMTP_USERNAME_E3 || ''),
      SMTP_SECRET_E3: String(value.SMTP_SECRET_E3 || ''),
      EMAIL_API_URL_E3: String(value.EMAIL_API_URL_E3 || ''),
      CORS_API_KEY_E3: String(value.CORS_API_KEY_E3 || ''),
      EMAIL_FROM_NAME_E3: String(value.EMAIL_FROM_NAME_E3 || FALLBACK_CONFIG.EMAIL_FROM_NAME_E3),
      EMAIL_FROM_ADDRESS_E3: String(value.EMAIL_FROM_ADDRESS_E3 || FALLBACK_CONFIG.EMAIL_FROM_ADDRESS_E3),
      EMAIL_CHARSET_E3: String(value.EMAIL_CHARSET_E3 || FALLBACK_CONFIG.EMAIL_CHARSET_E3)
    };
  };

  const isConfigComplete = (cfg) => Boolean(
    cfg
    && cfg.SMTP_USERNAME_E3
    && cfg.SMTP_SECRET_E3
    && cfg.EMAIL_API_URL_E3
    && cfg.CORS_API_KEY_E3
    && cfg.EMAIL_FROM_ADDRESS_E3
  );

  const ensureConfigLoaded = async () => {
    if (state.loaded && isConfigComplete(state.config)) {
      return state.config;
    }

    if (state.loadingPromise) {
      return state.loadingPromise;
    }

    state.loadingPromise = (async () => {
      try {
        if (!window.dbLaJamoneraRest || !window.laJamoneraReady) {
          throw new Error('firebase_not_ready');
        }
        await window.laJamoneraReady;
        const remote = await window.dbLaJamoneraRest.read('/email_sender');
        state.config = normalizeConfig(remote);
        state.loaded = true;
        return state.config;
      } finally {
        state.loadingPromise = null;
      }
    })();

    return state.loadingPromise;
  };

  async function sendEmail(Name, Subject, htmlBody, nombre, email) {
    try {
      const cfg = await ensureConfigLoaded();
      if (!isConfigComplete(cfg)) {
        return { ok: false, error: new Error('email_config_incomplete') };
      }

      const emailData = {
        Html: {
          DocType: null,
          Head: null,
          Body: String(htmlBody || ''),
          BodyTag: '<body>'
        },
        Text: '',
        Subject: String(Subject || ''),
        From: {
          Name: String(Name || cfg.EMAIL_FROM_NAME_E3),
          Email: cfg.EMAIL_FROM_ADDRESS_E3
        },
        To: [
          {
            Name: String(nombre || ''),
            Email: String(email || '')
          }
        ],
        ReplyTo: null,
        CharSet: cfg.EMAIL_CHARSET_E3,
        ExtendedHeaders: null,
        Attachments: null,
        EmbeddedImages: [],
        XSmtpAPI: {
          CampaignName: 'Test Campaign',
          CampaignCode: '1001',
          Header: false,
          Footer: true,
          ClickTracking: null,
          ViewTracking: null,
          Priority: null,
          Schedule: null,
          DynamicFields: [],
          CampaignReport: null,
          SkipDynamicFields: null
        },
        User: {
          Username: cfg.SMTP_USERNAME_E3,
          Secret: cfg.SMTP_SECRET_E3
        }
      };

      const response = await fetch(cfg.EMAIL_API_URL_E3, {
        method: 'POST',
        headers: {
          'x-cors-api-key': cfg.CORS_API_KEY_E3,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailData)
      });

      const result = await response.json();
      return result?.Status === 'done'
        ? { ok: true, result }
        : { ok: false, result };
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
