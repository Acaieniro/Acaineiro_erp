const API_URL = `https://sistemaacaineiro.netlify.app`;
const APP_VERSION = '3'; // incremente a cada deploy que muda app.js
let cart = [];
let currentCategory = 'todos';
let allProducts = [];
let allCategories = [];
let settings = {};
let socket = null;
let currentTrackingId = null;
let mpLoading = null;
let neighborhoodFees = [];
let lastFreight = null;
let freightTimer = null;

function deliveryFeeFor(neighborhood, isPickup) {
  if (isPickup) return 0;
  if (lastFreight !== null) return lastFreight.fee;
  const nf = neighborhoodFees.find(f => f.neighborhood.toLowerCase() === (neighborhood || '').toLowerCase().trim());
  return nf ? nf.fee : (parseFloat(settings.delivery_fee) || 0);
}

async function calcFreight() {
  const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
  if (isPickup) { lastFreight = { distance_km: 0, fee: 0 }; return; }
  const addr = document.getElementById('ord-address')?.value || '';
  const hood = document.getElementById('ord-neighborhood')?.value || '';
  const full = [addr, hood].filter(Boolean).join(', ');
  if (!full) { lastFreight = null; return; }
  try {
    const r = await API.post('/api/calc-freight', { address: full });
    if (r.fee !== undefined) lastFreight = r;
  } catch (e) { lastFreight = null; }
}

const API = {
  async get(url) {
    const r = await fetch(`${API_URL}${url}`);
    if (!r.ok) { const d = await r.json().catch(() => {}); throw new Error(d?.error || 'Erro'); }
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(`${API_URL}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) { const d = await r.json().catch(() => {}); throw new Error(d?.error || 'Erro'); }
    return r.json();
  }
};

function connectSocket(orderId) {
  if (socket && socket.connected) socket.disconnect();
  if (orderId) currentTrackingId = orderId;
  let pollTimer = null;

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`${API_URL}/api/orders/${currentTrackingId}`);
        if (!r.ok) return;
        const order = await r.json();
        if (order.id === currentTrackingId) {
          updateTrackingUI(order);
        }
        updateSavedOrder(order);
        if (order.status === 'cancelado') {
          if (paymentInterval) { clearInterval(paymentInterval); paymentInterval = null; }
          if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }
          showToast(`❌ Pedido #${order.id} foi cancelado`);
          sendNotification('Pedido Cancelado ❌', `Pedido #${order.id} foi cancelado`);
          clearInterval(pollTimer);
        } else if (order.status !== 'novo' && order.status !== currentTrackingStatus) {
          currentTrackingStatus = order.status;
          const label = statusLabels[order.status] || order.status;
          showToast(`${label} — Pedido #${order.id}`);
          sendNotification(`Pedido #${order.id}`, `${label}`, 'logo/logo.png');
        }
        if (document.getElementById('page-payment').classList.contains('active') && order.status === 'cancelado') {
          openTracking(order.id);
        }
        if (document.getElementById('page-orders').classList.contains('active')) {
          loadMyOrders();
        }
        if (['finalizado','cancelado','entregue'].includes(order.status)) {
          clearInterval(pollTimer);
        }
      } catch (e) {}
    }, 2000);
  }

  try {
    socket = io(API_URL, { reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 3 });
    socket.on('connect', () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (orderId) socket.emit('join-order', orderId);
    });
    socket.on('status-update', (order) => {
      if (order.id === currentTrackingId) {
        updateTrackingUI(order);
      }
      updateSavedOrder(order);
      if (order.status === 'cancelado') {
        if (paymentInterval) { clearInterval(paymentInterval); paymentInterval = null; }
        if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }
        showToast(`❌ Pedido #${order.id} foi cancelado`);
        sendNotification('Pedido Cancelado ❌', `Pedido #${order.id} foi cancelado`);
      } else if (order.status !== 'novo') {
        const label = statusLabels[order.status] || order.status;
        showToast(`${label} — Pedido #${order.id}`);
        sendNotification(`Pedido #${order.id}`, `${label}`, 'logo/logo.png');
      }
      if (document.getElementById('page-payment').classList.contains('active') && order.status === 'cancelado') {
        openTracking(order.id);
      }
      if (document.getElementById('page-orders').classList.contains('active')) {
        loadMyOrders();
      }
    });
    socket.on('connect_error', () => { startPolling(); });
    socket.on('disconnect', () => { startPolling(); });
    setTimeout(() => { if (!socket || !socket.connected) startPolling(); }, 3000);
  } catch (e) { startPolling(); }
}

let currentTrackingStatus = '';

function requestNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotification(title, body, icon) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    navigator.serviceWorker?.ready?.then(reg => {
      reg.showNotification(title, { body, icon: icon || 'logo/logo.png', badge: icon || 'logo/logo.png', vibrate: [200, 100, 200] });
    }).catch(() => {
      new Notification(title, { body, icon: icon || 'logo/logo.png' });
    });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showToast(msg, duration) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.style.display = 'none', 300);
  }, duration || 4000);
}

function showPromoNotification() {
  const promos = allProducts.filter(p => p.has_promo && p.promo_price);
  if (promos.length > 0) {
    setTimeout(() => {
      showToast(`🔥 ${promos.length} ofertas especiais esperando por você`);
      sendNotification('Tem novidade no Açaineiro 🥣', `Dá uma olhada nas ofertas que separamos pra você hoje`);
    }, 2000);
  }
  const hasFlash = document.getElementById('flash-sale');
  if (hasFlash && hasFlash.style.display !== 'none') {
    setTimeout(() => {
      showToast('⚡ Ofertas relâmpago disponíveis agora');
      sendNotification('Só hoje ⚡', 'Passa lá no app pra conferir as ofertas relâmpago');
    }, 4000);
  }
}

function updateOrderBadge() {
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  const active = saved.filter(o => ['novo', 'preparando', 'entregando'].includes(o.status)).length;
  const badge = document.getElementById('order-badge');
  if (!badge) return;
  badge.textContent = active;
  badge.classList.toggle('hidden', active === 0);
}

function updateSavedOrder(order) {
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  const idx = saved.findIndex(o => o.id === order.id);
  if (idx >= 0) {
    saved[idx].status = order.status;
    saved[idx].updated_at = order.updated_at;
    localStorage.setItem('acaineiro_orders', JSON.stringify(saved));
  }
  updateOrderBadge();
}

async function loadApp() {
  try {
    const cachedVersion = localStorage.getItem('app_version');
    if (cachedVersion && cachedVersion !== APP_VERSION) {
      localStorage.clear();
      window.location.href = window.location.href.split('?')[0] + '?_=' + Date.now();
      return;
    }
    localStorage.setItem('app_version', APP_VERSION);
    allCategories = await API.get('/api/categories');
    allProducts = await API.get('/api/products');
    settings = await API.get('/api/settings');
    neighborhoodFees = await API.get('/api/neighborhood-fees').catch(() => []);
    renderCategories();
    renderProducts('todos');
    renderPromos();
    renderFeatured();
    renderTopProducts();
    renderCombos();
    renderLoyalty();
    renderFlashProducts();
    renderCupomDoDia();
    setupSearch();
    updateHomeInfo();
    loadBanners();
    initFlashTimer();
    requestNotifyPermission();
    showPromoNotification();
    updateOrderBadge();
  } catch (e) {
    document.getElementById('menu-items').innerHTML = '<p style="text-align:center;padding:40px;color:#888;">Servidor offline. Verifique se o backend está rodando.</p>';
  }
}

function updateHomeInfo() {
  if (settings.store_open && settings.store_close) {
    const hours = `${settings.store_open} - ${settings.store_close}`;
    document.getElementById('home-hours-range').textContent = hours;
    const hh = document.getElementById('header-hours');
    if (hh) hh.textContent = hours;
  }
  if (settings.store_phone) {
    document.getElementById('contact-phone').textContent = settings.store_phone.replace('55', '(').slice(0,5) + ') ' + settings.store_phone.slice(-9);
  }
  if (settings.store_address) {
    document.getElementById('contact-address').textContent = settings.store_address;
  }
  if (settings.store_open && settings.store_close) {
    document.getElementById('contact-hours').textContent = `Seg-Dom ${settings.store_open}h-${settings.store_close}h`;
  }
}

// ─── BANNER CAROUSEL ───
let bannerInterval = null;
let bannerCurrent = 0;
const BANNER_INTERVAL = 4000;

async function loadBanners() {
  try {
    const banners = await API.get('/api/banners');
    renderBanners(banners);
  } catch (e) {
    console.warn('Failed to load banners, using defaults');
    renderBanners([]);
  }
}

