const RUNTIME = 'redditp-cache-v1';

const PRECACHE_URLS = [
    'https://www.redditp.com',
    'https://www.redditp.com/index.html',
    'https://www.redditp.com/css/style.css'
    // other resources will be cached automatically
];

const ALLOWED_DOMAINS = [
    // production domains
    'redditp.com',
    'www.redditp.com',
    // pre-release domains
    'netlify.app',
    // local / devel domains
    'redditp.local',
    'redditp.dev'
];

self.addEventListener('install', event => {

    event.waitUntil(
        caches.open(RUNTIME)
            .then(cache => {
                PRECACHE_URLS.forEach(precacheUrl => {
                    console.log('precache ' + precacheUrl);
                    fetch(precacheUrl, {mode: 'no-cors'}).then(response => cache.put(precacheUrl, response))
                        .catch(error => {
                            console.log('could not cache ' + precacheUrl, error);
                        });
                })
            })
            .then(self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    const currentCaches = [RUNTIME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
        }).then(cachesToDelete => {
            return Promise.all(cachesToDelete.map(cacheToDelete => {
                return caches.delete(cacheToDelete);
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const parsedURL = new URL(event.request.url);

    // Skip cross-origin requests, like those for Google Analytics.
    if (event.request.method !== 'GET') {
        // do not cache other than GET requests
        return;
    }
    if (!ALLOWED_DOMAINS.includes(parsedURL.hostname) && !parsedURL.hostname.endsWith('netlify.app')) {
        // do not cache foreign urls
        return;
    }
    event.respondWith(fetch(event.request)
        .then(response => {
            return caches.open(RUNTIME).then(cache => {
                cache.put(event.request, response.clone()).catch(error => {
                    console.log('could not cache ' + event.request.url, error);
                });
                return response;
            })
        })
        .catch(error => {
            console.log('could not fetch ' + event.request.url, error);
            return caches.match(event.request, {ignoreSearch: true})
                .then(cachedResponse => {
                    return cachedResponse || caches.match('/', {ignoreSearch: true})
                })
        }));
});
