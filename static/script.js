/* =========================================================
   YATRA SURAKSHA — APPLICATION SCRIPT
   Vanilla JS with integrated Flask + SQLite backend endpoints.
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. STATE
     --------------------------------------------------------- */

  const state = {
    userLocation: null,      // { lat, lng }
    dangerZones: [],         // loaded via loadDangerZones()
    nearestZone: null,       // { zone, distance }
    safetyState: 'safe',     // 'safe' | 'caution' | 'danger'
    contacts: [],            // loaded via loadContacts()
    map: null,
    userMarker: null,
    zoneLayers: [],
    notificationPermissionAsked: false
  };

  const CAUTION_BUFFER_METERS = 300; // extra ring outside a zone radius that counts as "approaching"
  const DEFAULT_CENTER = { lat: 28.6139, lng: 77.2090 }; // New Delhi, used before GPS is available

  /* ---------------------------------------------------------
     2. MOCK FALLBACK DANGER ZONE DATA
     --------------------------------------------------------- */

  const MOCK_DANGER_ZONES = [
    {
      id: 1,
      name: 'High Risk Zone',
      lat: 28.6139,
      lng: 77.2090,
      radius: 500,
      risk: 'high',
      description: 'Designated high-risk area.'
    },
    {
      id: 2,
      name: 'Caution Zone',
      lat: 28.6200,
      lng: 77.2150,
      radius: 700,
      risk: 'medium',
      description: 'Exercise additional caution in this area.'
    }
  ];

  /* ---------------------------------------------------------
     3. DOM REFERENCES
     --------------------------------------------------------- */

  const dom = {
    navbar: document.getElementById('navbar'),
    burgerBtn: document.getElementById('burgerBtn'),
    primaryNav: document.getElementById('primaryNav'),
    navLocateBtn: document.getElementById('navLocateBtn'),

    heroCheckSafety: document.getElementById('heroCheckSafety'),
    finalCtaBtn: document.getElementById('finalCtaBtn'),

    statusPanel: document.getElementById('statusPanel'),
    statusRingProgress: document.getElementById('statusRingProgress'),
    statusIcon: document.getElementById('statusIcon'),
    statusLabel: document.getElementById('statusLabel'),
    statusMessage: document.getElementById('statusMessage'),
    statusLocation: document.getElementById('statusLocation'),
    statusCoords: document.getElementById('statusCoords'),
    statusNearestZone: document.getElementById('statusNearestZone'),
    statusDistance: document.getElementById('statusDistance'),
    statusLocateBtn: document.getElementById('statusLocateBtn'),

    mapLocateBtn: document.getElementById('mapLocateBtn'),
    mapZoomInBtn: document.getElementById('mapZoomInBtn'),
    mapZoomOutBtn: document.getElementById('mapZoomOutBtn'),
    mapResetBtn: document.getElementById('mapResetBtn'),
    mapPanelStatus: document.getElementById('mapPanelStatus'),
    mapPanelLabel: document.getElementById('mapPanelLabel'),
    mapPanelMessage: document.getElementById('mapPanelMessage'),
    mapPanelZone: document.getElementById('mapPanelZone'),
    mapPanelDistance: document.getElementById('mapPanelDistance'),

    alertCard: document.getElementById('alertCard'),
    alertIcon: document.getElementById('alertIcon'),
    alertTitle: document.getElementById('alertTitle'),
    alertText: document.getElementById('alertText'),
    alertMeta: document.getElementById('alertMeta'),
    alertZoneName: document.getElementById('alertZoneName'),
    alertDistance: document.getElementById('alertDistance'),
    alertViewMapBtn: document.getElementById('alertViewMapBtn'),

    sosButton: document.getElementById('sosButton'),
    sosLocationPill: document.getElementById('sosLocationPill'),
    sosModalOverlay: document.getElementById('sosModalOverlay'),
    sosModalClose: document.getElementById('sosModalClose'),
    sosModalConfirmView: document.getElementById('sosModalConfirmView'),
    sosModalActiveView: document.getElementById('sosModalActiveView'),
    sosModalCoords: document.getElementById('sosModalCoords'),
    sosCancelBtn: document.getElementById('sosCancelBtn'),
    sosActivateBtn: document.getElementById('sosActivateBtn'),
    sosActiveCoords: document.getElementById('sosActiveCoords'),
    sosDoneBtn: document.getElementById('sosDoneBtn'),

    manageContactsBtn: document.getElementById('manageContactsBtn'),
    contactsModalOverlay: document.getElementById('contactsModalOverlay'),
    contactsModalClose: document.getElementById('contactsModalClose'),
    contactsList: document.getElementById('contactsList'),
    contactForm: document.getElementById('contactForm'),
    trustedContactName: document.getElementById('trustedContactName'),
    trustedContactDesc: document.getElementById('trustedContactDesc'),

    toastStack: document.getElementById('toastStack')
  };

  /* ---------------------------------------------------------
     4. TOASTS
     --------------------------------------------------------- */

  function showToast(message, type) {
    type = type || 'success';
    const toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    dom.toastStack.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () {
        toast.remove();
      }, 200);
    }, 3800);
  }

  /* ---------------------------------------------------------
     5. NAVBAR: MOBILE MENU + SMOOTH SCROLL ACTIVE STATE
     --------------------------------------------------------- */

  function toggleMobileMenu(forceState) {
    const isOpen = dom.primaryNav.classList.contains('is-open');
    const next = typeof forceState === 'boolean' ? forceState : !isOpen;
    dom.primaryNav.classList.toggle('is-open', next);
    dom.burgerBtn.setAttribute('aria-expanded', String(next));
    dom.burgerBtn.setAttribute('aria-label', next ? 'Close menu' : 'Open menu');
  }

  function initNavbar() {
    dom.burgerBtn.addEventListener('click', function () {
      toggleMobileMenu();
    });

    const navLinks = dom.primaryNav.querySelectorAll('.navbar__link');
    navLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        toggleMobileMenu(false);
        navLinks.forEach(function (l) { l.classList.remove('is-active'); });
        link.classList.add('is-active');
      });
    });

    const sections = Array.from(document.querySelectorAll('main section[id], main#home'));
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach(function (link) {
            const match = link.getAttribute('href') === '#' + id;
            link.classList.toggle('is-active', match);
          });
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ---------------------------------------------------------
     6. DISTANCE CALCULATION (HAVERSINE FORMULA)
     --------------------------------------------------------- */

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = function (deg) { return (deg * Math.PI) / 180; };

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // meters
  }

  function formatDistance(meters) {
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
  }

  /* ---------------------------------------------------------
     7. DANGER ZONES: LOAD + CHECK (API INTEGRATED)
     --------------------------------------------------------- */

  async function fetchDangerZones() {
    try {
      const response = await fetch('/api/danger-zones');
      if (!response.ok) throw new Error('Failed to fetch danger zones');
      return await response.json();
    } catch (error) {
      console.error('API Error, loading fallback mock zones:', error);
      return MOCK_DANGER_ZONES;
    }
  }

  async function loadDangerZones() {
    state.dangerZones = await fetchDangerZones();
    renderZonesOnMap();
    if (state.userLocation) {
      checkDangerZones();
    }
  }

  function checkDangerZones() {
    if (!state.userLocation || state.dangerZones.length === 0) {
      state.nearestZone = null;
      updateSafetyStatus('safe', null);
      return;
    }

    let nearest = null;

    state.dangerZones.forEach(function (zone) {
      const zLat = zone.lat || zone.latitude;
      const zLng = zone.lng || zone.longitude;

      const distance = calculateDistance(
        state.userLocation.lat,
        state.userLocation.lng,
        zLat,
        zLng
      );

      if (!nearest || distance < nearest.distance) {
        nearest = { zone: zone, distance: distance };
      }
    });

    state.nearestZone = nearest;

    if (!nearest) {
      updateSafetyStatus('safe', null);
      return;
    }

    const edgeDistance = nearest.distance - nearest.zone.radius;

    if (edgeDistance <= 0) {
      updateSafetyStatus('danger', nearest);
    } else if (edgeDistance <= CAUTION_BUFFER_METERS) {
      updateSafetyStatus('caution', nearest);
    } else {
      updateSafetyStatus('safe', nearest);
    }
  }

  /* ---------------------------------------------------------
     8. SAFETY STATUS UI
     --------------------------------------------------------- */

  function updateSafetyStatus(newState, nearest) {
    const previousState = state.safetyState;
    state.safetyState = newState;

    dom.statusPanel.setAttribute('data-state', newState);
    dom.alertCard.setAttribute('data-state', newState);

    const messages = {
      safe: 'You\'re currently outside known danger zones.',
      caution: 'You are approaching a designated caution zone.',
      danger: 'You have entered a designated high-risk area.'
    };

    const labels = { safe: 'SAFE', caution: 'CAUTION', danger: 'DANGER' };

    dom.statusLabel.textContent = labels[newState];
    dom.statusMessage.textContent = nearest && newState !== 'safe'
      ? messages[newState]
      : messages.safe;

    if (nearest) {
      dom.statusNearestZone.textContent = nearest.zone.name;
      dom.statusDistance.textContent = formatDistance(Math.max(nearest.distance - nearest.zone.radius, 0));
    } else {
      dom.statusNearestZone.textContent = 'No danger zones nearby';
      dom.statusDistance.textContent = '--';
    }

    const circumference = 2 * Math.PI * 88;
    const offsetByState = { safe: circumference * 0.06, caution: circumference * 0.32, danger: circumference * 0.7 };
    dom.statusRingProgress.style.strokeDasharray = String(circumference);
    dom.statusRingProgress.style.strokeDashoffset = String(circumference - offsetByState[newState]);

    dom.mapPanelStatus.setAttribute('data-state', newState);
    dom.mapPanelLabel.textContent = labels[newState];
    dom.mapPanelMessage.textContent = nearest && newState !== 'safe' ? messages[newState] : messages.safe;

    if (nearest) {
      dom.mapPanelZone.textContent = nearest.zone.name;
      dom.mapPanelDistance.textContent = formatDistance(Math.max(nearest.distance - nearest.zone.radius, 0));
    } else {
      dom.mapPanelZone.textContent = 'No danger zones nearby';
      dom.mapPanelDistance.textContent = '--';
    }

    const alertTitles = { safe: 'All clear', caution: 'Caution advised', danger: 'Danger zone entered' };
    const alertTexts = {
      safe: 'No danger zones nearby.',
      caution: 'You are approaching a designated caution zone.',
      danger: 'You have entered a designated high-risk area.'
    };

    dom.alertTitle.textContent = alertTitles[newState];
    dom.alertText.textContent = nearest ? alertTexts[newState] : alertTexts.safe;

    if (nearest && newState !== 'safe') {
      dom.alertMeta.hidden = false;
      dom.alertZoneName.textContent = nearest.zone.name;
      dom.alertDistance.textContent = formatDistance(Math.max(nearest.distance - nearest.zone.radius, 0)) + ' away';
      dom.alertViewMapBtn.hidden = false;
    } else {
      dom.alertMeta.hidden = true;
      dom.alertViewMapBtn.hidden = true;
    }

    if (newState !== previousState) {
      if (newState === 'danger') {
        showToast('You have entered a designated high-risk area.', 'danger');
        maybeSendBrowserNotification(
          'Danger zone entered',
          nearest ? nearest.zone.name + ' — leave the area and stay alert.' : 'Stay alert.'
        );
      } else if (newState === 'caution') {
        showToast('You are approaching a caution zone.', 'warning');
      } else if (previousState !== 'safe') {
        showToast('You are back in a safe area.', 'success');
      }
    }
  }

  function maybeSendBrowserNotification(title, body) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(title, { body: body });
      return;
    }

    if (Notification.permission !== 'denied' && !state.notificationPermissionAsked) {
      state.notificationPermissionAsked = true;
      Notification.requestPermission().then(function (permission) {
        if (permission === 'granted') {
          new Notification(title, { body: body });
        }
      });
    }
  }

  /* ---------------------------------------------------------
     9. GEOLOCATION
     --------------------------------------------------------- */

  function getUserLocation() {
    if (!('geolocation' in navigator)) {
      showToast('Geolocation is not supported by your browser.', 'warning');
      return;
    }

    dom.statusLocation.textContent = 'Locating…';

    navigator.geolocation.getCurrentPosition(
      onLocationSuccess,
      onLocationError,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function onLocationSuccess(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    state.userLocation = { lat: lat, lng: lng };

    dom.statusLocation.textContent = 'Location detected';
    dom.statusCoords.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);

    updateUserMarker(lat, lng);
    centerMapOn(lat, lng, 15);
    checkDangerZones();

    if (dom.sosLocationPill) dom.sosLocationPill.textContent = 'Location shared';

    showToast('Location updated.', 'success');
  }

  function onLocationError(error) {
    let message = 'Your location could not be determined.';

    if (error.code === error.PERMISSION_DENIED) {
      message = 'Location permission was denied. Please enable location access.';
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      message = 'Your location could not be determined.';
    } else if (error.code === error.TIMEOUT) {
      message = 'Location request timed out. Please try again.';
    }

    dom.statusLocation.textContent = message;
    showToast(message, 'warning');
  }

  /* ---------------------------------------------------------
     10. MAP (LEAFLET)
     --------------------------------------------------------- */

  function initMap() {
    if (typeof L === 'undefined') return;

    state.map = L.map('leafletMap', {
      zoomControl: false,
      attributionControl: true
    }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
  }

  function renderZonesOnMap() {
    if (!state.map) return;

    state.zoneLayers.forEach(function (layer) { state.map.removeLayer(layer); });
    state.zoneLayers = [];

    state.dangerZones.forEach(function (zone) {
      const zLat = zone.lat || zone.latitude;
      const zLng = zone.lng || zone.longitude;
      const isHigh = String(zone.risk).toLowerCase() === 'high';
      const color = isHigh ? '#D94A45' : '#D99A24';

      const circle = L.circle([zLat, zLng], {
        radius: zone.radius,
        color: color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.14
      }).addTo(state.map);

      circle.bindPopup(
        '<strong>' + escapeHtml(zone.name) + '</strong><br>' +
        escapeHtml(zone.description || '') + '<br>' +
        '<span style="color:' + color + ';font-weight:600;">' + escapeHtml(String(zone.risk).toUpperCase()) + ' RISK</span>'
      );

      state.zoneLayers.push(circle);
    });
  }

  function updateUserMarker(lat, lng) {
    if (!state.map) return;

    if (state.userMarker) {
      state.userMarker.setLatLng([lat, lng]);
      return;
    }

    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: '<span style="display:block;width:16px;height:16px;border-radius:50%;background:#2F7D5A;border:3px solid #fff;box-shadow:0 0 0 4px rgba(47,125,90,0.25);"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    state.userMarker = L.marker([lat, lng], { icon: userIcon, title: 'Your location' }).addTo(state.map);
    state.userMarker.bindPopup('You are here');
  }

  function centerMapOn(lat, lng, zoom) {
    if (!state.map) return;
    state.map.setView([lat, lng], zoom || state.map.getZoom());
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function initMapControls() {
    dom.mapLocateBtn.addEventListener('click', getUserLocation);

    dom.mapZoomInBtn.addEventListener('click', function () {
      if (state.map) state.map.zoomIn();
    });

    dom.mapZoomOutBtn.addEventListener('click', function () {
      if (state.map) state.map.zoomOut();
    });

    dom.mapResetBtn.addEventListener('click', function () {
      if (!state.map) return;
      if (state.userLocation) {
        state.map.setView([state.userLocation.lat, state.userLocation.lng], 13);
      } else {
        state.map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);
      }
    });

    dom.alertViewMapBtn.addEventListener('click', function () {
      document.getElementById('map').scrollIntoView({ behavior: 'smooth' });
      if (state.nearestZone && state.map) {
        const zLat = state.nearestZone.zone.lat || state.nearestZone.zone.latitude;
        const zLng = state.nearestZone.zone.lng || state.nearestZone.zone.longitude;
        centerMapOn(zLat, zLng, 15);
      }
    });
  }

  /* ---------------------------------------------------------
     11. SOS EMERGENCY FLOW (API INTEGRATED)
     --------------------------------------------------------- */

  function openModal(overlay) {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    const focusable = overlay.querySelector('button, input');
    if (focusable) focusable.focus();
  }

  function closeModal(overlay) {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  function initSos() {
    dom.sosButton.addEventListener('click', function () {
      dom.sosModalConfirmView.hidden = false;
      dom.sosModalActiveView.hidden = true;

      if (state.userLocation) {
        dom.sosModalCoords.textContent =
          state.userLocation.lat.toFixed(5) + ', ' + state.userLocation.lng.toFixed(5);
      } else {
        dom.sosModalCoords.textContent = 'Not available — location hasn\'t been shared yet';
      }

      openModal(dom.sosModalOverlay);
    });

    dom.sosCancelBtn.addEventListener('click', function () {
      closeModal(dom.sosModalOverlay);
    });

    dom.sosModalClose.addEventListener('click', function () {
      closeModal(dom.sosModalOverlay);
    });

    dom.sosActivateBtn.addEventListener('click', async function () {
      dom.sosActivateBtn.disabled = true;
      dom.sosActivateBtn.textContent = 'Activating…';

      await activateSOS(state.userLocation);

      dom.sosActivateBtn.disabled = false;
      dom.sosActivateBtn.textContent = 'Activate SOS';

      dom.sosModalConfirmView.hidden = true;
      dom.sosModalActiveView.hidden = false;

      dom.sosActiveCoords.textContent = state.userLocation
        ? state.userLocation.lat.toFixed(5) + ', ' + state.userLocation.lng.toFixed(5)
        : 'Not available';
    });

    dom.sosDoneBtn.addEventListener('click', function () {
      closeModal(dom.sosModalOverlay);
    });
  }

  async function sendSOS(location) {
    try {
      const response = await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: location ? location.lat : null,
          lng: location ? location.lng : null
        })
      });
      const data = await response.json();
      return { ok: response.ok, message: data.message };
    } catch (err) {
      console.error('Error triggering SOS:', err);
      return { ok: false, message: 'Could not connect to emergency server.' };
    }
  }

  async function activateSOS(location) {
    const result = await sendSOS(location);
    if (result.ok) {
      showToast(result.message || 'Emergency alert dispatched!', 'danger');
    } else {
      showToast(result.message, 'danger');
    }
    return result;
  }

  /* ---------------------------------------------------------
     12. EMERGENCY CONTACTS (API INTEGRATED)
     --------------------------------------------------------- */

  async function loadContacts() {
    try {
      const response = await fetch('/api/contacts');
      if (!response.ok) throw new Error('Failed to load contacts');
      state.contacts = await response.json();
    } catch (err) {
      console.error('Failed to load contacts from API:', err);
      state.contacts = [];
    }
    renderContacts();
  }

  async function saveContactToBackend(contactData) {
    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactData)
      });
      if (!response.ok) throw new Error('Failed to save contact');
      showToast('Contact added successfully!', 'success');
      await loadContacts();
    } catch (err) {
      console.error('Error saving contact:', err);
      showToast('Could not save contact.', 'warning');
    }
  }

  function renderContacts() {
    dom.contactsList.innerHTML = '';

    if (state.contacts.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'contacts-list__empty';
      empty.textContent = 'No contacts added yet. Add one below.';
      dom.contactsList.appendChild(empty);
    } else {
      state.contacts.forEach(function (contact) {
        const item = document.createElement('li');
        item.className = 'contacts-list__item';
        item.innerHTML =
          '<div class="contacts-list__info">' +
            '<div class="contacts-list__name">' + escapeHtml(contact.name) + '</div>' +
            '<div class="contacts-list__meta">' + escapeHtml(contact.relation) + ' · ' + escapeHtml(contact.phone) + '</div>' +
          '</div>';

        dom.contactsList.appendChild(item);
      });
    }

    if (state.contacts.length > 0) {
      const first = state.contacts[0];
      dom.trustedContactName.textContent = first.name;
      dom.trustedContactDesc.textContent = first.relation + ' · ' + first.phone;
    } else {
      dom.trustedContactName.textContent = 'Trusted Contact';
      dom.trustedContactDesc.textContent = 'Add someone close to you who should be notified first during an emergency.';
    }
  }

  function initContacts() {
    dom.manageContactsBtn.addEventListener('click', function () {
      openModal(dom.contactsModalOverlay);
    });

    dom.contactsModalClose.addEventListener('click', function () {
      closeModal(dom.contactsModalOverlay);
    });

    dom.contactForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      const formData = new FormData(dom.contactForm);
      const name = String(formData.get('name') || '').trim();
      const relation = String(formData.get('relation') || '').trim();
      const phone = String(formData.get('phone') || '').trim();

      if (!name || !relation || !phone) return;

      await saveContactToBackend({
        name: name,
        relation: relation,
        phone: phone
      });

      dom.contactForm.reset();
    });

    document.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-action');
        if (action === 'call-emergency') {
          showToast('Simulated call to Emergency Services.', 'success');
        } else if (action === 'call-ambulance') {
          showToast('Simulated call to Ambulance.', 'success');
        } else if (action === 'notify-trusted') {
          if (state.contacts.length === 0) {
            showToast('Add a trusted contact first.', 'warning');
            openModal(dom.contactsModalOverlay);
          } else {
            showToast('Notified ' + state.contacts[0].name + ' (simulated).', 'success');
          }
        }
      });
    });
  }

  /* ---------------------------------------------------------
     13. MODAL GLOBAL BEHAVIOR
     --------------------------------------------------------- */

  function initModalGlobalBehavior() {
    const overlays = [dom.sosModalOverlay, dom.contactsModalOverlay];

    overlays.forEach(function (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeModal(overlay);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      overlays.forEach(function (overlay) {
        if (!overlay.hidden) closeModal(overlay);
      });
    });
  }

  /* ---------------------------------------------------------
     14. HERO / CTA SHORTCUTS
     --------------------------------------------------------- */

  function initShortcuts() {
    [dom.heroCheckSafety, dom.finalCtaBtn, dom.statusLocateBtn, dom.navLocateBtn].forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('status').scrollIntoView({ behavior: 'smooth' });
        getUserLocation();
      });
    });
  }

  /* ---------------------------------------------------------
     15. NAVBAR SCROLL SHADOW
     --------------------------------------------------------- */

  function initNavbarScrollState() {
    let lastKnownScroll = 0;
    let ticking = false;

    window.addEventListener('scroll', function () {
      lastKnownScroll = window.scrollY;
      if (!ticking) {
        window.requestAnimationFrame(function () {
          dom.navbar.style.boxShadow = lastKnownScroll > 8 ? 'var(--shadow-sm)' : 'none';
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  /* ---------------------------------------------------------
     16. INIT
     --------------------------------------------------------- */

  function init() {
    initNavbar();
    initNavbarScrollState();
    initMap();
    initMapControls();
    initSos();
    initContacts();
    initModalGlobalBehavior();
    initShortcuts();

    loadDangerZones();
    loadContacts();
    updateSafetyStatus('safe', null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();