function renderBanners(banners) {
  const track = document.getElementById('banner-track');
  const dotsContainer = document.getElementById('banner-dots');
  if (!track) return;

  const defaultBanners = [
    { title: 'O verdadeiro<br><strong>açaí mineiro</strong>', subtitle: 'Ingredientes selecionados, sabor inesquecível', button_text: 'Ver Cardápio →', button_action: 'menu', emoji: '🥣', bg_color: '#7C3AED' },
    { title: 'Promoções<br><strong>imperdíveis</strong>', subtitle: 'Ofertas especiais por tempo limitado', button_text: 'Ver Promos →', button_action: 'promos', emoji: '🔥', bg_color: '#DB2777' },
    { title: 'Delivery<br><strong>rápido e fácil</strong>', subtitle: 'Pediu, chegou! Entrega em Contagem', button_text: 'Pedir Agora →', button_action: 'cart', emoji: '🚚', bg_color: '#059669' }
  ];

  const slides = banners.length ? banners : defaultBanners;

  track.innerHTML = slides.map(b => {
    const title = b.title || '';
    const subtitle = b.subtitle || '';
    const btnText = b.button_text || '';
    const action = b.button_action || 'menu';
    const bg = b.image_url ? `url('${b.image_url}') center/cover no-repeat, ${b.bg_color || '#7C3AED'}` : `linear-gradient(135deg, ${b.bg_color || '#7C3AED'}, color-mix(in srgb, ${b.bg_color || '#7C3AED'}, #000 30%))`;

    return `
      <div class="banner-slide" style="background: ${bg};">
        <div class="banner-content">
          <h2 class="banner-title">${title}</h2>
          <p class="banner-subtitle">${subtitle}</p>
          ${btnText ? `<button class="banner-btn" onclick="navigateTo('${action}')">${btnText}</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  dotsContainer.innerHTML = slides.map((_, i) =>
    `<span class="banner-dot${i === 0 ? ' active' : ''}" data-slide="${i}"></span>`
  ).join('');

  initBanners();
}

let bannerListenersAttached = false;

function initBanners() {
  const track = document.getElementById('banner-track');
  const dots = document.querySelectorAll('.banner-dot');
  if (!track || !track.children.length) return;
  bannerCurrent = 0;
  goToSlide(0);
  startBannerAuto();

  dots.forEach(dot => {
    dot.onclick = () => {
      const idx = parseInt(dot.dataset.slide);
      goToSlide(idx);
      resetBannerAuto();
    };
  });

  if (bannerListenersAttached) return;
  bannerListenersAttached = true;

  let sx = 0, sd = 0, dragging = false;
  const onStart = (x) => { sx = x; sd = 0; dragging = true; track.classList.add('dragging'); resetBannerAuto(); };
  const onMove = (x) => { if (!dragging) return; sd = sx - x; track.style.transform = `translateX(calc(-${bannerCurrent * 100}% - ${sd}px))`; };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    track.style.transition = 'transform 0.3s ease';
    if (Math.abs(sd) > 40) { sd > 0 ? nextSlide() : prevSlide(); }
    else { goToSlide(bannerCurrent); }
    setTimeout(() => track.style.transition = 'transform 0.5s var(--ease)', 300);
    resetBannerAuto();
  };
  track.addEventListener('touchstart', (e) => onStart(e.changedTouches[0].clientX));
  track.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e.changedTouches[0].clientX); }, { passive: false });
  track.addEventListener('touchend', (e) => onEnd());
  track.addEventListener('mousedown', (e) => onStart(e.clientX));
  track.addEventListener('mousemove', (e) => { if (dragging) onMove(e.clientX); });
  track.addEventListener('mouseup', onEnd);
  track.addEventListener('mouseleave', () => { if (dragging) onEnd(); });
}

function goToSlide(idx) {
  const track = document.getElementById('banner-track');
  const slides = track.children.length;
  bannerCurrent = (idx + slides) % slides;
  track.style.transform = `translateX(-${bannerCurrent * 100}%)`;
  document.querySelectorAll('.banner-dot').forEach((d, i) => {
    d.classList.toggle('active', i === bannerCurrent);
  });
}

function nextSlide() { goToSlide(bannerCurrent + 1); }
function prevSlide() { goToSlide(bannerCurrent - 1); }

function startBannerAuto() {
  stopBannerAuto();
  bannerInterval = setInterval(nextSlide, BANNER_INTERVAL);
}

function stopBannerAuto() {
  if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
}

function resetBannerAuto() {
  stopBannerAuto();
  bannerInterval = setInterval(nextSlide, BANNER_INTERVAL);
}

