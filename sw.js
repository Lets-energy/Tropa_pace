// ═══════════════════════════════════════════════════════════════════════════
// TROPA PACE — Service Worker v4 (OFFLINE-FIRST)
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'tropa-pace-v4'; // Incrementar para forçar atualização completa
const CACHE_EXPIRE_DAYS = 30;

// Recursos críticos para funcionar 100% offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js'
];

// ── Instalação: pré-cachear todos os recursos ─────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW v4] 📦 Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW v4] 💾 Cacheando recursos críticos offline');
        return cache.addAll(PRECACHE_URLS)
          .catch(err => {
            console.warn('[SW v4] ⚠️ Erro ao cachear alguns recursos:', err);
            // Continuar mesmo se alguns recursos falharem
            return cache.add('./index.html');
          });
      })
      .then(() => {
        console.log('[SW v4] ✅ Recursos cacheados com sucesso');
        return self.skipWaiting(); // Forçar ativação imediata
      })
  );
});

// ── Ativação: limpar caches antigos ───────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW v4] 🔄 Ativando Service Worker...');
  event.waitUntil(
    caches.keys().then(keys => {
      console.log('[SW v4] 📋 Caches encontrados:', keys);
      return Promise.all(
        keys
          .filter(key => !key.includes('tropa-pace-v4'))
          .map(key => {
            console.log('[SW v4] 🗑️  Removendo cache antigo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW v4] ✅ Limpeza de caches concluída');
      return self.clients.claim(); // Assumir controle imediato
    })
  );
});

// ── Fetch: OFFLINE-FIRST ──────────────────────────────────────────────────
// Estratégia: Cache → Network → Offline Fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorar: requisições não-GET, cross-origin, chrome extensions
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin) {
    // Google Analytics, Fonts etc podem falhar — OK
    return;
  }

  // ═ ESTRATÉGIA 1: HTML PRINCIPAL (Network→Cache) ═
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Validar resposta HTTP
          if (!response || response.status !== 200 || response.type === 'error') {
            return caches.match(event.request)
              || caches.match('./index.html')
              || new Response('Offline — arquivo HTML não encontrado', { 
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
              });
          }
          
          // Cachear cópia fresquinha
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
            console.log('[SW v4] ✅ HTML cacheado:', url.pathname);
          });
          return response;
        })
        .catch(err => {
          console.warn('[SW v4] 🔌 Offline (HTML):', url.pathname);
          // Sem internet: serve do cache
          return caches.match(event.request)
            || caches.match('./index.html')
            || new Response(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TROPA PACE</title></head><body><h1>Você está offline</h1><p>Aguarde a conexão retornar ou recarregue a página.</p></body></html>',
              {
                status: 503,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
              }
            );
        })
    );
    return;
  }

  // ═ ESTRATÉGIA 2: MANIFEST (Cache-first) ═
  if (url.pathname.endsWith('manifest.json')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          console.log('[SW v4] 📦 Manifest (cache):', url.pathname);
          return cached;
        }
        return fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, response.clone());
              });
            }
            return response;
          })
          .catch(() => {
            console.warn('[SW v4] ⚠️ Manifest offline');
            return new Response('{}', { 
              headers: { 'Content-Type': 'application/json' } 
            });
          });
      })
    );
    return;
  }

  // ═ ESTRATÉGIA 3: OUTROS RECURSOS (Cache-first) ═
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          console.log('[SW v4] 💾 Cache hit:', url.pathname);
          return cached;
        }

        console.log('[SW v4] 🌐 Buscando na rede:', url.pathname);
        return fetch(event.request)
          .then(response => {
            // Validar resposta
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Cachear cópia
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
              console.log('[SW v4] ✅ Recurso cacheado:', url.pathname);
            });
            return response;
          })
          .catch(err => {
            console.warn('[SW v4] ❌ Recurso indisponível offline:', url.pathname);
            // Fallback gracioso
            if (event.request.destination === 'image') {
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#e0e7ff" width="100" height="100"/><text x="50" y="50" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#6366f1">Offline</text></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// ── Mensagens do cliente: suportar força de atualização ────────────────────
self.addEventListener('message', event => {
  console.log('[SW v4] 💬 Mensagem recebida:', event.data?.type);
  
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW v4] ⚡ Pulando espera, ativando nova versão...');
    self.skipWaiting();
  }
  
  if (event.data?.type === 'CLEAR_CACHE') {
    console.log('[SW v4] 🗑️  Limpando cache...');
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW v4] ✅ Cache removido');
      event.ports[0]?.postMessage({ success: true });
    });
  }

  if (event.data?.type === 'CACHE_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});

// ── Sincronização em background (quando voltam online) ────────────────────
if (self.registration && typeof self.registration.sync !== 'undefined') {
  self.addEventListener('sync', event => {
    if (event.tag === 'sync-data') {
      console.log('[SW v4] 🔄 Sincronizando dados...');
      // Aqui você pode adicionar lógica para sincronizar dados salvos
    }
  });
}
