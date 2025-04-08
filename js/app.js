// E-commerce PWA main application logic

// Check if service workers are supported
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('Service Worker registered with scope:', registration.scope);
          // Now we can enable features that require service worker
          setupSyncEvents(registration);
          setupPushNotifications(registration);
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
        });
    });
  }
  
  // Setup IndexedDB
  let db;
  
  function initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ecommerce-pwa-db', 1);
      
      request.onerror = event => {
        console.error('IndexedDB error:', event.target.error);
        reject('Error opening IndexedDB');
      };
      
      request.onsuccess = event => {
        db = event.target.result;
        console.log('IndexedDB opened successfully');
        resolve(db);
      };
      
      request.onupgradeneeded = event => {
        const db = event.target.result;
        
        // Create stores for orders and user activity
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
          orderStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('userActivity')) {
          const activityStore = db.createObjectStore('userActivity', { keyPath: 'id', autoIncrement: true });
          activityStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
  
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id' });
          productStore.createIndex('category', 'category', { unique: false });
        }
  
        if (!db.objectStoreNames.contains('cart')) {
          const cartStore = db.createObjectStore('cart', { keyPath: 'id', autoIncrement: true });
          cartStore.createIndex('productId', 'productId', { unique: false });
        }
      };
    });
  }
  
  // Setup Background Sync
  function setupSyncEvents(registration) {
    // Check if Background Sync is supported
    if ('SyncManager' in window) {
      console.log('Background Sync is supported');
      
      // Add listeners to various e-commerce actions
      setupOrderSync(registration);
      setupUserActivitySync(registration);
    } else {
      console.log('Background Sync is not supported');
      // Fallback - use online/offline events
      setupOnlineOfflineHandlers();
    }
  }
  
  // Setup Push Notifications
  function setupPushNotifications(registration) {
    // Check if Push API is supported
    if ('PushManager' in window) {
      console.log('Push API is supported');
      
      // Request permission for push notifications
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          console.log('Notification permission granted');
          subscribeToPushNotifications(registration);
        } else {
          console.log('Notification permission denied');
        }
      });
    } else {
      console.log('Push API is not supported');
    }
  }
  
  // Order Sync Setup
  function setupOrderSync(registration) {
    // Listen for checkout button clicks
    document.addEventListener('click', event => {
      if (event.target && event.target.id === 'checkout-button') {
        event.preventDefault();
        
        // Get cart data from UI or local storage
        const cartItems = getCartItems();
        
        if (cartItems.length === 0) {
          showMessage('Your cart is empty');
          return;
        }
        
        // Create order object
        const order = {
          items: cartItems,
          total: calculateTotal(cartItems),
          shippingAddress: getShippingAddress(),
          paymentMethod: getPaymentMethod(),
          timestamp: new Date().toISOString(),
          status: 'pending'
        };
        
        // Try to submit order
        submitOrder(order, registration);
      }
    });
  }
  
  // User Activity Sync Setup
  function setupUserActivitySync(registration) {
    // Product views
    document.addEventListener('click', event => {
      if (event.target.closest('.product-card')) {
        const productId = event.target.closest('.product-card').dataset.productId;
        
        const activity = {
          type: 'product-view',
          productId: productId,
          timestamp: new Date().toISOString()
        };
        
        logUserActivity(activity, registration);
      }
    });
    
    // Add to cart
    document.addEventListener('click', event => {
      if (event.target.closest('.add-to-cart-btn')) {
        const productId = event.target.closest('.add-to-cart-btn').dataset.productId;
        
        const activity = {
          type: 'add-to-cart',
          productId: productId,
          timestamp: new Date().toISOString()
        };
        
        logUserActivity(activity, registration);
      }
    });
    
    // Wishlist actions
    document.addEventListener('click', event => {
      if (event.target.closest('.wishlist-btn')) {
        const productId = event.target.closest('.wishlist-btn').dataset.productId;
        
        const activity = {
          type: 'wishlist-toggle',
          productId: productId,
          timestamp: new Date().toISOString()
        };
        
        logUserActivity(activity, registration);
      }
    });
  }
  
  // Submit Order
  async function submitOrder(order, registration) {
    try {
      // Try to submit order to server directly
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(order)
      });
      
      if (response.ok) {
        // Order submitted successfully
        const responseData = await response.json();
        showOrderConfirmation(responseData.orderId);
        clearCart();
      } else {
        throw new Error('Server error');
      }
    } catch (error) {
      console.log('Network error, saving order for later sync', error);
      
      // Store order in IndexedDB for later syncing
      try {
        await storeOrderInIndexedDB(order);
        showMessage('You appear to be offline. Your order has been saved and will be submitted when you\'re back online.');
        
        // Register for background sync
        if ('SyncManager' in window) {
          await registration.sync.register('sync-new-orders');
          console.log('Background sync registered for orders');
        }
      } catch (dbError) {
        console.error('Error storing order offline', dbError);
        showMessage('Could not process your order. Please try again later.');
      }
    }
  }
  
  // Log User Activity
  async function logUserActivity(activity, registration) {
    try {
      // Try to send activity to server directly
      const response = await fetch('/api/user-activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(activity)
      });
      
      if (!response.ok) {
        throw new Error('Server error');
      }
    } catch (error) {
      console.log('Network error, saving activity for later sync', error);
      
      // Store activity in IndexedDB for later syncing
      try {
        await storeActivityInIndexedDB(activity);
        
        // Register for background sync
        if ('SyncManager' in window) {
          await registration.sync.register('sync-user-activity');
          console.log('Background sync registered for user activity');
        }
      } catch (dbError) {
        console.error('Error storing activity offline', dbError);
      }
    }
  }
  
  // Store Order in IndexedDB
  function storeOrderInIndexedDB(order) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('orders', 'readwrite');
      const store = transaction.objectStore('orders');
      const request = store.add({
        data: order,
        timestamp: new Date().toISOString()
      });
      
      request.onsuccess = event => {
        console.log('Order stored in IndexedDB for later sync');
        resolve();
      };
      
      request.onerror = event => {
        console.error('Error storing order in IndexedDB', event.target.error);
        reject('Failed to store order');
      };
    });
  }
  
  // Store Activity in IndexedDB
  function storeActivityInIndexedDB(activity) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('userActivity', 'readwrite');
      const store = transaction.objectStore('userActivity');
      const request = store.add({
        data: activity,
        timestamp: new Date().toISOString()
      });
      
      request.onsuccess = event => {
        console.log('Activity stored in IndexedDB for later sync');
        resolve();
      };
      
      request.onerror = event => {
        console.error('Error storing activity in IndexedDB', event.target.error);
        reject('Failed to store activity');
      };
    });
  }
  
  // Subscribe to Push Notifications
  function subscribeToPushNotifications(registration) {
    const applicationServerKey = urlB64ToUint8Array(
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
    );
    
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    })
    .then(subscription => {
      console.log('User is subscribed to push notifications');
      
      // Send subscription to server
      return sendSubscriptionToServer(subscription);
    })
    .then(response => {
      console.log('Push notification subscription sent to server');
      
      // Show success message in UI
      showMessage('You will now receive order updates and promotional offers!');
    })
    .catch(error => {
      console.error('Failed to subscribe to push notifications', error);
      
      if (Notification.permission === 'denied') {
        console.log('Permission for notifications was denied');
      } else {
        console.log('Unable to subscribe to push', error);
      }
    });
  }
  
  // Send subscription to server
  function sendSubscriptionToServer(subscription) {
    return fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(subscription)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Bad status code from server.');
      }
      
      return response.json();
    })
    .then(responseData => {
      if (!(responseData.data && responseData.data.success)) {
        throw new Error('Bad response from server.');
      }
      
      return responseData;
    });
  }
  
  // Fallback for when Background Sync is not supported
  function setupOnlineOfflineHandlers() {
    window.addEventListener('online', () => {
      console.log('Device is back online');
      
      // Manually sync pending orders and activities
      syncPendingOrders();
      syncPendingActivities();
    });
    
    window.addEventListener('offline', () => {
      console.log('Device is offline');
      showMessage('You are currently offline. Some features may be limited.');
    });
  }
  
  // Manually sync pending orders
  async function syncPendingOrders() {
    try {
      const transaction = db.transaction('orders', 'readwrite');
      const store = transaction.objectStore('orders');
      const request = store.getAll();
      
      request.onsuccess = async event => {
        const orders = event.target.result;
        
        if (orders.length === 0) {
          return;
        }
        
        console.log(`Found ${orders.length} pending orders to sync`);
        
        for (const order of orders) {
          try {
            const response = await fetch('/api/orders', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(order.data)
            });
            
            if (response.ok) {
              console.log(`Order ${order.id} synced successfully`);
              
              // Remove from IndexedDB
              const deleteRequest = store.delete(order.id);
              deleteRequest.onsuccess = () => {
                console.log(`Order ${order.id} removed from IndexedDB`);
              };
            } else {
              console.log(`Failed to sync order ${order.id}, will retry later`);
            }
          } catch (error) {
            console.error(`Error syncing order ${order.id}:`, error);
          }
        }
      };
      
      request.onerror = event => {
        console.error('Error getting pending orders', event.target.error);
      };
    } catch (error) {
      console.error('Error during order sync:', error);
    }
  }
  
  // Manually sync pending activities
  async function syncPendingActivities() {
    try {
      const transaction = db.transaction('userActivity', 'readwrite');
      const store = transaction.objectStore('userActivity');
      const request = store.getAll();
      
      request.onsuccess = async event => {
        const activities = event.target.result;
        
        if (activities.length === 0) {
          return;
        }
        
        console.log(`Found ${activities.length} pending activities to sync`);
        
        for (const activity of activities) {
          try {
            const response = await fetch('/api/user-activity', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(activity.data)
            });
            
            if (response.ok) {
              console.log(`Activity ${activity.id} synced successfully`);
              
              // Remove from IndexedDB
              const deleteRequest = store.delete(activity.id);
              deleteRequest.onsuccess = () => {
                console.log(`Activity ${activity.id} removed from IndexedDB`);
              };
            } else {
              console.log(`Failed to sync activity ${activity.id}, will retry later`);
            }
          } catch (error) {
            console.error(`Error syncing activity ${activity.id}:`, error);
          }
        }
      };
      
      request.onerror = event => {
        console.error('Error getting pending activities', event.target.error);
      };
    } catch (error) {
      console.error('Error during activity sync:', error);
    }
  }
  
  // Helper function to convert base64 string to Uint8Array
  // (needed for the applicationServerKey in push subscriptions)
  function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    
    return outputArray;
  }
  
  // Helper functions for UI interaction
  function getCartItems() {
    // In a real app, this would get items from the shopping cart
    // For demo purposes, we'll return mock data
    return JSON.parse(localStorage.getItem('cart') || '[]');
  }
  
  function calculateTotal(items) {
    return items.reduce((total, item) => total + (item.price * item.quantity), 0).toFixed(2);
  }
  
  function getShippingAddress() {
    // In a real app, this would get address from form fields
    // For demo purposes, we'll return mock data
    return {
      name: document.getElementById('name')?.value || 'John Doe',
      street: document.getElementById('street')?.value || '123 Main St',
      city: document.getElementById('city')?.value || 'Anytown',
      state: document.getElementById('state')?.value || 'CA',
      zip: document.getElementById('zip')?.value || '12345',
      country: document.getElementById('country')?.value || 'USA'
    };
  }
  
  // Continue from previous code...

