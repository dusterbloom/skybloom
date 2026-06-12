# Task 088: Add Progressive Web App Features

## 1. Task & Context
**Task:** Implement PWA features including service workers, offline support, installability, and push notifications
**Scope:** Service worker implementation, app manifest, offline functionality, push notifications
**Branch:** slow-mode
**Priority:** LOW - Enhanced user experience

## 2. Quick Plan
**Approach:** Create service worker for caching, add web app manifest, implement offline functionality, add push notifications
**Complexity:** 2-Moderate (PWA standards implementation)
**Uncertainty:** 1-Low (established PWA patterns)

## 3. Implementation

### Current Issues Found:
- No offline functionality
- Cannot be installed as app
- No push notifications
- No background sync
- Poor mobile app-like experience

### Solution Approach:
1. Implement service worker for caching
2. Create web app manifest
3. Add offline functionality
4. Implement push notifications
5. Add background sync

### Implementation Steps:

**Step 1: Create Service Worker**
```javascript
// public/sw.js
const CACHE_NAME = 'skybloom-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Files to cache immediately
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/main.css',
  '/assets/js/main.js',
  '/assets/js/vendor.js',
  '/assets/images/icon-192.png',
  '/assets/images/icon-512.png',
  '/assets/audio/background.mp3',
  '/assets/audio/collect.mp3'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if available
          return caches.match(request);
        })
    );
    return;
  }

  // Handle static assets
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          return response;
        }

        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE)
              .then((cache) => {
                cache.put(request, responseClone);
              });

            return response;
          })
          .catch(() => {
            // Return offline fallback for HTML requests
            if (request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }
          });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync', event.tag);

  if (event.tag === 'background-sync') {
    event.waitUntil(syncOfflineActions());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push received', event);

  let data = {};
  if (event.data) {
    data = event.data.json();
  }

  const options = {
    body: data.body || 'New update available!',
    icon: '/assets/images/icon-192.png',
    badge: '/assets/images/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Explore',
        icon: '/assets/images/icon-192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/assets/images/icon-192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Magical Carpet',
      options
    )
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification click', event);

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/?notification=explore')
    );
  } else {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Periodic background sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'content-sync') {
    event.waitUntil(syncContent());
  }
});

async function syncOfflineActions() {
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    const keys = await cache.keys();

    // Process any queued offline actions
    for (const request of keys) {
      if (request.url.includes('/api/')) {
        try {
          await fetch(request);
          await cache.delete(request);
        } catch (error) {
          console.log('Failed to sync request:', request.url);
        }
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

async function syncContent() {
  try {
    // Sync game content, leaderboards, etc.
    const response = await fetch('/api/content/sync');
    const data = await response.json();

    // Update cache with new content
    const cache = await caches.open(DYNAMIC_CACHE);
    // Implementation depends on your content structure
  } catch (error) {
    console.error('Content sync failed:', error);
  }
}
```

**Step 2: Create Web App Manifest**
```json
// public/manifest.json
{
  "name": "Magical Carpet Game",
  "short_name": "Magic Carpet",
  "description": "An immersive 3D flying carpet game with multiplayer support",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#87CEEB",
  "theme_color": "#4A90E2",
  "orientation": "landscape-primary",
  "scope": "/",
  "lang": "en-US",
  "categories": ["games", "entertainment"],
  "icons": [
    {
      "src": "/assets/images/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/assets/images/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/assets/images/icon-72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/assets/images/icon-96.png",
      "sizes": "96x96",
      "type": "image/png"
    },
    {
      "src": "/assets/images/icon-128.png",
      "sizes": "128x128",
      "type": "image/png"
    },
    {
      "src": "/assets/images/icon-144.png",
      "sizes": "144x144",
      "type": "image/png"
    }
  ],
  "screenshots": [
    {
      "src": "/assets/images/screenshot1.png",
      "sizes": "1280x720",
      "type": "image/png",
      "label": "Gameplay screenshot"
    },
    {
      "src": "/assets/images/screenshot2.png",
      "sizes": "1280x720",
      "type": "image/png",
      "label": "Multiplayer gameplay"
    }
  ],
  "shortcuts": [
    {
      "name": "Quick Play",
      "short_name": "Play",
      "description": "Start playing immediately",
      "url": "/?mode=quick",
      "icons": [
        {
          "src": "/assets/images/icon-96.png",
          "sizes": "96x96"
        }
      ]
    },
    {
      "name": "Multiplayer",
      "short_name": "Multi",
      "description": "Join multiplayer game",
      "url": "/?mode=multiplayer",
      "icons": [
        {
          "src": "/assets/images/icon-96.png",
          "sizes": "96x96"
        }
      ]
    }
  ]
}
```

