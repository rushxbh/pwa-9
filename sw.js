// E-commerce PWA Service Worker
const CACHE_NAME = 'ecommerce-pwa-v1';
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/manifest.json',
  '/images/icons/icon-192x192.png',
  '/images/icons/icon-512x512.png',
  // Add other assets for your e-commerce app
  '/products.json',
  '/cart.html',
  '/checkout.html'
];

// Install event - Pre-cache important resources
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing Service Worker');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching app shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[Service Worker] Successfully installed');
        return self.skipWaiting();
      })
  );
});

// Activate event - Clean up old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating Service Worker');
  
  event.waitUntil(
    caches.keys()
      .then(keyList => {
        return Promise.all(keyList.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        }));
      })
      .then(() => {
        console.log('[Service Worker] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event with Cache-First strategy for static resources
// and Network-First for dynamic content
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }
  
  // API calls - Network First strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // Product pages - Network First strategy
  if (url.pathname.startsWith('/product/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // For everything else, use Cache First strategy
  event.respondWith(cacheFirstStrategy(request));
});

// Cache-First Strategy
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    console.log('[Service Worker] Serving from cache:', request.url);
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    // Cache the new response (only if successful)
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Network request failed, serving offline page');
    
    // If the request is for a page, show offline page
    if (request.mode === 'navigate') {
      const cache = await caches.open(CACHE_NAME);
      return cache.match(OFFLINE_URL);
    }
    
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Network-First Strategy
async function networkFirstStrategy(request) {
  try {
    console.log('[Service Worker] Fetching from network:', request.url);
    const networkResponse = await fetch(request);
    
    // Cache the response for future use
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Network request failed, checking cache');
    
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If it's a page navigation, return the offline page
    if (request.mode === 'navigate') {
      const cache = await caches.open(CACHE_NAME);
      return cache.match(OFFLINE_URL);
    }
    
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Background Sync for orders when offline
self.addEventListener('sync', event => {
  console.log('[Service Worker] Background Sync event triggered', event.tag);
  
  if (event.tag === 'sync-new-orders') {
    console.log('[Service Worker] Syncing new orders');
    event.waitUntil(syncOrders());
  }
  
  if (event.tag === 'sync-user-activity') {
    console.log('[Service Worker] Syncing user activity');
    event.waitUntil(syncUserActivity());
  }
});

// Handle push notifications
self.addEventListener('push', event => {
  console.log('[Service Worker] Push notification received', event);
  
  let notification = {
    title: 'E-Commerce Store',
    body: 'New notification',
    icon: '/images/icons/icon-192x192.png',
    badge: '/images/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: '/'
    }
  };
  
  if (event.data) {
    const data = event.data.json();
    
    // Handle different types of notifications
    if (data.type === 'order-confirmation') {
      notification = {
        ...notification,
        title: 'Order Confirmed!',
        body: `Your order #${data.orderId} has been confirmed.`,
        data: {
          url: `/order-status/${data.orderId}`
        }
      };
    } else if (data.type === 'promotion') {
      notification = {
        ...notification,
        title: 'Special Offer!',
        body: data.message,
        data: {
          url: `/promotions/${data.promoId}`
        }
      };
    } else if (data.type === 'shipping-update') {
      notification = {
        ...notification,
        title: 'Shipping Update',
        body: data.message,
        data: {
          url: `/order-tracking/${data.orderId}`
        }
      };
    }
  }
  
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: notification.icon,
      badge: notification.badge,
      vibrate: notification.vibrate,
      data: notification.data
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification click received', event);
  
  event.notification.close();
  
  // Navigate to the appropriate URL when notification is clicked
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then(clientList => {
        const url = event.notification.data.url || '/';
        
        // If a window is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Sync orders function
async function syncOrders() {
  try {
    // Open IndexedDB to get pending orders
    const db = await openDatabase();
    const pendingOrders = await getPendingOrders(db);
    
    console.log(`[Service Worker] Found ${pendingOrders.length} pending orders to sync`);
    
    // Process each pending order
    const orderPromises = pendingOrders.map(async order => {
      try {
        // Try to send the order to the server
        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(order.data)
        });
        
        if (response.ok) {
          console.log(`[Service Worker] Order ${order.id} synced successfully`);
          // Remove from IndexedDB since it's now synced
          await deleteOrder(db, order.id);
          return { success: true, order };
        } else {
          console.log(`[Service Worker] Failed to sync order ${order.id}, will retry`);
          return { success: false, order };
        }
      } catch (error) {
        console.error(`[Service Worker] Error syncing order ${order.id}:`, error);
        return { success: false, order };
      }
    });
    
    return Promise.all(orderPromises);
  } catch (error) {
    console.error('[Service Worker] Error during order sync:', error);
    return Promise.reject(error);
  }
}

// Sync user activity function
async function syncUserActivity() {
  try {
    // Open IndexedDB to get pending user activity
    const db = await openDatabase();
    const pendingActivities = await getPendingUserActivities(db);
    
    console.log(`[Service Worker] Found ${pendingActivities.length} pending activities to sync`);
    
    // Process each pending activity
    const activityPromises = pendingActivities.map(async activity => {
      try {
        // Try to send the activity to the server
        const response = await fetch('/api/user-activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(activity.data)
        });
        
        if (response.ok) {
          console.log(`[Service Worker] Activity ${activity.id} synced successfully`);
          // Remove from IndexedDB since it's now synced
          await deleteUserActivity(db, activity.id);
          return { success: true, activity };
        } else {
          console.log(`[Service Worker] Failed to sync activity ${activity.id}, will retry`);
          return { success: false, activity };
        }
      } catch (error) {
        console.error(`[Service Worker] Error syncing activity ${activity.id}:`, error);
        return { success: false, activity };
      }
    });
    
    return Promise.all(activityPromises);
  } catch (error) {
    console.error('[Service Worker] Error during activity sync:', error);
    return Promise.reject(error);
  }
}

// IndexedDB helper functions (simplified versions)
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ecommerce-pwa-db', 1);
    
    request.onerror = event => {
      reject('Error opening IndexedDB');
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      
      // Create stores for orders and user activity
      if (!db.objectStoreNames.contains('orders')) {
        db.createObjectStore('orders', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('userActivity')) {
        db.createObjectStore('userActivity', { keyPath: 'id' });
      }
    };
  });
}

function getPendingOrders(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('orders', 'readonly');
    const store = transaction.objectStore('orders');
    const request = store.getAll();
    
    request.onerror = event => {
      reject('Error getting pending orders');
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
  });
}

function deleteOrder(db, orderId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('orders', 'readwrite');
    const store = transaction.objectStore('orders');
    const request = store.delete(orderId);
    
    request.onerror = event => {
      reject('Error deleting order');
    };
    
    request.onsuccess = event => {
      resolve();
    };
  });
}

function getPendingUserActivities(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('userActivity', 'readonly');
    const store = transaction.objectStore('userActivity');
    const request = store.getAll();
    
    request.onerror = event => {
      reject('Error getting pending user activities');
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
  });
}

function deleteUserActivity(db, activityId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('userActivity', 'readwrite');
    const store = transaction.objectStore('userActivity');
    const request = store.delete(activityId);
    
    request.onerror = event => {
      reject('Error deleting user activity');
    };
    
    request.onsuccess = event => {
      resolve();
    };
  });
}