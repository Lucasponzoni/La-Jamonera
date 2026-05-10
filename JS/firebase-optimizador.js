(function firebaseOptimizadorModule() {
  const nodes = {
    runBtn: document.getElementById('optimizerRunBtn'),
    clearBtn: document.getElementById('optimizerClearBtn'),
    console: document.getElementById('optimizerConsole'),
    status: document.getElementById('optimizerStatus'),
    version: document.getElementById('optimizerVersion'),
    lastRun: document.getElementById('optimizerLastRun')
  };

  const nowLabel = () => new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const setStatus = (message) => {
    if (nodes.status) nodes.status.textContent = message;
  };

  const appendLine = (message, tone = '') => {
    if (!nodes.console) return;
    const line = document.createElement('span');
    line.className = `optimizer-console-line${tone ? ` is-${tone}` : ''}`;
    line.textContent = `[${nowLabel()}] ${message}`;
    nodes.console.appendChild(line);
    nodes.console.scrollTop = nodes.console.scrollHeight;
  };

  const setRunning = (running) => {
    if (!nodes.runBtn) return;
    nodes.runBtn.disabled = running;
    nodes.runBtn.setAttribute('aria-disabled', running ? 'true' : 'false');
    nodes.runBtn.innerHTML = running
      ? '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>Optimizando...</span>'
      : '<i class="fa-solid fa-bolt" aria-hidden="true"></i><span>Ejecutar optimizacion</span>';
  };

  const formatBytes = (bytes) => window.laJamoneraIndexService?.formatKb?.(bytes) || `${bytes} bytes`;

  const renderSizes = (sizes = {}) => {
    Object.entries(sizes).forEach(([key, bytes]) => {
      appendLine(`${key}: ${formatBytes(bytes)}`);
    });
  };

  const verifyIndexes = async () => {
    const paths = [
      '/ingredientes_index',
      '/inventario_index',
      '/recetas_index',
      '/produccion_index',
      '/informes_index',
      '/reparto_index',
      '/_index_meta'
    ];
    appendLine('Verificando indices creados...');
    for (const path of paths) {
      const value = await window.dbLaJamoneraRest.read(path);
      if (value == null) {
        throw new Error(`No se encontro ${path}`);
      }
      if (path === '/inventario_index') {
        if (value.byDate) throw new Error('/inventario_index todavia contiene byDate pesado.');
        const hasEntryArrays = Object.values(value.items || {}).some((item) => Array.isArray(item?.entries));
        if (hasEntryArrays) throw new Error('/inventario_index todavia contiene arrays entries pesados.');
      }
      const counts = value && typeof value === 'object' && value.counts
        ? ` | counts: ${JSON.stringify(value.counts)}`
        : '';
      appendLine(`${path}: OK | ${formatBytes(window.laJamoneraIndexService?.bytesOf?.(value) || 0)}${counts}`, 'ok');
    }
  };

  const refreshVersion = () => {
    const version = window.laJamoneraIndexService?.version;
    if (nodes.version) nodes.version.textContent = version ? `v${version}` : '--';
  };

  const runOptimization = async () => {
    setRunning(true);
    setStatus('Reconstruyendo indices...');
    appendLine('Inicio de optimizacion Firebase.');
    appendLine('Esta corrida lee los nodos completos una vez y escribe indices chicos para el uso diario.');

    try {
      await window.laJamoneraReady;
      const service = window.laJamoneraIndexService;
      if (!service?.rebuildAll) {
        throw new Error('Servicio de indices no disponible.');
      }

      const result = await service.rebuildAll({ log: appendLine });
      window.dbLaJamoneraRest?.clearCache?.();
      renderSizes(result.sizes);
      await verifyIndexes();
      const label = new Date().toLocaleString('es-AR');
      if (nodes.lastRun) nodes.lastRun.textContent = label;
      setStatus('Indices actualizados correctamente.');
      appendLine('Optimizacion finalizada correctamente.', 'ok');
    } catch (error) {
      console.error('[firebase-optimizador]', error);
      setStatus('No se pudo completar la optimizacion.');
      appendLine(error?.message || 'Error desconocido al optimizar.', 'error');
    } finally {
      setRunning(false);
    }
  };

  refreshVersion();
  appendLine('Pagina lista. Esperando ejecucion.');

  nodes.runBtn?.addEventListener('click', runOptimization);
  nodes.clearBtn?.addEventListener('click', () => {
    if (nodes.console) nodes.console.textContent = '';
    appendLine('Consola limpia.');
  });
})();