**Step 3: Implement PWA Manager**
```javascript
// src/utils/PWAManager.js
export class PWAManager {
  constructor() {
    this.deferredPrompt = null;
    this.isInstalled = false;
    this.registration = null;
  }

  initialize() {
    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupNetworkStatus();
    this.setupUpdateHandling();
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });

        console.log('Service Worker registered:', this.registration);

        // Handle updates
        this.registration.addEventListener('updatefound', () => {
          const newWorker = this.registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.showUpdateNotification();
            }
          });
        });

        // Check for updates periodically
        setInterval(() => {
          this.registration.update();
        }, 60 * 60 * 1000); // Check every hour

      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    }
  }

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      console.log('PWA install prompt triggered');
      event.preventDefault();
      this.deferredPrompt = event;

      // Show custom install button
      this.showInstallButton();
    });

    window.addEventListener('appinstalled', (event) => {
      console.log('PWA was installed');
      this.isInstalled = true;
      this.hideInstallButton();
      this.trackInstall();
    });
  }

  showInstallButton() {
    const installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.innerHTML = '📱 Install App';
    installButton.className = 'pwa-install-button';

    installButton.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;

        console.log(`User response to install prompt: ${outcome}`);
        this.deferredPrompt = null;

        if (outcome === 'accepted') {
          this.trackInstall();
        }
      }

      installButton.remove();
    });

    document.body.appendChild(installButton);
  }

  hideInstallButton() {
    const installButton = document.getElementById('pwa-install-btn');
    if (installButton) {
      installButton.remove();
    }
  }

  setupNetworkStatus() {
    // Monitor online/offline status
    window.addEventListener('online', () => {
      console.log('Network: Online');
      this.showOnlineStatus();
      this.syncOfflineData();
    });

    window.addEventListener('offline', () => {
      console.log('Network: Offline');
      this.showOfflineStatus();
    });

    // Initial status
    if (navigator.onLine) {
      this.showOnlineStatus();
    } else {
      this.showOfflineStatus();
    }
  }

  showOnlineStatus() {
    this.updateNetworkStatus('🟢 Online', 'green');
  }

  showOfflineStatus() {
    this.updateNetworkStatus('🔴 Offline', 'red');
  }

  updateNetworkStatus(status, color) {
    let statusElement = document.getElementById('network-status');
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'network-status';
      statusElement.className = 'network-status-indicator';
      document.body.appendChild(statusElement);
    }

    statusElement.textContent = status;
    statusElement.style.color = color;

    // Auto-hide after 3 seconds
    setTimeout(() => {
      statusElement.style.opacity = '0';
      setTimeout(() => statusElement.remove(), 500);
    }, 3000);
  }

  async syncOfflineData() {
    if ('serviceWorker' in navigator && this.registration) {
      try {
        await this.registration.sync.register('background-sync');
      } catch (error) {
        console.log('Background sync not supported or failed:', error);
      }
    }
  }

  setupUpdateHandling() {
    // Listen for update messages from service worker
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
        this.showUpdateNotification();
      }
    });
  }

  showUpdateNotification() {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <div class="update-content">
        <p>🎉 A new version is available!</p>
        <button id="update-btn">Update Now</button>
        <button id="dismiss-btn">Later</button>
      </div>
    `;

    document.body.appendChild(notification);

    document.getElementById('update-btn').addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('dismiss-btn').addEventListener('click', () => {
      notification.remove();
    });
  }

  async requestNotificationPermission() {
    if ('Notification' in window && 'serviceWorker' in navigator) {
      const permission = await Notification.requestPermission();

      if (permission === 'granted') {
        console.log('Notification permission granted');
        this.subscribeToPushNotifications();
      } else {
        console.log('Notification permission denied');
      }

      return permission;
    }

    return 'denied';
  }

  async subscribeToPushNotifications() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Send subscription to server
      await this.sendSubscriptionToServer(subscription);

      console.log('Push notification subscription successful');
    } catch (error) {
      console.error('Push notification subscription failed:', error);
    }
  }

  async sendSubscriptionToServer(subscription) {
    // Send subscription to your server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(subscription)
    });
  }

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  trackInstall() {
    // Track PWA installation
    if (window.gtag) {
      window.gtag('event', 'pwa_install', {
        event_category: 'engagement',
        event_label: 'pwa'
      });
    }
  }

  getPWAStatus() {
    return {
      isInstalled: this.isInstalled,
      canInstall: !!this.deferredPrompt,
      serviceWorker: !!this.registration,
      notifications: Notification.permission,
      online: navigator.onLine
    };
  }
}
```

**Step 4: Add Offline Game Mode**
```javascript
// src/game/systems/OfflineGameSystem.js
export class OfflineGameSystem extends System {
  constructor() {
    super();
    this.name = 'offlineGame';
    this.offlineData = null;
    this.isOffline = false;
  }

  initialize() {
    this.loadOfflineData();
    this.setupOfflineDetection();
    this.createOfflineUI();
  }

  setupOfflineDetection() {
    window.addEventListener('online', () => {
      this.isOffline = false;
      this.hideOfflineUI();
      this.syncOfflineProgress();
    });

    window.addEventListener('offline', () => {
      this.isOffline = true;
      this.showOfflineUI();
      this.saveOfflineProgress();
    });

    this.isOffline = !navigator.onLine;
    if (this.isOffline) {
      this.showOfflineUI();
    }
  }