// ─── FEATURED PRODUCTS ───
function renderFeatured() {
  const el = document.getElementById('featured-products');
  if (!el) return;

  const featured = allProducts.filter(p => p.active).slice(0, 8);
  if (!featured.length) { el.innerHTML = ''; return; }

  el.innerHTML = featured.map(p => {
    const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
    const imgUrl = productImageUrl(p);
    return `
      <div class="featured-card" onclick="showProduct(${p.id})">
        <img src="${imgUrl}" alt="${p.name}" class="featured-card-image" onerror="this.style.display='none';this.nextElementSibling.querySelector('.featured-card-name').style.paddingTop='12px'">
        <div class="featured-card-body">
          ${p.has_promo ? '<span class="promo-tag-card">🔥 PROMO</span>' : ''}
          <div class="featured-card-name">${p.name}</div>
          <div class="featured-card-price">R$ ${price.toFixed(2).replace('.',',')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── MAIS VENDIDOS ───
async function renderTopProducts() {
  const el = document.getElementById('top-products');
  if (!el) return;
  try {
    const top = await API.get('/api/products/top');
    if (!top.length) { el.innerHTML = ''; return; }
    el.innerHTML = top.map(p => {
      const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
      const imgUrl = productImageUrl(p);
      return `
        <div class="featured-card" onclick="showProduct(${p.id})">
          <div style="position:relative;">
            <img src="${imgUrl}" alt="${p.name}" class="featured-card-image" onerror="this.style.display='none'">
            <span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;backdrop-filter:blur(4px);">#${p.total_sold || 0} vendidos</span>
          </div>
          <div class="featured-card-body">
            ${p.has_promo ? '<span class="promo-tag-card">🔥 PROMO</span>' : ''}
            <div class="featured-card-name">${p.name}</div>
            <div class="featured-card-price">R$ ${price.toFixed(2).replace('.',',')}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) { el.innerHTML = ''; }
}

// ─── COMBOS ───
async function renderCombos() {
  const el = document.getElementById('combos-grid');
  if (!el) return;
  try {
    allCombos = await API.get('/api/combos');
    const hdr = el.previousElementSibling;
    if (!allCombos.length) { el.innerHTML = ''; if (hdr?.classList.contains('section-header')) hdr.style.display = 'none'; return; }
    if (hdr?.classList.contains('section-header')) hdr.style.display = 'flex';
    el.innerHTML = allCombos.map(c => {
      const itemsHtml = c.items ? c.items.map(i => `${i.icon || '🥣'} ${i.name}`).join(', ') : c.description || '';
      const desconto = c.old_price ? Math.round((1 - c.price / c.old_price) * 100) : 0;
      return `
        <div class="combo-card" onclick="openComboModal(${c.id})">
          <span class="combo-icon">${c.icon || '🎯'}</span>
          <div class="combo-body">
            <h4>${c.name}</h4>
            <p>${itemsHtml}</p>
            <div class="combo-price-row">
              <span class="combo-price">R$ ${c.price.toFixed(2).replace('.',',')}</span>
              ${c.old_price ? `<span class="combo-old-price">R$ ${c.old_price.toFixed(2).replace('.',',')}</span>` : ''}
            </div>
          </div>
          ${desconto > 0 ? `<span class="combo-badge">-${desconto}%</span>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) { el.innerHTML = ''; }
}

function openComboModal(comboId) {
  const c = allCombos.find(x => x.id === comboId);
  if (!c) return;
  comboModalProduct = c;
  comboModalQty = 1;

  const imgEl = document.getElementById('combo-modal-image');
  const imgUrl = c.items && c.items[0] && c.items[0].image ? c.items[0].image : '';
  if (imgUrl) {
    imgEl.src = imgUrl;
    imgEl.style.display = 'block';
    imgEl.onerror = function() { this.style.display = 'none'; };
  } else {
    imgEl.style.display = 'none';
  }

  document.getElementById('combo-modal-name').textContent = c.name;
  document.getElementById('combo-modal-desc').textContent = c.description || '';

  const itemsHtml = c.items ? c.items.map(i =>
    `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;">
      <span>${i.icon || '🥣'}</span>
      <span style="flex:1;">${i.name}</span>
    </div>`
  ).join('') : '<span style="font-size:13px;color:#888;">Nenhum item cadastrado</span>';
  document.getElementById('combo-items-list').innerHTML = itemsHtml;

  document.getElementById('combo-modal-price').textContent = `R$ ${c.price.toFixed(2).replace('.',',')}`;
  const oldPriceEl = document.getElementById('combo-modal-oldprice');
  if (c.old_price) {
    oldPriceEl.textContent = `R$ ${c.old_price.toFixed(2).replace('.',',')}`;
    oldPriceEl.style.display = 'inline';
  } else {
    oldPriceEl.style.display = 'none';
  }

  document.getElementById('combo-modal-qty').textContent = '1';
  document.getElementById('combo-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeComboModal(event) {
  if (event && event.target !== document.getElementById('combo-modal')) return;
  document.getElementById('combo-modal').classList.add('hidden');
  document.body.style.overflow = '';
  comboModalProduct = null;
}

function comboModalChangeQty(delta) {
  comboModalQty = Math.max(1, comboModalQty + delta);
  document.getElementById('combo-modal-qty').textContent = comboModalQty;
}

function comboModalAddToCart() {
  if (!comboModalProduct) return;
  const c = comboModalProduct;
  const comboId = -c.id;
  const existing = cart.find(x => x.id === comboId);
  if (existing) {
    existing.qty += comboModalQty;
  } else {
    cart.push({
      id: comboId,
      name: c.name,
      price: c.price,
      icon: c.icon || '🎯',
      qty: comboModalQty,
      is_combo: true,
      items: c.items || []
    });
  }
  updateCartUI();
  animateCart();
  closeComboModal();
  showToast(`🎯 Combo "${c.name}" adicionado!`);
}

// ─── COUPOM DO DIA (HOME) ───
function irResgatarCupom() {
  redirectToCheckout = true;
  navigateTo('cupons');
}
async function resgatarProdutoFidelidade(dataset) {
  const { code, productId, productName, productPrice } = dataset;
  try {
    await API.post('/api/loyalty/redeem-product', { coupon_code: code });
  } catch (e) {}
  const existing = cart.find(i => i.id == productId && i.is_reward);
  if (!existing) {
    cart.push({
      id: parseInt(productId),
      name: `🏆 ${productName} (Fidelidade)`,
      price: 0,
      qty: 1,
      icon: '🎁',
      is_reward: true,
      original_price: parseFloat(productPrice) || 0
    });
    updateCartUI();
  }
  localStorage.removeItem('acaineiro_last_reward');
  navigateTo('checkout');
  showCheckout();
  const toast = document.getElementById('toast');
  if (toast) { toast.textContent = `🎉 ${productName} grátis adicionado ao carrinho!`; toast.style.display = 'block'; toast.style.opacity = '1'; setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 300); }, 3000); }
}
async function resgatarCupom(code, discountPercent, discountValue) {
  cupomResgatado = code;
  localStorage.setItem('cupomResgatado', code);
  const pct = parseFloat(discountPercent || 0);
  const val = parseFloat(discountValue || 0);
  const label = pct > 0 ? `-${pct}%` : `-R$ ${val.toFixed(2).replace('.',',')}`;
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = `🎉 Cupom ${code} resgatado! (${label}) Use no checkout`;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.style.display = 'none', 300);
    }, 3000);
  }
  // Marcar como resgatado na API para nao aparecer mais na lista
  try {
    await API.post('/api/loyalty/redeem-product', { coupon_code: code });
  } catch (e) {}
  // Update all buttons on cupons page
  document.querySelectorAll('.coupon-page-btn').forEach(btn => {
    if (btn.dataset.code === code) {
      btn.textContent = '✅ Resgatado';
      btn.className = 'coupon-page-btn resgatado';
      btn.disabled = true;
    }
  });
  // If came from checkout, go back with coupon applied
  if (redirectToCheckout) {
    redirectToCheckout = false;
    setTimeout(() => {
      navigateTo('checkout');
      showCheckout();
    }, 400);
  }
}
async function renderCupomDoDia() {
  const el = document.getElementById('cupom-do-dia');
  const preview = document.getElementById('cupom-dia-preview');
  if (!el) return;
  try {
    const coupons = await API.get('/api/coupons');
    const withImage = coupons.filter(c => c.image_url);
    if (!withImage.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const c = withImage[0];
    preview.style.backgroundImage = `url('${c.image_url}')`;
    preview.innerHTML = `<div class="cupom-dia-overlay">${c.code} • -${c.discount_percent}%</div>`;
  } catch (e) { el.style.display = 'none'; }
}

// ─── COUPONS PAGE ───
async function renderCouponsPage() {
  const list = document.getElementById('coupons-list');
  if (!list) return;
  try {
    const coupons = await API.get('/api/coupons');
    let html = '';

    // Reload settings to get latest loyalty_reward_image
    try { settings = await API.get('/api/settings'); } catch (e) {}

    // Show earned loyalty rewards
    let phone = userData?.phone || '';
    if (!phone) {
      const savedOrders = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
      if (savedOrders.length) phone = savedOrders[0].customer?.phone || '';
    }
    // Also check locally stored reward (in case phone lookup fails)
    const localReward = JSON.parse(localStorage.getItem('acaineiro_last_reward') || 'null');
    if (localReward && !phone) {
      phone = 'local';
    }
    if (phone) {
      try {
        let loyaltyRewards = [];
        if (phone === 'local') {
          loyaltyRewards = localReward ? [localReward] : [];
        } else {
          const loyaltyData = await API.get(`/api/loyalty/${encodeURIComponent(phone)}`);
          loyaltyRewards = loyaltyData.rewards || [];
        }
        // Also merge local reward if not already in list
        if (localReward && !loyaltyRewards.find(r => r.coupon_code === localReward.code)) {
          if (localReward.type === 'product') {
            loyaltyRewards.unshift({
              coupon_code: localReward.code,
              reward_product_id: localReward.product_id,
              product_name: localReward.product_name,
              description: localReward.desc || '',
              discount_percent: 0,
              discount_value: localReward.value || 0,
              image_url: localReward.image_url || ''
            });
          } else {
            loyaltyRewards.unshift({
              coupon_code: localReward.code,
              description: localReward.desc || 'Cupom de fidelidade',
              discount_percent: localReward.type === 'percent' ? localReward.value : 0,
              discount_value: localReward.type !== 'percent' ? localReward.value : 0,
              image_url: localReward.image_url || ''
            });
          }
        }
        if (loyaltyRewards.length) {
          html += `<div style="margin-bottom:12px;font-size:13px;color:var(--text-tertiary);font-weight:600;">🎁 Seus cupons de fidelidade</div>`;
          html += loyaltyRewards.map(r => {
            const isProduct = parseInt(r.reward_product_id) > 0;
            if (isProduct) {
              const pImg = r.product_image || settings.loyalty_reward_image || '';
              return `
              <div class="coupon-page-card" style="border:2px solid #22c55e;">
                <div class="coupon-page-body">
                  <div class="coupon-page-code" style="color:#16a34a;">🏆 ${r.product_name || 'Produto Grátis'}</div>
                  <div class="coupon-page-desc">${r.description || ''}</div>
                  <div style="font-size:13px;color:#16a34a;font-weight:700;margin:4px 0;">R$ 0,00 • Grátis</div>
                  <button class="coupon-page-btn resgatar" data-code="${r.coupon_code}" data-product-id="${r.reward_product_id}" data-product-name="${r.product_name || ''}" data-product-price="${r.product_price || 0}" onclick="resgatarProdutoFidelidade(this.dataset)">🎁 Resgatar Agora</button>
                </div>
              </div>`;
            }
            const imgUrl = settings.loyalty_reward_image || '';
            const hasImg = !!imgUrl;
            const isPercent = parseFloat(r.discount_percent || 0) > 0;
            const discountLabel = isPercent ? `${r.discount_percent}% de desconto` : `R$ ${parseFloat(r.discount_value || 0).toFixed(2).replace('.',',')} de desconto`;
            const code = r.coupon_code;
            return `
            <div class="coupon-page-card ${hasImg ? 'has-image' : ''}" style="border:2px solid #fbbf24;">
              ${hasImg ? `<div class="coupon-page-image" style="background-image:url('${imgUrl}')"><div class="coupon-page-badge">${code} • -${discountLabel}</div></div>` : ''}
              <div class="coupon-page-body">
                <div class="coupon-page-code" style="color:#b45309;">${code}</div>
                <div class="coupon-page-desc">${r.description || 'Cupom de fidelidade'}</div>
                <div class="coupon-page-discount" style="background:#fef3c7;color:#b45309;">${discountLabel}</div>
                <button class="coupon-page-btn resgatar" data-code="${code}" data-percent="${r.discount_percent || 0}" data-value="${r.discount_value || 0}" onclick="resgatarCupom(this.dataset.code, this.dataset.percent, this.dataset.value)">🏷️ Resgatar Cupom</button>
              </div>
            </div>`;
          }).join('');
          html += `<hr style="border-color:var(--border-light);margin:16px 0;">`;
        }
      } catch (e) {}
    }

    if (!coupons.length && !html) {
      list.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text-tertiary);font-size:14px;">Nenhum cupom disponível no momento</div>`;
      return;
    }
    html += coupons.map(c => {
      const jaResgatado = cupomResgatado === c.code;
      const esgotado = c.exhausted === 1 || c.exhausted === true;
      const disabled = jaResgatado || esgotado;
      const hasImg = !!c.image_url;
      const cp = parseFloat(c.discount_percent || 0);
      const cv = parseFloat(c.discount_value || 0);
      const cl = cp > 0 ? `${cp}%` : `R$ ${cv.toFixed(2).replace('.',',')}`;
      const badgeLabel = cl;
      const nome = c.name || c.code;
      return `
        <div class="coupon-page-card ${hasImg ? 'has-image' : ''}">
          ${hasImg ? `<div class="coupon-page-image" style="background-image:url('${c.image_url}')"><div class="coupon-page-badge">${c.code} • -${badgeLabel}</div></div>` : ''}
          <div class="coupon-page-body">
            <div class="coupon-page-code">${nome}</div>
            ${c.code !== nome ? `<div style="font-size:11px;color:#aaa;margin-bottom:2px;">${c.code}</div>` : ''}
            ${c.description ? `<div class="coupon-page-desc">${c.description}</div>` : ''}
            <div class="coupon-page-discount">${cl} de desconto</div>
            <button class="coupon-page-btn ${disabled ? 'resgatado' : 'resgatar'}" data-code="${c.code}" data-percent="${c.discount_percent || 0}" data-value="${c.discount_value || 0}" ${disabled ? 'disabled' : ''} onclick="resgatarCupom(this.dataset.code, this.dataset.percent, this.dataset.value)">${esgotado ? '🔒 Esgotado' : jaResgatado ? '✅ Resgatado' : '🏷️ Resgatar Cupom'}</button>
          </div>
        </div>
      `;
    }).join('');
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--red);font-size:14px;">Erro ao carregar cupons</div>`;
  }
}

// ─── FLASH SALE ───
let flashInterval = null;
let flashEnd = null;

async function initFlashTimer() {
  const el = document.getElementById('flash-timer');
  if (!el) return;
  try {
    const st = await API.get('/api/flash-status');
    if (!st.active || !st.end_time) {
      const flashEl = document.getElementById('flash-sale');
      if (flashEl) flashEl.style.display = 'none';
      return;
    }
    flashEnd = new Date(st.end_time).getTime();
  } catch (e) {
    flashEnd = Date.now() + 2 * 3600000 + 30 * 60000;
  }
  updateFlashTimer();
  flashInterval = setInterval(updateFlashTimer, 1000);
}

