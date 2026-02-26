export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    const firebaseConfig = {
      apiKey: 'AIzaSyAL7gKhxAggAwVAoq2F-UZRgyMZm_O-RDE',
      authDomain: 'fg-lj-d6325.firebaseapp.com',
      databaseURL: 'https://fg-lj-d6325-default-rtdb.firebaseio.com',
      projectId: 'fg-lj-d6325',
      storageBucket: 'fg-lj-d6325.firebasestorage.app',
      messagingSenderId: '585417524093',
      appId: '1:585417524093:web:b33f869375f2522421c214',
      measurementId: 'G-6Z81D5E347'
    };

    const dbSecret = 'Op2ecrJQzPp1MvTltzw9IfkhGbgsm8ZhabPWebyN';
    const baseDbUrl = firebaseConfig.databaseURL.replace(/\/$/, '');

    const cleanPath = (path) => String(path || '').replace(/^\/+|\/+$/g, '');
    const buildDbUrl = (path) => `${baseDbUrl}/${cleanPath(path)}.json?auth=${encodeURIComponent(dbSecret)}`;

    const firebaseRequest = async (path, method = 'GET', value) => {
      const response = await fetch(buildDbUrl(path), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value)
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        return json({ ok: false, error: data }, response.status);
      }

      return json(data);
    };

    if (url.pathname === '/bootstrap' && request.method === 'GET') {
      return json({ firebaseConfig });
    }

    if (url.pathname === '/rtdb/read' && request.method === 'GET') {
      const path = url.searchParams.get('path') || '';
      return firebaseRequest(path, 'GET');
    }

    if (url.pathname === '/rtdb/write' && request.method === 'POST') {
      const body = await request.json();
      return firebaseRequest(body.path || '', 'PUT', body.value);
    }

    if (url.pathname === '/rtdb/update' && request.method === 'POST') {
      const body = await request.json();
      return firebaseRequest(body.path || '', 'PATCH', body.value);
    }

    return json({ ok: false, error: 'Route not found' }, 404);
  }
};