  createOfflineUI() {
    this.offlineIndicator = document.createElement('div');
    this.offlineIndicator.id = 'offline-indicator';
    this.offlineIndicator.className = 'offline-indicator hidden';
    this.offlineIndicator.innerHTML = `
      <div class="offline-content">
        <span class="offline-icon">📴</span>
        <span class="offline-text">You're offline</span>
        <span class="offline-subtext">Game progress will be saved locally</span>
      </div>
    `;

    document.body.appendChild(this.offlineIndicator);
  }

  showOfflineUI() {
    if (this.offlineIndicator) {
      this.offlineIndicator.classList.remove('hidden');
    }
  }

  hideOfflineUI() {
    if (this.offlineIndicator) {
      this.offlineIndicator.classList.add('hidden');
    }
  }

  loadOfflineData() {
    const stored = localStorage.getItem('offline_game_data');
    if (stored) {
      try {
        this.offlineData = JSON.parse(stored);
      } catch (error) {
        console.warn('Failed to load offline data:', error);
        this.offlineData = this.getDefaultOfflineData();
      }
    } else {
      this.offlineData = this.getDefaultOfflineData();
    }
  }

  getDefaultOfflineData() {
    return {
      playerProgress: {
        level: 1,
        experience: 0,
        achievements: [],
        inventory: []
      },
      gameSettings: {
        audioVolume: 0.8,
        graphicsQuality: 'medium'
      },
      lastSync: null,
      pendingActions: []
    };
  }

  saveOfflineProgress() {
    if (!this.offlineData) return;

    // Update current game state
    this.offlineData.playerProgress = this.getCurrentPlayerProgress();
    this.offlineData.lastSync = new Date().toISOString();

    // Save to localStorage
    localStorage.setItem('offline_game_data', JSON.stringify(this.offlineData));
  }

  getCurrentPlayerProgress() {
    // Get current player progress from game systems
    return {
      level: this.playerSystem?.level || 1,
      experience: this.playerSystem?.experience || 0,
      achievements: this.questSystem?.completedQuests || [],
      inventory: this.playerSystem?.inventory || []
    };
  }

  async syncOfflineProgress() {
    if (!this.offlineData || !navigator.onLine) return;

    try {
      // Send offline progress to server
      const response = await fetch('/api/player/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          progress: this.offlineData.playerProgress,
          lastSync: this.offlineData.lastSync
        })
      });

      if (response.ok) {
        // Clear offline data after successful sync
        this.offlineData.pendingActions = [];
        this.saveOfflineProgress();

        console.log('Offline progress synced successfully');
      }
    } catch (error) {
      console.warn('Failed to sync offline progress:', error);
    }
  }

  addPendingAction(action) {
    if (!this.offlineData) return;

    this.offlineData.pendingActions.push({
      ...action,
      timestamp: new Date().toISOString(),
      id: Date.now().toString()
    });

    this.saveOfflineProgress();
  }

  getOfflineStatus() {
    return {
      isOffline: this.isOffline,
      hasPendingActions: this.offlineData?.pendingActions?.length > 0,
      lastSync: this.offlineData?.lastSync,
      canPlayOffline: true // Game supports offline play
    };
  }
}
```

**Step 5: Update Main Application**
```javascript
// src/main.js (updates)
import { PWAManager } from './utils/PWAManager.js';
import { OfflineGameSystem } from './game/systems/OfflineGameSystem.js';

// Initialize PWA features
const pwaManager = new PWAManager();
pwaManager.initialize();

// Register offline system
engine.registerSystem(new OfflineGameSystem(), 'offline');

// Add PWA meta tags
function addPWAMetaTags() {
  const metaTags = [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'Magic Carpet' },
    { name: 'msapplication-TileColor', content: '#4A90E2' },
    { name: 'theme-color', content: '#4A90E2' }
  ];

  metaTags.forEach(tag => {
    const meta = document.createElement('meta');
    meta.name = tag.name;
    meta.content = tag.content;
    document.head.appendChild(meta);
  });

  // Add Apple touch icon
  const appleIcon = document.createElement('link');
  appleIcon.rel = 'apple-touch-icon';
  appleIcon.href = '/assets/images/icon-192.png';
  document.head.appendChild(appleIcon);
}

addPWAMetaTags();

// Add install button for desktop
if (!pwaManager.getPWAStatus().isInstalled) {
  setTimeout(() => {
    pwaManager.showInstallButton();
  }, 5000); // Show after 5 seconds
}
```

## 4. Check & Commit

**Files to Update:**
- public/sw.js (new)
- public/manifest.json (new)
- src/utils/PWAManager.js (new)
- src/game/systems/OfflineGameSystem.js (new)
- src/main.js (add PWA initialization)
- index.html (add manifest link and meta tags)

**Expected Impact:**
- App can be installed on devices
- Works offline with cached content
- Push notifications for updates
- Background sync for offline actions
- Native app-like experience
- Improved user engagement

**Testing:**
- Test service worker caching
- Verify app installation works
- Test offline functionality
- Check push notification delivery
- Validate manifest configuration
- Test on various devices and browsers

**Commit Message:** feat: Add progressive web app features with service worker, offline support, and push notifications

**Status:** Ready for implementation