function updateFlashTimer() {
  const now = new Date();
  const diff = flashEnd - now;
  if (diff <= 0) {
    clearInterval(flashInterval);
    const flashEl = document.getElementById('flash-sale');
    if (flashEl) flashEl.style.display = 'none';
    const combosGrid = document.getElementById('combos-grid');
    if (combosGrid) combosGrid.style.display = 'none';
    const combosHeader = combosGrid?.previousElementSibling;
    if (combosHeader && combosHeader.classList.contains('section-header')) combosHeader.style.display = 'none';
    return;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  document.getElementById('flash-hours').textContent = String(h).padStart(2, '0');
  document.getElementById('flash-minutes').textContent = String(m).padStart(2, '0');
  document.getElementById('flash-seconds').textContent = String(s).padStart(2, '0');
}

function renderFlashProducts() {
  const el = document.getElementById('flash-products');
  if (!el) return;
  const flashItems = allProducts.filter(p => p.has_promo && p.promo_price).slice(0, 6);
  if (!flashItems.length) {
    el.innerHTML = '<p style="color:rgba(255,255,255,0.5);font-size:12px;padding:8px 0;">Nenhuma promoção no momento</p>';
    return;
  }
  el.innerHTML = flashItems.map(p => {
    const imgUrl = productImageUrl(p);
    return `
      <div class="featured-card" onclick="showProduct(${p.id})">
        <img src="${imgUrl}" alt="${p.name}" class="featured-card-image" onerror="this.style.display='none'">
        <div class="featured-card-body">
          <div class="featured-card-name">${p.name}</div>
          <div class="featured-card-price" style="color:#fbbf24;">R$ ${p.promo_price.toFixed(2).replace('.',',')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── FIDELIDADE ───
function renderLoyalty() {
  const stampsEl = document.getElementById('loyalty-stamps');
  const fillEl = document.getElementById('loyalty-bar-fill');
  const countEl = document.getElementById('loyalty-count');
  if (!stampsEl) return;

  const phone = userData?.phone || '';
  if (!phone) {
    stampsEl.innerHTML = '';
    if (countEl) countEl.textContent = 'Faça login para participar';
    if (fillEl) fillEl.style.width = '0%';
    return;
  }

  API.get(`/api/loyalty/${encodeURIComponent(phone)}`).then(data => {
    const goal = parseInt(settings.loyalty_goal) || 10;
    const total = Math.min(data.count, goal);
    stampsEl.innerHTML = '';
    for (let i = 0; i < goal; i++) {
      const stamp = document.createElement('div');
      stamp.className = `loyalty-stamp ${i < total ? 'filled' : ''}`;
      stampsEl.appendChild(stamp);
    }
    if (fillEl) fillEl.style.width = `${(total / goal) * 100}%`;
    if (countEl) {
      if (data.count >= goal) {
        countEl.textContent = '🎉 Parabéns! Você ganhou um cupom! Confira em Cupons';
      } else {
        countEl.textContent = `${data.count} de ${goal} compras`;
      }
    }
  }).catch(() => {
    if (countEl) countEl.textContent = 'Erro ao carregar';
  });
}

// ─── COMPARTILHAR ───
function shareApp() {
  const text = '🥣 Venha conhecer o Açaineiro - O melhor açaí de Contagem! Peça já pelo app: https://sistemaacaineiro.netlify.app';
  if (navigator.share) {
    navigator.share({ title: 'Açaineiro', text, url: 'https://sistemaacaineiro.netlify.app' }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => alert('✅ Link copiado! Compartilhe com um amigo.'));
  } else {
    prompt('Copie o link:', text);
  }
}

function renderCategories() {
  const el = document.getElementById('menu-categories');
  el.innerHTML = '<button class="menu-tab active" data-cat="todos">Todos</button>' +
    allCategories.map(c => `<button class="menu-tab" data-cat="${c.slug}">${c.icon} ${c.name}</button>`).join('');

  el.querySelectorAll('.menu-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.menu-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.cat;
      renderProducts(currentCategory);
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  });

  // Drag to scroll for categories
  let isDown = false, startX2 = 0, scrollLeft2 = 0;
  el.addEventListener('mousedown', (e) => { isDown = true; el.style.cursor = 'grabbing'; startX2 = e.pageX - el.offsetLeft; scrollLeft2 = el.scrollLeft; });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - el.offsetLeft; el.scrollLeft = scrollLeft2 - (x - startX2); });
  el.addEventListener('touchstart', (e) => { startX2 = e.touches[0].clientX; scrollLeft2 = el.scrollLeft; }, { passive: true });
  el.addEventListener('touchmove', (e) => { const x = e.touches[0].clientX; el.scrollLeft = scrollLeft2 - (x - startX2); startX2 = x; scrollLeft2 = el.scrollLeft; }, { passive: true });
}

function productImageUrl(product) {
  if (product.image) return product.image;
  const name = (typeof product === 'string' ? product : product.name)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `img/products/${name}.jpg`;
}

function renderProducts(category) {
  const el = document.getElementById('menu-items');
  let items = allProducts;
  if (category !== 'todos') items = items.filter(p => p.category_slug === category);

  if (!items.length) {
    el.innerHTML = '<p style="text-align:center;padding:40px;color:#888;">Nenhum produto encontrado</p>';
    return;
  }

  el.innerHTML = items.map(p => {
    const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
    const oldPrice = p.has_promo && p.promo_price ? p.price : null;
    const imgUrl = productImageUrl(p);
    return `
      <div class="menu-item" onclick="showProduct(${p.id})">
        <img src="${imgUrl}" alt="${p.name}" class="menu-item-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="menu-item-icon" style="display:none;height:160px;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#f8f4ff,#f0e6ff);">${p.icon || '🥣'}</div>
        <div class="menu-item-body">
          <div class="menu-item-info">
            <h4>${p.name} ${p.has_promo ? '<span class="promo-tag">🔥 PROMO</span>' : ''}</h4>
            <p>${p.description || ''}</p>
          </div>
          <div class="menu-price-row">
            <span class="menu-item-price">R$ ${price.toFixed(2).replace('.',',')}</span>
            ${oldPrice ? `<span class="old-price">R$ ${oldPrice.toFixed(2).replace('.',',')}</span>` : ''}
            <button class="btn-add-cart" onclick="event.stopPropagation();addToCart(${p.id})">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPromos() {
  const el = document.getElementById('promo-items');
  const promos = allProducts.filter(p => p.has_promo && p.promo_price);
  if (!promos.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;"><span style="font-size:48px;display:block;margin-bottom:12px;">🔥</span><p style="color:var(--text-tertiary);font-size:14px;">Nenhuma promoção no momento.<br>Volte em breve!</p></div>';
    return;
  }
  el.innerHTML = promos.map(p => {
    const imgUrl = productImageUrl(p);
    return `
      <div class="menu-item" onclick="showProduct(${p.id})">
        <img src="${imgUrl}" alt="${p.name}" class="menu-item-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="menu-item-icon" style="display:none;height:160px;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#fef2f2,#fee2e2);">🔥</div>
        <div class="menu-item-body">
          <div class="menu-item-info">
            <h4>${p.name} <span class="promo-badge-large">🔥 PROMO</span></h4>
            <p>${p.description || ''}</p>
          </div>
          <div class="menu-price-row">
            <div class="price-discount">
              <span class="price-original">R$ ${p.price.toFixed(2).replace('.',',')}</span>
              <span class="price-promo">R$ ${p.promo_price.toFixed(2).replace('.',',')}</span>
            </div>
            <button class="btn-add-cart" onclick="event.stopPropagation();addToCart(${p.id})">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function setupSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    if (!q) { renderProducts(currentCategory); return; }
    const filtered = allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    );
    const el = document.getElementById('menu-items');
    if (!filtered.length) { el.innerHTML = '<p style="text-align:center;padding:40px;color:#888;">Nenhum resultado</p>'; return; }
    el.innerHTML = filtered.map(p => {
      const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
      const imgUrl = productImageUrl(p);
      return `<div class="menu-item" onclick="showProduct(${p.id})">
        <img src="${imgUrl}" alt="${p.name}" class="menu-item-image" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="menu-item-icon" style="display:none;height:160px;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#f8f4ff,#f0e6ff);">${p.icon || '🥣'}</div>
        <div class="menu-item-body">
          <div class="menu-item-info">
            <h4>${p.name}</h4>
            <p>${p.description || ''}</p>
          </div>
          <div class="menu-price-row">
            <span class="menu-item-price">R$ ${price.toFixed(2).replace('.',',')}</span>
            <button class="btn-add-cart" onclick="event.stopPropagation();addToCart(${p.id})">+</button>
          </div>
        </div>
      </div>`;
    }).join('');
  });
}

// ─── PRODUCT DETAIL MODAL ───
let modalProduct = null;
let modalQty = 1;
let allCombos = [];
let comboModalProduct = null;
let comboModalQty = 1;

function showProduct(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  modalProduct = p;
  modalQty = 1;

  const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
  const oldPrice = p.has_promo && p.promo_price ? p.price : null;
  const imgUrl = productImageUrl(p);

  document.getElementById('modal-image').src = imgUrl;
  document.getElementById('modal-image').onerror = function() {
    this.style.display = 'none';
  };
  document.getElementById('modal-image').onload = function() {
    this.style.display = 'block';
  };
  document.getElementById('modal-name').textContent = p.name;
  document.getElementById('modal-desc').textContent = p.description || '';
  document.getElementById('modal-price').textContent = `R$ ${price.toFixed(2).replace('.',',')}`;
  const oldPriceEl = document.getElementById('modal-oldprice');
  if (oldPrice) {
    oldPriceEl.textContent = `R$ ${oldPrice.toFixed(2).replace('.',',')}`;
    oldPriceEl.style.display = 'inline';
  } else {
    oldPriceEl.style.display = 'none';
  }
  document.getElementById('modal-qty').textContent = '1';
  document.getElementById('product-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeProductModal(event) {
  if (event && event.target !== document.getElementById('product-modal')) return;
  document.getElementById('product-modal').classList.add('hidden');
  document.body.style.overflow = '';
  modalProduct = null;
}

function modalChangeQty(delta) {
  modalQty = Math.max(1, modalQty + delta);
  document.getElementById('modal-qty').textContent = modalQty;
}

function modalAddToCart() {
  if (!modalProduct) return;
  for (let i = 0; i < modalQty; i++) {
    addToCart(modalProduct.id);
  }
  closeProductModal();
}

function addToCart(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const price = p.has_promo && p.promo_price ? p.promo_price : p.price;
  const existing = cart.find(x => x.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: p.id, name: p.name, description: p.description || '', price, icon: p.icon || '🥣', qty: 1 });
  }
  updateCartUI();
  animateCart();
}

function changeQty(productId, delta) {
  const item = cart.find(x => x.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== productId);
  updateCartUI();
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);

  const el = document.getElementById('cart-items');
  if (!cart.length) {
    el.innerHTML = '<p style="text-align:center;padding:24px;color:#888;">Carrinho vazio</p>';
    document.getElementById('cart-total').textContent = 'R$ 0,00';
    document.getElementById('cart-summary').classList.add('hidden');
    return;
  }

  el.innerHTML = cart.map(item => `
    <div class="cart-item">
      <span>${item.icon} ${item.name}</span>
      <div class="cart-qty">
        <button onclick="changeQty(${item.id},-1)">−</button>
        <span>${item.qty}</span>
        <button onclick="changeQty(${item.id},1)">+</button>
      </div>
      <span class="cart-item-price">R$ ${(item.price * item.qty).toFixed(2).replace('.',',')}</span>
    </div>
  `).join('');

  const fee = parseFloat(settings.delivery_fee) || 0;
  const grandTotal = total + fee;
  document.getElementById('cart-subtotal').textContent = total.toFixed(2).replace('.',',');
  document.getElementById('cart-fee').textContent = fee.toFixed(2).replace('.',',');
  document.getElementById('cart-fee-row').style.display = fee > 0 ? 'flex' : 'none';
  document.getElementById('cart-total').textContent = `R$ ${grandTotal.toFixed(2).replace('.',',')}`;
  document.getElementById('cart-summary').classList.remove('hidden');
}

function animateCart() {
  const badge = document.getElementById('cart-badge');
  badge.classList.remove('pop');
  void badge.offsetWidth;
  badge.classList.add('pop');
}

function toggleTroco() {
  const el = document.getElementById('troco-section');
  const val = document.querySelector('input[name="payment"]:checked')?.value;
  el.style.display = val === 'dinheiro' ? 'block' : 'none';
  if (val !== 'dinheiro') {
    document.getElementById('ord-troco').value = '';
    document.getElementById('troco-result').style.display = 'none';
  }
}

function toggleCardType() {
  const el = document.getElementById('card-type-options');
  const val = document.querySelector('input[name="payment"]:checked')?.value;
  el.classList.toggle('hidden', val !== 'cartao');
}

let activeCoupon = null;
let cupomResgatado = localStorage.getItem('cupomResgatado') || null;
let redirectToCheckout = false;

async function applyCoupon() {
  const input = document.getElementById('coupon-input');
  const feedback = document.getElementById('coupon-feedback');
  const code = input.value.trim().toUpperCase();
  if (!code) { feedback.innerHTML = '<span style="color:#888;">Digite um código</span>'; return; }

  const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  try {
    const r = await fetch(`${API_URL}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal })
    }).then(r => r.json());

    if (r.error) {
      feedback.innerHTML = r.error;
      feedback.className = 'coupon-feedback error';
      window.activeCoupon = null;
      cupomResgatado = null;
      localStorage.removeItem('cupomResgatado');
      hideCouponApplied();
      return;
    }

    window.activeCoupon = r;
    const rpct = r.discount_percent || 0;
    feedback.innerHTML = rpct > 0 ? `✅ Cupom ${r.code} aplicado! -${rpct}% (desconto de R$ ${r.discount.toFixed(2).replace('.',',')})` : `✅ Cupom ${r.code} aplicado! (desconto de R$ ${r.discount.toFixed(2).replace('.',',')})`;
    feedback.className = 'coupon-feedback success';
    activeCoupon = r;
    showCouponApplied(r.code, r.discount_percent, r.discount);
    updateCheckoutWithCoupon();
  } catch (e) {
    feedback.innerHTML = 'Erro ao validar cupom';
    feedback.className = 'coupon-feedback error';
  }
}

function showCouponApplied(code, percent, discount) {
  document.getElementById('coupon-input-row').style.display = 'none';
  document.getElementById('coupon-select-row').style.display = 'none';
  const row = document.getElementById('coupon-applied-row');
  row.style.display = 'flex';
  document.getElementById('coupon-applied-code').textContent = code;
  document.getElementById('coupon-applied-discount').textContent = `-${percent}% (R$ ${discount.toFixed(2).replace('.',',')})`;
}

function hideCouponApplied() {
  document.getElementById('coupon-input-row').style.display = 'none';
  document.getElementById('coupon-select-row').style.display = 'flex';
  document.getElementById('coupon-applied-row').style.display = 'none';
  document.getElementById('coupon-feedback').className = 'coupon-feedback';
  document.getElementById('coupon-feedback').innerHTML = '';
}

function updateCheckoutWithCoupon() {
  const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
  const neighborhood = document.getElementById('ord-neighborhood')?.value || '';
  const fee = deliveryFeeFor(neighborhood, isPickup);
  const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const discount = window.activeCoupon ? window.activeCoupon.discount : 0;
  const total = subtotal + fee - discount;
  document.getElementById('checkout-total').textContent = `R$ ${total.toFixed(2).replace('.',',')}`;
  const couponRow = document.getElementById('checkout-coupon-row');
  const discEl = document.getElementById('checkout-discount');
  if (window.activeCoupon && discount > 0) {
    couponRow.style.display = 'flex';
    discEl.textContent = `-R$ ${discount.toFixed(2).replace('.',',')} (${window.activeCoupon.discount_percent}%)`;
  } else {
    couponRow.style.display = 'none';
  }
  calcTroco();
}

function removeCoupon() {
  window.activeCoupon = null;
  cupomResgatado = null;
  localStorage.removeItem('cupomResgatado');
  document.getElementById('coupon-input').value = '';
  hideCouponApplied();
  updateCheckoutWithCoupon();
}

function calcTroco() {
    const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
    const neighborhood = document.getElementById('ord-neighborhood')?.value || '';
    const fee = deliveryFeeFor(neighborhood, isPickup);
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const discount = window.activeCoupon ? window.activeCoupon.discount : 0;
    const total = subtotal + fee - discount;
  const pago = parseFloat(document.getElementById('ord-troco').value) || 0;
  const result = document.getElementById('troco-result');
  if (pago > total) {
    result.innerHTML = `🔹 Pagará <strong>R$ ${pago.toFixed(2).replace('.',',')}</strong> — Troco: <strong>R$ ${(pago - total).toFixed(2).replace('.',',')}</strong>`;
    result.style.display = 'block';
  } else {
    result.style.display = 'none';
  }
}

async function toggleCardSelector() {} // no-op, kept for compatibility


function toggleOrderType() {
  const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
  const addrGroup = document.querySelector('.checkout-address-group');
  const addrInfo = document.getElementById('checkout-address-info');
  if (addrGroup) addrGroup.style.display = isPickup ? 'none' : 'flex';
  if (addrInfo) addrInfo.style.display = isPickup ? 'none' : 'block';
  showCheckout();
}

function recalcCheckoutFee() {
  const page = document.getElementById('page-checkout');
  if (page && page.classList.contains('active')) {
    if (freightTimer) clearTimeout(freightTimer);
    freightTimer = setTimeout(async () => {
      await calcFreight();
      showCheckout();
    }, 600);
  }
}

async function showCheckout() {
  if (!cart.length) { alert('Carrinho vazio!'); return; }
  const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
  const neighborhood = document.getElementById('ord-neighborhood')?.value || '';
  const fee = deliveryFeeFor(neighborhood, isPickup);
  const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const discount = window.activeCoupon ? window.activeCoupon.discount : 0;
  const total = subtotal + fee - discount;

  document.getElementById('checkout-items').innerHTML = cart.map(i =>
    `<div style="padding:4px 0;font-size:14px;">
      <div style="display:flex;justify-content:space-between;">
        <span>${i.icon} ${i.qty}x ${i.name}${i.is_combo ? ' <span style="font-size:10px;background:#7C3AED;color:#fff;padding:1px 6px;border-radius:4px;font-weight:600;vertical-align:middle;">COMBO</span>' : ''}</span>
        <span>R$ ${(i.price * i.qty).toFixed(2).replace('.',',')}</span>
      </div>
      ${i.is_combo && i.items ? `<div style="font-size:12px;color:#888;padding-left:24px;margin-top:2px;">📦 ${i.items.map(x => x.name).join(', ')}</div>` : ''}
    </div>`
  ).join('');

  const couponRow = document.getElementById('checkout-coupon-row');
  const discEl = document.getElementById('checkout-discount');
  if (window.activeCoupon && discount > 0) {
    couponRow.style.display = 'flex';
    discEl.textContent = `-R$ ${discount.toFixed(2).replace('.',',')} (${window.activeCoupon.discount_percent}%)`;
  } else {
    couponRow.style.display = 'none';
  }

  const feeEl = document.getElementById('checkout-fee');
  if (feeEl) {
    if (isPickup) {
      feeEl.textContent = 'Grátis (retirada)';
    } else if (lastFreight && lastFreight.distance_km > 0) {
      feeEl.textContent = `R$ ${fee.toFixed(2).replace('.',',')} (${lastFreight.distance_km.toFixed(1).replace('.',',')} km)`;
    } else {
      feeEl.textContent = `R$ ${fee.toFixed(2).replace('.',',')}`;
    }
  }
  document.getElementById('checkout-total').textContent = `R$ ${total.toFixed(2).replace('.',',')}`;

  fillCheckoutData();

  // Restore coupon if active
  if (window.activeCoupon) {
    showCouponApplied(window.activeCoupon.code, window.activeCoupon.discount_percent, window.activeCoupon.discount);
    const pct2 = window.activeCoupon.discount_percent || 0;
    document.getElementById('coupon-feedback').innerHTML = pct2 > 0 ? `✅ Cupom ${window.activeCoupon.code} aplicado! -${pct2}%` : `✅ Cupom ${window.activeCoupon.code} aplicado!`;
    document.getElementById('coupon-feedback').className = 'coupon-feedback success';
  } else if (cupomResgatado && !window.activeCoupon) {
    document.getElementById('coupon-input').value = cupomResgatado;
    await applyCoupon();
  } else {
    hideCouponApplied();
  }

  toggleTroco();
  navigateTo('checkout');
}

function fillCheckoutData() {
  if (userData && userData.name) {
    document.getElementById('ord-name').value = userData.name;
    document.getElementById('ord-phone').value = userData.phone || '';
    document.getElementById('ord-name').setAttribute('readonly', true);
    document.getElementById('ord-phone').setAttribute('readonly', true);
  } else {
    document.getElementById('ord-name').removeAttribute('readonly');
    document.getElementById('ord-phone').removeAttribute('readonly');
  }

  const infoEl = document.getElementById('checkout-address-info');
  const btnAlt = document.getElementById('btn-alt-endereco');

  if (userData && userData.address) {
    document.getElementById('ord-address').value = userData.address;
    document.getElementById('ord-neighborhood').value = userData.neighborhood || '';
    infoEl.className = 'checkout-address-info';
    infoEl.innerHTML = '<span>📍 Usando endereço padrão da sua conta</span>';
    btnAlt.style.display = 'flex';
  } else {
    infoEl.className = 'checkout-address-info hidden';
    btnAlt.style.display = 'none';
  }
}

function toggleAltAddress() {
  const infoEl = document.getElementById('checkout-address-info');
  const isActive = infoEl.classList.contains('active');
  if (isActive) {
    infoEl.classList.remove('active');
    infoEl.innerHTML = '<span>📍 Usando endereço padrão da sua conta</span>';
    document.getElementById('ord-address').value = userData.address || '';
    document.getElementById('ord-neighborhood').value = userData.neighborhood || '';
  } else {
    infoEl.classList.add('active');
    infoEl.innerHTML = '<span>✏️ Editando endereço diferente</span><button class="checkout-alt-address-btn" onclick="undoAltAddress()">↩ Usar padrão</button>';
    document.getElementById('ord-address').value = '';
    document.getElementById('ord-neighborhood').value = '';
    document.getElementById('ord-address').focus();
  }
}

function undoAltAddress() {
  document.getElementById('checkout-address-info').className = 'checkout-address-info';
  document.getElementById('checkout-address-info').innerHTML = '<span>📍 Usando endereço padrão da sua conta</span>';
  document.getElementById('ord-address').value = userData.address || '';
  document.getElementById('ord-neighborhood').value = userData.neighborhood || '';
}

async function submitOrder() {
  const name = document.getElementById('ord-name').value.trim();
  const phone = document.getElementById('ord-phone').value.trim();
  const address = document.getElementById('ord-address').value.trim();
  const neighborhood = document.getElementById('ord-neighborhood').value.trim();
  const payment = document.querySelector('input[name="payment"]:checked');
  const notes = document.getElementById('ord-notes').value.trim();

  if (!name || !phone) { alert('Nome e telefone são obrigatórios!'); return; }
  if (!payment) { alert('Selecione a forma de pagamento!'); return; }

  let amount_paid = null, change_due = 0;
  const isPickup = document.querySelector('input[name="order_type"]:checked')?.value === 'pickup';
  const fee = deliveryFeeFor(neighborhood, isPickup);
  const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const discount = window.activeCoupon ? window.activeCoupon.discount : 0;
  const totalCalc = subtotal + fee - discount;
  if (payment.value === 'dinheiro') {
    const pago = parseFloat(document.getElementById('ord-troco').value) || 0;
    if (pago > totalCalc) {
      amount_paid = pago;
      change_due = pago - totalCalc;
    }
  }

  let couponCode = window.activeCoupon ? window.activeCoupon.code : null;

  // Re-validar cupom antes de enviar
  if (couponCode) {
    try {
      const v = await API.post('/api/coupons/validate', { code: couponCode, subtotal: totalCalc });
      if (v.error) { couponCode = null; window.activeCoupon = null; }
    } catch (e) { couponCode = null; window.activeCoupon = null; }
  }

  try {
    const paymentMethodDetail = payment.value === 'cartao' ? (document.querySelector('input[name="card_type"]:checked')?.value || '') : '';
    const order_type = document.querySelector('input[name="order_type"]:checked')?.value || 'delivery';
    const r = await API.post('/api/orders', { customer: { name, phone, address, neighborhood }, items: cart.map(i => i.is_combo ? { id: i.id, name: i.name, description: i.description || '', price: i.price, qty: i.qty, icon: i.icon, is_combo: true, combo_items: i.items } : { id: i.id, name: i.name, description: i.description || '', price: i.price, qty: i.qty, icon: i.icon }), payment_method: payment.value, payment_method_detail: paymentMethodDetail, notes, amount_paid, change_due, coupon_code: couponCode, order_type });
    // times_used é incrementado no backend ao criar o pedido
    window.activeCoupon = null;
    cupomResgatado = null;
    localStorage.removeItem('cupomResgatado');
    if (couponCode && couponCode.startsWith('FIDEL-')) {
      localStorage.removeItem('acaineiro_last_reward');
    }
    const orderTotal = r.total;
    saveOrderLocally({ id: r.id, status: 'novo', total: orderTotal, items: [...cart], customer: { name, phone, address, neighborhood }, payment_method: payment.value, payment_method_detail: paymentMethodDetail, amount_paid, change_due, notes, coupon: couponCode, created_at: new Date().toISOString() });
    cart = []; updateCartUI();
    clearCheckoutForm();
    if (payment.value === 'pix') {
      connectSocket(r.id);
      navigateTo('payment');
      await initPayment(r.id, payment.value, r.total);
    } else {
      openTracking(r.id);
    }
  } catch (e) {
    alert('Erro ao enviar pedido. Verifique se o servidor está rodando.');
  }
}

function saveOrderLocally(order) {
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  const idx = saved.findIndex(o => o.id === order.id);
  if (idx >= 0) { saved[idx] = order; }
  else { saved.unshift(order); }
  localStorage.setItem('acaineiro_orders', JSON.stringify(saved));
  updateOrderBadge();
}

function clearCheckoutForm() {
  ['ord-name','ord-phone','ord-address','ord-neighborhood','ord-notes','cc-name','cc-number','cc-exp','cc-cvv','cc-cpf','cc-cep','cc-numero'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function openTracking(orderId) {
  currentTrackingId = orderId;
  connectSocket(orderId);

  document.getElementById('tracking-id').textContent = `#${orderId}`;

  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  const order = saved.find(o => o.id === orderId);

  if (order) {
    updateTrackingHeader(order.status || 'novo');
    document.getElementById('tracking-total').textContent = `R$ ${(order.total || 0).toFixed(2).replace('.',',')}`;
    document.getElementById('tracking-items').innerHTML = order.items.map(i =>
      `<div style="padding:4px 0;font-size:14px;">
        <div style="display:flex;justify-content:space-between;">
          <span>${i.icon} ${i.qty}x ${i.name}${i.is_combo ? ' <span style="font-size:10px;background:#7C3AED;color:#fff;padding:1px 6px;border-radius:4px;font-weight:600;vertical-align:middle;">COMBO</span>' : ''}</span>
          <span>R$ ${(i.price * i.qty).toFixed(2).replace('.',',')}</span>
        </div>
        ${i.is_combo && i.combo_items ? `<div style="font-size:12px;color:#888;padding-left:24px;margin-top:2px;">📦 ${i.combo_items.map(x => x.name).join(', ')}</div>` : ''}
        ${i.is_combo && i.items ? `<div style="font-size:12px;color:#888;padding-left:24px;margin-top:2px;">📦 ${i.items.map(x => x.name).join(', ')}</div>` : ''}
      </div>`
    ).join('');
    let pagHtml = `💳 Pagamento: <span>${paymentLabels[order.payment_method] || order.payment_method}</span>`;
    if (order.amount_paid && order.change_due) {
      pagHtml += `<br>💵 Pagará <strong>R$ ${order.amount_paid.toFixed(2).replace('.',',')}</strong> — Troco: <strong>R$ ${order.change_due.toFixed(2).replace('.',',')}</strong>`;
    }
    document.getElementById('tracking-payment').innerHTML = pagHtml;
    document.getElementById('tracking-address').innerHTML = `📍 Endereço: <span>${order.customer.address || ''} ${order.customer.neighborhood || ''}</span>`;
    document.getElementById('tracking-notes').innerHTML = `📝 Observações: <span>${order.notes || '-'}</span>`;
    updateTrackingUI(order);

    API.get(`/api/orders/${orderId}`).then(updateTrackingUI).catch(() => {});
  }

  navigateTo('tracking');
}

const statusLabels = { 'novo':'🆕 Novo', 'preparando':'👨‍🍳 Preparando', 'entregando':'🚚 Saiu pra entrega', 'entregue':'✅ Entregue', 'finalizado':'🎉 Finalizado', 'cancelado':'❌ Cancelado' };
const paymentLabels = { 'pix':'💠 Pix', 'cartao':'💳 Cartão', 'dinheiro':'💵 Dinheiro' };
const stepOrder = ['novo', 'preparando', 'entregando', 'entregue', 'finalizado'];

function updateTrackingHeader(status) {
  const headerEl = document.querySelector('#tracking-content > div:first-child');
  if (!headerEl) return;
  if (status === 'cancelado') {
    headerEl.querySelector('div:first-child').textContent = '❌';
    headerEl.querySelector('h2').textContent = 'Pedido Cancelado';
    headerEl.querySelector('h2').style.color = '#DC2626';
  } else {
    headerEl.querySelector('div:first-child').textContent = '🎉';
    headerEl.querySelector('h2').textContent = 'Pedido Confirmado!';
    headerEl.querySelector('h2').style.color = 'var(--purple-dark)';
  }
}

function updateTrackingUI(order) {
  if (!order) return;

  updateTrackingHeader(order.status);

  const timeline = document.getElementById('tracking-timeline');
  const confirmBtn = document.getElementById('btn-confirm-delivery');
  const cancelBtn = document.getElementById('btn-cancel-order');
  confirmBtn.classList.add('hidden');
  if (cancelBtn) cancelBtn.style.display = 'none';

  timeline.querySelectorAll('.tracking-step').forEach(s => {
    const step = s.dataset.step;
    s.classList.remove('active', 'done', 'cancelled');
    s.style.display = 'flex';

    if (order.status === 'cancelado') {
      if (step === 'cancelado') s.classList.add('active');
      else if (stepOrder.indexOf(step) <= stepOrder.indexOf('novo')) s.classList.add('done');
      else s.style.display = 'none';
    } else {
      if (step === 'cancelado') { s.style.display = 'none'; return; }
      const idx = stepOrder.indexOf(order.status);
      const stepIdx = stepOrder.indexOf(step);
      if (stepIdx >= 0 && stepIdx < idx) s.classList.add('done');
      if (step === order.status) s.classList.add('active');
    }
  });

  if (order.status === 'entregue') {
    confirmBtn.classList.remove('hidden');
  }

  if (order.status === 'novo' && cancelBtn) {
    cancelBtn.style.display = 'block';
  }

  if (order.status === 'finalizado' || order.status === 'entregue') {
    const entregueStep = timeline.querySelector('[data-step="finalizado"]');
    if (entregueStep && order.status === 'finalizado') {
      entregueStep.classList.add('active');
      document.querySelector('[data-step="entregue"]').classList.add('done');
    }
  }

  document.getElementById('tracking-total').textContent = `R$ ${parseFloat(order.total).toFixed(2).replace('.',',')}`;
}

async function cancelOrderFromTracking() {
  if (!currentTrackingId) return;
  if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
  try {
    await fetch(`${API_URL}/api/orders/${currentTrackingId}/cancel-customer`, { method: 'POST' });
    const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
    const idx = saved.findIndex(o => o.id === currentTrackingId);
    if (idx >= 0) {
      saved[idx].status = 'cancelado';
      localStorage.setItem('acaineiro_orders', JSON.stringify(saved));
    }
    document.getElementById('btn-cancel-order').style.display = 'none';
    updateTrackingUI({ id: currentTrackingId, status: 'cancelado' });
    alert('❌ Pedido cancelado!');
  } catch (e) {
    alert('Erro ao cancelar pedido.');
  }
}

async function confirmDelivery() {
  if (!currentTrackingId) return;
  try {
    const r = await fetch(`${API_URL}/api/orders/${currentTrackingId}/confirm`, { method: 'PUT' });
    const data = await r.json();
    document.getElementById('btn-confirm-delivery').classList.add('hidden');
    updateTrackingUI(data);
    const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
    const idx = saved.findIndex(o => o.id === currentTrackingId);
    if (idx >= 0) {
      saved[idx] = { ...saved[idx], ...data };
      localStorage.setItem('acaineiro_orders', JSON.stringify(saved));
    }
    if (data.loyaltyReward) {
      localStorage.setItem('acaineiro_last_reward', JSON.stringify(data.loyaltyReward));
      if (data.loyaltyReward.type === 'product') {
        alert(`🎉 Parabéns! Você completou ${data.loyaltyGoal || 10} pedidos e ganhou ${data.loyaltyReward.product_name} grátis! Confira na aba Cupons.`);
      } else {
        const rewardLabel = data.loyaltyReward.type === 'percent' ? `${data.loyaltyReward.value}% de desconto` : `R$ ${parseFloat(data.loyaltyReward.value).toFixed(2).replace('.',',')}`;
        alert(`🎉 Parabéns! Você completou ${data.loyaltyGoal || 10} pedidos e ganhou ${rewardLabel}! Código: ${data.loyaltyReward.code} - Confira na aba Cupons!`);
      }
    } else {
      alert('🎉 Obrigado! Pedido confirmado com sucesso!');
    }
    renderLoyalty();
  } catch (e) {
    alert('Erro ao confirmar entrega.');
  }
}

function loadMyOrders() {
  const el = document.getElementById('my-orders-list');
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');

  if (!saved.length) {
    el.innerHTML = '<p style="text-align:center;padding:40px;color:#888;">Nenhum pedido ainda</p>';
    return;
  }

  el.innerHTML = saved.map(o => {
    const active = ['preparando', 'entregando'].includes(o.status);
    return `
    <div class="order-history-card ${active ? 'active' : ''}">
      <div style="cursor:pointer" onclick="openTracking(${o.id})">
        <div class="order-history-header">
          <strong>Pedido #${o.id}</strong>
          <span class="order-status ${o.status}">${statusLabels[o.status] || o.status}</span>
        </div>
        <div class="order-history-items">
          ${o.items ? o.items.slice(0, 3).map(i => `${i.icon} ${i.qty}x ${i.name}${i.is_combo ? ' 🎯' : ''}`).join(', ') : ''}
          ${o.items && o.items.length > 3 ? ` e mais ${o.items.length - 3}` : ''}
        </div>
        <div class="order-history-footer">
          <span>Total: R$ ${(o.total || 0).toFixed(2).replace('.',',')}</span>
          <span style="font-size:12px;color:#888;">${new Date(o.created_at).toLocaleString('pt-BR')}</span>
        </div>
      </div>
      ${['finalizado','cancelado'].includes(o.status)
        ? `<button class="order-again-btn" onclick="event.stopPropagation(); repeatOrder(${o.id})">🔄 Pedir Novamente</button>`
        : `<button class="order-again-btn" onclick="event.stopPropagation(); openTracking(${o.id})" style="background:var(--purple-bg);color:var(--purple);">📦 Acompanhar Pedido</button>`
      }
    </div>`;
  }).join('');
}

function repeatOrder(orderId) {
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  const order = saved.find(o => o.id === orderId);
  if (!order || !order.items) return;

  order.items.forEach(item => {
    const product = allProducts.find(p => p.id === item.id);
    const price = product
      ? (product.has_promo && product.promo_price ? product.promo_price : product.price)
      : item.price;
    const icon = product ? (product.icon || '🥣') : (item.icon || '🥣');
    const name = product ? product.name : item.name;

    const existing = cart.find(x => x.id === item.id);
    if (existing) {
      existing.qty += item.qty;
    } else {
      cart.push({ id: item.id, name, price, icon, qty: item.qty });
    }
  });

  updateCartUI();
  animateCart();
  navigateTo('cart');
}

async function refreshSettings() {
  try { settings = await API.get('/api/settings'); } catch (e) {}
}

let currentPage = 'home';

function navigateTo(page) {
  currentPage = page;
  if (paymentInterval) { clearInterval(paymentInterval); paymentInterval = null; }
  if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const p = document.getElementById(`page-${page}`);
  if (p) p.classList.add('active');

  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (btn) btn.classList.add('active');

  if (page === 'menu') {
    refreshProducts();
  }
  if (page === 'promos') {
    refreshProducts().then(() => renderPromos());
  }
  if (page === 'home') {
    refreshProducts().then(() => {
      renderFeatured();
      renderTopProducts();
      renderCombos();
      renderFlashProducts();
      renderLoyalty();
      renderCupomDoDia();
      loadBanners();
    });
  }
  if (page === 'cupons') {
    renderCouponsPage();
  }
  if (page === 'cart' || page === 'account' || page === 'checkout') {
    refreshSettings().then(() => {
      if (page === 'checkout') {
        const cardEl = document.getElementById('payment-option-cartao');
        if (cardEl) {
          cardEl.style.display = settings.card_payment_enabled === '1' ? '' : 'none';
        }
      }
    });
  }
  if (page === 'account') {
    setTimeout(renderLoyalty, 300);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshProducts() {
  try {
    allProducts = await API.get('/api/products');
    renderProducts(currentCategory);
  } catch (e) {}
}

window.openWhatsApp = function() {
  const phone = settings.store_phone || '5531975785413';
  window.open(`https://wa.me/${phone}`, '_blank');
};

// Payment
let paymentInterval = null;
let pixTimerInterval = null;
const PIX_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function initPayment(orderId, method, total) {
  const el = document.getElementById('payment-content');
  el.innerHTML = '<p style="text-align:center;padding:40px;color:#888;">⏳ Gerando pagamento...</p>';

  try {
    const pay = await API.post(`/api/orders/${orderId}/pay`);

    if (method === 'pix') {
      const pixExpiry = Date.now() + PIX_TIMEOUT;
      document.getElementById('payment-title').textContent = '💠 Pagar com Pix';
      el.innerHTML = `
        <div style="text-align:center;padding:16px;">
          <p style="font-size:14px;color:var(--text-light);margin-bottom:16px;">
            Escaneie o QR Code abaixo para pagar</p>
          <div style="background:white;border-radius:12px;padding:16px;display:inline-block;box-shadow:var(--shadow);margin-bottom:16px;">
            <img src="data:image/png;base64,${pay.qr_code_base64}" style="width:220px;height:220px;display:block;">
          </div>
          <p style="font-size:13px;color:var(--text-light);margin-bottom:8px;">Total: <strong style="font-size:20px;color:var(--green-dark);">R$ ${total.toFixed(2).replace('.',',')}</strong></p>
          <p style="font-size:12px;color:#888;margin-bottom:12px;">Ou copie o código Pix abaixo:</p>
          <div style="background:rgba(255,255,255,0.5);border-radius:8px;padding:12px;font-size:11px;word-break:break-all;margin-bottom:12px;border:1px solid rgba(0,0,0,0.06);">
            ${pay.qr_code}
          </div>
          <button class="checkout-btn" style="background:var(--purple);box-shadow:0 4px 14px rgba(124,58,237,0.3);" onclick="navigator.clipboard.writeText('${pay.qr_code}');alert('Código Pix copiado!')">📋 Copiar Código</button>
          <div style="margin-top:16px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:4px;">
              <span>⏳ Tempo restante para pagar</span>
              <span id="pix-timer-display">05:00</span>
            </div>
            <div style="height:6px;background:rgba(0,0,0,0.06);border-radius:3px;overflow:hidden;">
              <div id="pix-progress-bar" style="height:100%;background:var(--purple);border-radius:3px;width:100%;transition:width 1s linear;"></div>
            </div>
          </div>
          <p style="font-size:12px;color:#888;margin-top:12px;">⏳ Aguardando confirmação do pagamento...</p>
        </div>
        <button class="checkout-btn" style="background:#888;" onclick="cancelPayment(${orderId})">Cancelar Pedido</button>
      `;

      // Pix countdown timer
      if (pixTimerInterval) clearInterval(pixTimerInterval);
      pixTimerInterval = setInterval(() => {
        const remaining = pixExpiry - Date.now();
        if (remaining <= 0) {
          clearInterval(pixTimerInterval);
          pixTimerInterval = null;
          cancelPayment(orderId);
          return;
        }
        const totalSec = Math.ceil(remaining / 1000);
        const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const sec = String(totalSec % 60).padStart(2, '0');
        const display = document.getElementById('pix-timer-display');
        const bar = document.getElementById('pix-progress-bar');
        if (display) display.textContent = `${min}:${sec}`;
        if (bar) bar.style.width = `${(remaining / PIX_TIMEOUT) * 100}%`;
      }, 1000);

      // Poll payment status
      paymentInterval = setInterval(async () => {
        try {
          const st = await fetch(`${API_URL}/api/orders/${orderId}/payment-status`).then(r => r.json());
          if (st.status === 'approved') {
            clearInterval(paymentInterval); paymentInterval = null;
            if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }
            await fetch(`${API_URL}/api/orders/${orderId}/confirm-payment`, {
              method:'POST', headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({})
            });
            openTracking(orderId);
          }
        } catch (e) {}
      }, 5000);
    } else {
      window.location.href = pay.init_point;
    }
  } catch (e) {
    el.innerHTML = `<p style="text-align:center;padding:40px;color:var(--red);">❌ Erro ao gerar pagamento: ${e.message}</p>
      <button class="checkout-btn" onclick="openTracking(${orderId})">Ir para Meus Pedidos</button>`;
  }
}

function cancelPayment(orderId) {
  if (paymentInterval) { clearInterval(paymentInterval); paymentInterval = null; }
  if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }
  fetch(`${API_URL}/api/orders/${orderId}/cancel-customer`, { method: 'POST' }).catch(() => {});
  openTracking(orderId);
}

// Account & Cards
let userToken = localStorage.getItem('acaineiro_token');
let userData = JSON.parse(localStorage.getItem('acaineiro_user') || 'null');
let mpInstance = null;

function getMp() {
  if (!window.MercadoPago) return null;
  if (!mpInstance && settings.mp_public_key) mpInstance = new MercadoPago(settings.mp_public_key);
  return mpInstance;
}

async function ensureMp() {
  if (window.MercadoPago && settings.mp_public_key) return getMp();
  if (!mpLoading) mpLoading = new Promise((resolve, reject) => {
    if (window.MercadoPago) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar SDK do Mercado Pago'));
    document.head.appendChild(s);
  });
  await mpLoading;
  await new Promise(r => { let i = setInterval(() => { if (settings.mp_public_key) { clearInterval(i); r(); } }, 100); });
  return getMp();
}

function toggleProfileEdit() {
  const el = document.getElementById('profile-edit-form');
  el.classList.toggle('hidden');
}

async function loadAccount() {
  if (!userToken) {
    document.getElementById('account-logged-out').style.display = 'block';
    document.getElementById('account-logged-in').style.display = 'none';
    return;
  }
  try {
    const user = await fetch(`${API_URL}/api/auth/me`, { headers: { 'x-user-token': userToken } }).then(r => r.json());
    if (user.error) throw new Error(user.error);
    userData = user;
    localStorage.setItem('acaineiro_user', JSON.stringify(user));
    document.getElementById('account-logged-out').style.display = 'none';
    document.getElementById('account-logged-in').style.display = 'block';
    document.getElementById('account-name').textContent = user.name;
    document.getElementById('account-phone').textContent = user.phone;
    const emailEl = document.getElementById('account-email');
    if (emailEl) emailEl.textContent = user.email || '—';
    // Fill profile edit form
    document.getElementById('prof-name').value = user.name || '';
    document.getElementById('prof-phone').value = user.phone || '';
    document.getElementById('prof-email').value = user.email || '';
    document.getElementById('prof-cpf').value = user.cpf || '';
    document.getElementById('prof-cep').value = user.cep || '';
    document.getElementById('prof-address_number').value = user.address_number || '';
    document.getElementById('prof-address').value = user.address || '';
    document.getElementById('prof-neighborhood').value = user.neighborhood || '';
  } catch (e) {
    userToken = null;
    localStorage.removeItem('acaineiro_token');
    localStorage.removeItem('acaineiro_user');
    loadAccount();
  }
}

async function saveProfile() {
  const data = {
    name: document.getElementById('prof-name').value.trim(),
    email: document.getElementById('prof-email').value.trim(),
    cpf: document.getElementById('prof-cpf').value.trim(),
    cep: document.getElementById('prof-cep').value.trim(),
    address_number: document.getElementById('prof-address_number').value.trim(),
    address: document.getElementById('prof-address').value.trim(),
    neighborhood: document.getElementById('prof-neighborhood').value.trim(),
  };
  if (!data.name) { alert('Nome é obrigatório'); return; }
  try {
    const r = await fetch(`${API_URL}/api/auth/profile`, {
      method:'PUT', headers:{'Content-Type':'application/json', 'x-user-token': userToken},
      body: JSON.stringify(data)
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    userData = { ...userData, ...data };
    localStorage.setItem('acaineiro_user', JSON.stringify(userData));
    document.getElementById('account-name').textContent = data.name;
    alert('✅ Dados salvos!');
  } catch (e) { alert('Erro: ' + e.message); }
}

async function loginUser() {
  const phone = document.getElementById('auth-phone').value.trim();
  const pass = document.getElementById('auth-pass').value.trim();
  const err = document.getElementById('auth-error');
  if (!phone || !pass) { err.textContent = 'Preencha telefone e senha'; err.style.display = 'block'; return; }
  try {
    const r = await fetch(`${API_URL}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone, password: pass }) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    userToken = r.auth_token;
    userData = r;
    localStorage.setItem('acaineiro_token', userToken);
    localStorage.setItem('acaineiro_user', JSON.stringify(userData));
    err.style.display = 'none';
    loadAccount();
    alert('✅ Bem-vindo!');
  } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
}

async function registerUser() {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const cpf = document.getElementById('reg-cpf').value.trim();
  const pass = document.getElementById('reg-pass').value.trim();
  const address = document.getElementById('reg-address').value.trim();
  const neighborhood = document.getElementById('reg-neighborhood').value.trim();
  const err = document.getElementById('auth-error');
  if (!name || !phone || !pass) { err.textContent = 'Nome, telefone e senha obrigatórios'; err.style.display = 'block'; return; }
  try {
    const r = await fetch(`${API_URL}/api/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, phone, email, cpf, password: pass, address, neighborhood }) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    userToken = r.auth_token;
    userData = r;
    localStorage.setItem('acaineiro_token', userToken);
    localStorage.setItem('acaineiro_user', JSON.stringify(userData));
    err.style.display = 'none';
    loadAccount();
    alert('✅ Conta criada!');
  } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
}

function logoutUser() {
  userToken = null; userData = null;
  localStorage.removeItem('acaineiro_token');
  localStorage.removeItem('acaineiro_user');
  loadAccount();
  alert('👋 Até logo!');
}


// ─── BACKGROUND SYNC ───
let syncTimestamps = {};
let backgroundSyncTimer = null;
let backgroundSyncing = false;

async function doBackgroundSync() {
  if (backgroundSyncing) return;
  backgroundSyncing = true;
  const page = currentPage;
  try {
    const ts = await API.get('/api/sync');

    // Settings changed ─ update fees, loyalty, cupom do dia
    if (ts.settings && ts.settings !== syncTimestamps.settings) {
      settings = await API.get('/api/settings');
      neighborhoodFees = await API.get('/api/neighborhood-fees').catch(() => []);
      if (page === 'home') {
        renderLoyalty();
        renderCupomDoDia();
      }
      if (page === 'checkout') {
        showCheckout();
      } else if (page === 'cart') {
        updateCartUI();
      }
    }

    // Products changed ─ update all product-dependent sections
    if (ts.products && ts.products !== syncTimestamps.products) {
      const newProducts = await API.get('/api/products');
      allProducts = newProducts;
      if (page === 'home') {
        renderFeatured();
        renderTopProducts();
        renderFlashProducts();
        renderCupomDoDia();
      }
      if (page === 'menu' || page === 'promos') {
        const scrollY = window.scrollY;
        renderProducts(currentCategory);
        if (page === 'promos') renderPromos();
        window.scrollTo(0, scrollY);
      }
    }

    // Banners changed
    if (ts.banners && ts.banners !== syncTimestamps.banners) {
      if (page === 'home') {
        loadBanners();
      }
    }

    // Coupons changed
    if (ts.coupons && ts.coupons !== syncTimestamps.coupons) {
      if (page === 'home') renderCupomDoDia();
      if (page === 'cupons') renderCouponsPage();
    }

    // Combos changed (skip if combo modal open)
    if (ts.combos && ts.combos !== syncTimestamps.combos) {
      if (page === 'home') {
        const modal = document.getElementById('combo-modal');
        if (modal && modal.classList.contains('hidden')) {
          renderCombos();
        }
      }
    }

    syncTimestamps = ts;
  } catch (e) {
    // silent background sync
  } finally {
    backgroundSyncing = false;
  }
}

function startBackgroundSync() {
  stopBackgroundSync();
  API.get('/api/sync').then(ts => { syncTimestamps = ts; }).catch(() => {});
  backgroundSyncTimer = setInterval(doBackgroundSync, 7000);
}

function stopBackgroundSync() {
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
  }
}

function refreshAllData() {
  if (currentTrackingId) connectSocket(currentTrackingId);
  if (currentPage === 'home') {
    loadBanners();
    refreshProducts().then(() => {
      renderFeatured();
      renderTopProducts();
      renderCombos();
      renderFlashProducts();
      renderLoyalty();
      renderCupomDoDia();
    });
  }
  if (currentPage === 'menu') refreshProducts();
  if (currentPage === 'cart' || currentPage === 'account' || currentPage === 'checkout') refreshSettings();
}

document.addEventListener('DOMContentLoaded', () => {
  loadApp();
  loadAccount();
  const saved = JSON.parse(localStorage.getItem('acaineiro_orders') || '[]');
  if (saved.length > 0) connectSocket();
  startBackgroundSync();

  // Check if returning from MP payment
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'ok') {
    const orderId = params.get('order');
    if (orderId) openTracking(parseInt(orderId));
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopBackgroundSync();
  } else {
    startBackgroundSync();
    refreshAllData();
  }
});