function getPaymentMethod() {
    // In a real app, this would get payment method from form fields
    // For demo purposes, we'll return mock data
    return {
      type: document.querySelector('input[name="payment-method"]:checked')?.value || 'credit-card',
      cardNumber: document.getElementById('card-number')?.value ? 'xxxx-xxxx-xxxx-' + document.getElementById('card-number').value.slice(-4) : 'xxxx-xxxx-xxxx-1234',
      expiryDate: document.getElementById('expiry-date')?.value || '12/25'
    };
  }
  
  function showOrderConfirmation(orderId) {
    // Display order confirmation to the user
    const confirmationElement = document.getElementById('order-confirmation');
    if (confirmationElement) {
      confirmationElement.innerHTML = `
        <div class="success-message">
          <h3>Order Placed Successfully!</h3>
          <p>Your order #${orderId} has been confirmed.</p>
          <p>You will receive an email confirmation shortly.</p>
        </div>
      `;
      confirmationElement.classList.remove('hidden');
      
      // Scroll to confirmation
      confirmationElement.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Fallback if the element doesn't exist
      alert(`Order placed successfully! Your order number is: ${orderId}`);
    }
    
    // Clear the cart
    clearCart();
  }
  
  function clearCart() {
    // Clear cart in localStorage
    localStorage.setItem('cart', '[]');
    
    // Update UI to show empty cart
    const cartItemsElement = document.getElementById('cart-items');
    if (cartItemsElement) {
      cartItemsElement.innerHTML = '<p>Your cart is empty</p>';
    }
    
    const cartTotalElement = document.getElementById('cart-total');
    if (cartTotalElement) {
      cartTotalElement.textContent = '0.00';
    }
    
    const cartBadgeElement = document.querySelector('.cart-badge');
    if (cartBadgeElement) {
      cartBadgeElement.textContent = '0';
      cartBadgeElement.classList.add('hidden');
    }
  }
  
  function showMessage(message, type = 'info') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add to the DOM
    const toastContainer = document.querySelector('.toast-container');
    if (toastContainer) {
      toastContainer.appendChild(toast);
    } else {
      // Create container if it doesn't exist
      const newContainer = document.createElement('div');
      newContainer.className = 'toast-container';
      newContainer.appendChild(toast);
      document.body.appendChild(newContainer);
    }
    
    // Animate in
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 5000);
  }
  
  // Initialize the app
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Initialize IndexedDB
      await initDatabase();
      
      // Load products (first try network, then fall back to cached data)
      await loadProducts();
      
      // Set up event listeners for the shopping experience
      setupEventListeners();
      
      // Check online status and update UI accordingly
      if (!navigator.onLine) {
        showMessage('You are currently offline. Some features may be limited.');
      }
    } catch (error) {
      console.error('Error initializing app:', error);
      showMessage('There was an error loading the application. Please refresh the page.', 'error');
    }
  });
  
  // Load products from server or IndexedDB
  async function loadProducts() {
    try {
      // Try to fetch from network first
      const response = await fetch('/api/products');
      
      if (response.ok) {
        const products = await response.json();
        
        // Store products in IndexedDB for offline use
        await storeProductsInIndexedDB(products);
        
        // Render products to the page
        renderProducts(products);
        return;
      } else {
        throw new Error('Failed to fetch products from server');
      }
    } catch (error) {
      console.log('Network request failed, trying to load products from IndexedDB', error);
      
      // Try to get products from IndexedDB
      try {
        const products = await getProductsFromIndexedDB();
        
        if (products && products.length > 0) {
          renderProducts(products);
          showMessage('Showing cached product data. Some information may not be up to date.');
        } else {
          showMessage('Unable to load products. Please check your internet connection.', 'error');
        }
      } catch (dbError) {
        console.error('Error loading products from IndexedDB', dbError);
        showMessage('Unable to load products. Please check your internet connection.', 'error');
      }
    }
  }
  
  // Store products in IndexedDB
  function storeProductsInIndexedDB(products) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('products', 'readwrite');
      const store = transaction.objectStore('products');
      
      // Clear existing products
      store.clear().onsuccess = () => {
        let completedCount = 0;
        
        // Add all products
        products.forEach(product => {
          const request = store.put(product);
          
          request.onsuccess = () => {
            completedCount++;
            if (completedCount === products.length) {
              resolve();
            }
          };
          
          request.onerror = event => {
            console.error('Error storing product in IndexedDB', event.target.error);
            reject(event.target.error);
          };
        });
      };
    });
  }
  
  // Get products from IndexedDB
  function getProductsFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('products', 'readonly');
      const store = transaction.objectStore('products');
      const request = store.getAll();
      
      request.onsuccess = event => {
        resolve(event.target.result);
      };
      
      request.onerror = event => {
        console.error('Error getting products from IndexedDB', event.target.error);
        reject(event.target.error);
      };
    });
  }
  
  // Render products to the UI
  function renderProducts(products) {
    const productsContainer = document.getElementById('products-container');
    
    if (!productsContainer) {
      console.error('Products container element not found');
      return;
    }
    
    // Clear existing products
    productsContainer.innerHTML = '';
    
    // Add products to the page
    products.forEach(product => {
      const productCard = document.createElement('div');
      productCard.className = 'product-card';
      productCard.dataset.productId = product.id;
      
      productCard.innerHTML = `
        <div class="product-image">
          <img src="${product.image || '/images/placeholder.jpg'}" alt="${product.name}">
          <button class="wishlist-btn" data-product-id="${product.id}">
            <i class="icon-heart"></i>
          </button>
        </div>
        <div class="product-info">
          <h3>${product.name}</h3>
          <p class="product-price">$${product.price.toFixed(2)}</p>
          <p class="product-description">${product.description}</p>
          <button class="add-to-cart-btn" data-product-id="${product.id}">Add to Cart</button>
        </div>
      `;
      
      productsContainer.appendChild(productCard);
    });
  }
  
  // Set up event listeners
  function setupEventListeners() {
    // Product card click for details
    document.addEventListener('click', event => {
      const productCard = event.target.closest('.product-card');
      if (productCard && !event.target.closest('button')) {
        const productId = productCard.dataset.productId;
        window.location.href = `/product/${productId}`;
      }
    });
    
    // Add to cart button
    document.addEventListener('click', event => {
      const addToCartBtn = event.target.closest('.add-to-cart-btn');
      if (addToCartBtn) {
        const productId = addToCartBtn.dataset.productId;
        addToCart(productId);
      }
    });
    
    // Cart icon click
    const cartIcon = document.querySelector('.cart-icon');
    if (cartIcon) {
      cartIcon.addEventListener('click', () => {
        const cartDropdown = document.querySelector('.cart-dropdown');
        if (cartDropdown) {
          cartDropdown.classList.toggle('show');
        }
      });
    }
    
    // Close cart dropdown when clicking outside
    document.addEventListener('click', event => {
      if (!event.target.closest('.cart-container')) {
        const cartDropdown = document.querySelector('.cart-dropdown');
        if (cartDropdown && cartDropdown.classList.contains('show')) {
          cartDropdown.classList.remove('show');
        }
      }
    });
    
    // Checkout button in cart dropdown
    const cartCheckoutBtn = document.querySelector('.cart-checkout-btn');
    if (cartCheckoutBtn) {
      cartCheckoutBtn.addEventListener('click', () => {
        window.location.href = '/checkout';
      });
    }
    
    // Install PWA button
    const installBtn = document.getElementById('install-button');
    if (installBtn) {
      installBtn.addEventListener('click', installPWA);
    }
  }
  
  // Add product to cart
  async function addToCart(productId) {
    try {
      // Get product details
      const product = await getProductFromIndexedDB(productId);
      
      if (!product) {
        showMessage('Product not found', 'error');
        return;
      }
      
      // Get current cart
      const cart = JSON.parse(localStorage.getItem('cart') || '[]');
      
      // Check if product is already in cart
      const existingItem = cart.find(item => item.id === productId);
      
      if (existingItem) {
        // Increment quantity
        existingItem.quantity += 1;
      } else {
        // Add new item
        cart.push({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image,
          quantity: 1
        });
      }
      
      // Save updated cart
      localStorage.setItem('cart', JSON.stringify(cart));
      
      // Update UI
      updateCartUI(cart);
      
      // Show success message
      showMessage(`${product.name} added to cart!`, 'success');
      
      // Log user activity
      if (navigator.serviceWorker.controller) {
        const activity = {
          type: 'add-to-cart',
          productId: productId,
          timestamp: new Date().toISOString()
        };
        
        navigator.serviceWorker.ready.then(registration => {
          logUserActivity(activity, registration);
        });
      }
    } catch (error) {
      console.error('Error adding product to cart:', error);
      showMessage('Could not add product to cart', 'error');
    }
  }
  
  // Get product from IndexedDB
  function getProductFromIndexedDB(productId) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('products', 'readonly');
      const store = transaction.objectStore('products');
      const request = store.get(productId);
      
      request.onsuccess = event => {
        resolve(event.target.result);
      };
      
      request.onerror = event => {
        console.error('Error getting product from IndexedDB', event.target.error);
        reject(event.target.error);
      };
    });
  }
  
  // Update cart UI
  function updateCartUI(cart) {
    // Update cart badge
    const cartBadgeElement = document.querySelector('.cart-badge');
    if (cartBadgeElement) {
      const totalItems = cart.reduce((total, item) => total + item.quantity, 0);
      cartBadgeElement.textContent = totalItems;
      
      if (totalItems > 0) {
        cartBadgeElement.classList.remove('hidden');
      } else {
        cartBadgeElement.classList.add('hidden');
      }
    }
    
    // Update cart dropdown items
    const cartItemsElement = document.getElementById('cart-items');
    if (cartItemsElement) {
      if (cart.length === 0) {
        cartItemsElement.innerHTML = '<p>Your cart is empty</p>';
      } else {
        cartItemsElement.innerHTML = cart.map(item => `
          <div class="cart-item">
            <img src="${item.image || '/images/placeholder.jpg'}" alt="${item.name}">
            <div class="cart-item-details">
              <h4>${item.name}</h4>
              <p>$${item.price.toFixed(2)} × ${item.quantity}</p>
            </div>
            <button class="remove-item-btn" data-product-id="${item.id}">×</button>
          </div>
        `).join('');
      }
    }
    
    // Update cart total
    const cartTotalElement = document.getElementById('cart-total');
    if (cartTotalElement) {
      const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      cartTotalElement.textContent = total.toFixed(2);
    }
  }
  
  // PWA installation
  let deferredPrompt;
  
  window.addEventListener('beforeinstallprompt', (event) => {
    // Prevent the mini-infobar from appearing on mobile
    event.preventDefault();
    
    // Stash the event so it can be triggered later
    deferredPrompt = event;
    
    // Show the install button
    const installBtn = document.getElementById('install-button');
    if (installBtn) {
      installBtn.classList.remove('hidden');
    }
  });
  
  function installPWA() {
    // Show the install prompt
    if (deferredPrompt) {
      deferredPrompt.prompt();
      
      // Wait for the user to respond to the prompt
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
          showMessage('Thank you for installing our app!', 'success');
        } else {
          console.log('User dismissed the install prompt');
        }
        
        // Clear the saved prompt since it can't be used again
        deferredPrompt = null;
        
        // Hide the install button
        const installBtn = document.getElementById('install-button');
        if (installBtn) {
          installBtn.classList.add('hidden');
        }
      });
    }
  }
  
  // Check for app updates
  function checkForUpdates() {
    navigator.serviceWorker.ready.then(registration => {
      registration.update().then(() => {
        console.log('Checked for service worker updates');
      }).catch(error => {
        console.error('Error checking for service worker updates:', error);
      });
    });
  }
  
  // Check for updates periodically
  setInterval(checkForUpdates, 60 * 60 * 1000); // Check every hour  // In a real app, this would get payment metho