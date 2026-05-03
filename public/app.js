const API_BASE = "/app_api.php";
const SESSION_TIMEOUT_SEC = 60;

// ============================================================
// APP
// ============================================================
const app = {
  user: {
    telegramId: localStorage.getItem('telegram_id') || null,
    firstName:  localStorage.getItem('first_name')  || null,
  },
  dashboard: {},
  cards:     [],
  mapping:   { 1:null, 2:null, 3:null, 4:null, 5:null, 6:null, 7:null, 8:null },
  currentSlotSelection: null,

  _isChrome() {
    const ua = navigator.userAgent;
    const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua) && !/SamsungBrowser\//.test(ua);
    const hasBluetooth = !!navigator.bluetooth;
    return isChrome && hasBluetooth;
  },

  init() {
    // Verifica Chrome con Web Bluetooth prima di tutto
    if (!this._isChrome()) {
      this._showBrowserError();
      return;
    }
    if (this.user.telegramId) this.checkLicenseAndBoot();
    else this.showScreen('login-screen');
    document.getElementById('slot-picker').addEventListener('click', (e) => {
      if (e.target.id === 'slot-picker') this.hideSlotPicker();
    });
  },

  _showBrowserError() {
    // Mostra schermata di errore browser al posto del login
    document.body.innerHTML = `
      <div style="
        min-height:100vh; background:#111; display:flex; flex-direction:column;
        align-items:center; justify-content:center; text-align:center; padding:30px;
        font-family:-apple-system,sans-serif; color:white;">
        <div style="font-size:72px;margin-bottom:24px">🦊</div>
        <h1 style="font-size:22px;font-weight:900;margin-bottom:12px">Browser non supportato</h1>
        <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.7;max-width:320px;margin-bottom:32px">
          FoxSync richiede <strong>Google Chrome</strong> su Android per il supporto Bluetooth.<br><br>
          Apri questa pagina con Chrome e riprova.
        </p>
        <a href="https://play.google.com/store/apps/details?id=com.android.chrome"
           style="background:#FF9800;color:white;padding:14px 28px;border-radius:14px;
                  text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.5px">
          Scarica Google Chrome
        </a>
        <p style="color:rgba(255,255,255,0.35);font-size:12px;margin-top:24px">
          foxsync.cards
        </p>
      </div>`;
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  },

  togglePassword() {
    const i = document.getElementById('login-card');
    i.type = i.type === 'password' ? 'text' : 'password';
  },

  async apiCall(params) {
    const url = window.location.origin + API_BASE;
    const qs  = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const fullUrl = `${url}?${qs}`;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 15000);
      const res  = await fetch(fullUrl, { method:'GET', headers:{'Accept':'application/json'}, signal:ctrl.signal });
      clearTimeout(tid);
      const text = await res.text();
      console.log(`[API - ${params.action}] ${res.status}`, text.substring(0,120));
      if (!res.ok) throw new Error(`Server ${res.status}: ${text.substring(0,80)}`);
      if (!text.trim()) throw new Error('Risposta vuota.');
      try { return JSON.parse(text); }
      catch(e) {
        const fb=text.indexOf('{'), fb2=text.indexOf('[');
        let s=-1; if(fb!==-1&&fb2!==-1)s=Math.min(fb,fb2); else if(fb!==-1)s=fb; else if(fb2!==-1)s=fb2;
        if(s!==-1){const arr=text[s]==='[',e2=arr?text.lastIndexOf(']'):text.lastIndexOf('}');if(e2>s)return JSON.parse(text.substring(s,e2+1));}
        throw new Error(`JSON non valido: ${text.substring(0,100)}`);
      }
    } catch(e) { console.error(`[API ERROR ${params.action}]`, e); throw e; }
  },

  async checkLicenseAndBoot() {
    this.showScreen('auth-gate');
    try {
      const d = await this.apiCall({ action:'check_license', user_id:this.user.telegramId });
      if (d.access === false) {
        document.querySelector('.spinner').classList.add('hidden');
        document.getElementById('auth-denied-content').classList.remove('hidden');
        document.getElementById('auth-gate').classList.add('denied');
      } else this.loadDashboard();
    } catch(e) { this.loadDashboard(); }
  },

  async login() {
    const user  = document.getElementById('login-username').value.trim();
    const card  = document.getElementById('login-card').value.trim();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    if (!user || !card) { errEl.textContent='Compila tutti i campi.'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';
    try {
      const d = await this.apiCall({ action:'login', username:user, card_number:card });
      if (d.success) {
        this.user.telegramId = d.telegram_id.toString();
        this.user.firstName  = d.first_name.toString();
        localStorage.setItem('telegram_id', this.user.telegramId);
        localStorage.setItem('first_name',  this.user.firstName);
        this.loadDashboard();
      } else {
        errEl.textContent = d.error || 'Accesso negato.';
        errEl.classList.remove('hidden');
      }
    } catch(e) { errEl.textContent='Errore di rete.'; errEl.classList.remove('hidden'); }
    finally { btn.disabled=false; btn.textContent='ACCEDI AL SISTEMA'; }
  },

  logout() {
    localStorage.clear();
    this.user    = { telegramId:null, firstName:null };
    this.mapping = { 1:null,2:null,3:null,4:null,5:null,6:null,7:null,8:null };
    document.querySelector('.spinner').classList.remove('hidden');
    document.getElementById('auth-denied-content').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('denied');
    document.getElementById('login-username').value = '';
    document.getElementById('login-card').value     = '';
    this.showScreen('login-screen');
  },

  async loadDashboard() {
    this.showScreen('auth-gate');
    document.getElementById('dash-header-title').textContent = `FOXSYNC • ${this.user.firstName}`;
    try {
      const dashData  = await this.apiCall({ action:'get_dashboard', user_id:this.user.telegramId });
      const cardsData = await this.apiCall({ action:'get_slots',     user_id:this.user.telegramId });
      if (dashData.error)  throw new Error('DASHBOARD: '+dashData.error);
      if (cardsData.error) throw new Error('SLOTS: '+cardsData.error);
      this.dashboard = dashData;
      this.cards     = Array.isArray(cardsData) ? cardsData : [];
      this.renderDashboard();
      this.renderSlots();
      this.showScreen('dashboard-screen');
      this._initMiniMap();
      this._initCarousel();
      this._renderGestori();
      setTimeout(() => this._initPush(), 2000);
    } catch(e) { console.error(e); alert(`Errore:\n${e.message||'Connessione fallita.'}`); this.logout(); }
  },

  renderDashboard() {
    const bal=parseFloat(this.dashboard.saldo||0), isPrem=!!this.dashboard.is_premium, isLow=bal<2.0;
    document.getElementById('dash-balance-val').textContent   = bal.toFixed(2);
    document.getElementById('dash-karma-val').textContent     = this.dashboard.karma||'0';
    document.getElementById('dash-tariff-val').textContent    = this.dashboard.loyalty_level||'Standard';
    document.getElementById('dash-card').className = 'dashboard-card'+(isPrem?' premium':'')+(isLow?' low-balance':'');
    document.getElementById('dash-premium-badge').textContent = isPrem?'FOX PREMIUM CLUB':'UTENTE STANDARD';
    const w=document.getElementById('dash-warning'); if(isLow)w.classList.remove('hidden'); else w.classList.add('hidden');
    // Badge messaggi non letti (ultimi 7gg)
    const bcBadge = document.getElementById('broadcasts-badge');
    if (bcBadge) {
      const n = this.dashboard.unread_broadcasts || 0;
      if (n > 0) { bcBadge.textContent = n > 9 ? '9+' : n; bcBadge.classList.remove('hidden'); }
      else bcBadge.classList.add('hidden');
    }
    const mn=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    document.getElementById('stats-month').textContent = mn[new Date().getMonth()];
    if (this.dashboard.monthly_stats) {
      document.getElementById('stat-energy').textContent    = `${this.dashboard.monthly_stats.energy_kwh||'0.00'} kWh`;
      document.getElementById('stat-spent').textContent     = `€ ${this.dashboard.monthly_stats.spent_eur||'0.00'}`;
      document.getElementById('stat-recharged').textContent = `€ ${this.dashboard.monthly_stats.recharged_eur||'0.00'}`;
    }
  },

  renderSlots() {
    // Popola solo la connect-screen (la dashboard ha solo il pulsante Collega)
    let canSync=false;
    const list=document.getElementById('connect-slot-list');
    if (list) {
      list.innerHTML='';
      const SLOTS = [1, 5, 8]; // slot fisici supportati V1/V2/V3/V4
      for (const i of SLOTS) {
        const card=this.mapping[i]; if(card)canSync=true;
        const div=document.createElement('div');
        div.className=`slot-card ${card?'active':''}`;
        div.onclick=()=>this.openSlotPicker(i);
        div.innerHTML=`<div class="slot-num">${i}</div><div class="slot-title">${card?card.slot_label:'Slot libero'}</div><div class="slot-icon">📝</div>`;
        list.appendChild(div);
      }
    }
    const syncBtn=document.getElementById('connect-proceed-btn');
    if (syncBtn) { if(canSync)syncBtn.classList.remove('hidden'); else syncBtn.classList.add('hidden'); }
  },

  openSlotPicker(slotNum) {
    this.currentSlotSelection=slotNum;
    const list=document.getElementById('slot-picker-list');
    list.innerHTML=`<div class="sheet-item clear" onclick="app.selectCardForSlot(null)"><div style="font-size:24px">🚫</div><div class="sheet-item-title">Svuota / Lascia vuoto</div></div>`;
    this.cards.forEach(card=>{
      const div=document.createElement('div'); div.className='sheet-item'; div.onclick=()=>this.selectCardForSlot(card);

      // Badge promo
      const promoBadge = card.is_promo ? `<span class="slot-promo-badge">PROMO</span>` : '';

      // Chip roaming: usati (verdi + conteggio) e forzati (grigi)
      const roaming = card.roaming_detail || [];
      let opsHtml = '';
      if (roaming.length) {
        const chips = roaming.slice(0,5).map(r => {
          const n   = parseInt(r.usage_count)||0;
          const cls = n > 0 ? 'roaming-chip used' : 'roaming-chip';
          const cnt = n > 0 ? `<span class="roaming-count">${n}</span>` : '';
          return `<span class="${cls}">${this._esc(r.operator_name)}${cnt}</span>`;
        });
        const more = roaming.length > 5 ? `<span class="roaming-chip more">+${roaming.length-5}</span>` : '';
        opsHtml = `<div class="slot-roaming-row">${chips.join('')}${more}</div>`;
      }

      div.innerHTML=`
        <div style="font-size:22px;color:var(--primary-orange);flex-shrink:0">💳</div>
        <div style="flex:1;min-width:0">
          <div class="sheet-item-title">${this._esc(card.slot_label)}${promoBadge}</div>
          ${opsHtml}
        </div>`;
      list.appendChild(div);
    });
    document.getElementById('slot-picker').classList.remove('hidden');
  },

  hideSlotPicker() { document.getElementById('slot-picker').classList.add('hidden'); },

  selectCardForSlot(card) {
    if (this.currentSlotSelection) { this.mapping[this.currentSlotSelection]=card; this.renderSlots(); }
    this.hideSlotPicker();
  },

  // ── HELPERS ──
  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d=new Date(dateStr), ms=Date.now()-d;
      const min=Math.floor(ms/60000), h=Math.floor(ms/3600000), day=Math.floor(ms/86400000);
      if (min<1) return 'Adesso';
      if (min<60) return `${min} min fa`;
      if (h<24)   return `${h}h fa`;
      if (day<7)  return `${day}g fa`;
      return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'});
    } catch(e) { return dateStr; }
  },
  _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  // _bleLog → definito in bleEngine


  _opColor(name) {
    const PALS=[
      {bg:'rgba(30,136,229,0.22)',fg:'#90CAF9',border:'rgba(100,181,246,0.35)'},
      {bg:'rgba(0,137,123,0.22)',fg:'#80CBC4',border:'rgba(77,182,172,0.35)'},
      {bg:'rgba(142,36,170,0.22)',fg:'#CE93D8',border:'rgba(206,147,216,0.35)'},
      {bg:'rgba(244,81,30,0.22)',fg:'#FFAB91',border:'rgba(255,138,101,0.35)'},
      {bg:'rgba(2,119,189,0.22)',fg:'#81D4FA',border:'rgba(129,212,250,0.35)'},
      {bg:'rgba(27,94,32,0.22)',fg:'#A5D6A7',border:'rgba(129,199,132,0.35)'},
      {bg:'rgba(183,28,28,0.22)',fg:'#EF9A9A',border:'rgba(239,154,154,0.35)'},
      {bg:'rgba(230,81,0,0.22)',fg:'#FFCC80',border:'rgba(255,204,128,0.35)'},
      {bg:'rgba(106,27,154,0.22)',fg:'#B39DDB',border:'rgba(179,157,219,0.35)'},
      {bg:'rgba(0,96,100,0.22)',fg:'#80DEEA',border:'rgba(128,222,234,0.35)'},
    ];
    const GRADS=[
      'linear-gradient(135deg,#1565C0,#1E88E5)',
      'linear-gradient(135deg,#00695C,#00897B)',
      'linear-gradient(135deg,#6A1B9A,#8E24AA)',
      'linear-gradient(135deg,#E65100,#F4511E)',
      'linear-gradient(135deg,#B71C1C,#E53935)',
      'linear-gradient(135deg,#0277BD,#039BE5)',
      'linear-gradient(135deg,#1B5E20,#388E3C)',
      'linear-gradient(135deg,#880E4F,#C2185B)',
      'linear-gradient(135deg,#006064,#00838F)',
      'linear-gradient(135deg,#4A148C,#7B1FA2)',
    ];
    let h=0; for(let i=0;i<name.length;i++) h=(Math.imul(31,h)+name.charCodeAt(i))|0;
    const i=Math.abs(h)%PALS.length;
    return {pill:PALS[i],grad:GRADS[i]};
  },

  _opInitials(name) {
    const MAP={'enel x':'EX','enelx':'EX','enel x way':'EW','plenitude':'PL',
      'be charge':'BC','becharge':'BC','atlante':'AT','free to x':'F2','f2x':'F2',
      'free2x':'F2','ionity':'IO','a2a':'A2','ewiva':'EW','tesla':'TS',
      'fastned':'FN','repower':'RP','electra':'EC','electrip':'EP',
      'duferco':'DF','allego':'AL','acea':'AC','neogy':'NG','powy':'PW'};
    const key=name.toLowerCase().trim();
    if(MAP[key]) return MAP[key];
    const parts=key.replace(/[^a-z0-9 ]/g,'').trim().split(' ').filter(Boolean);
    if(parts.length>=2) return (parts[0][0]+(parts[1][0]||'')).toUpperCase();
    return parts[0].slice(0,2).toUpperCase();
  },

  // ── WEB PUSH NOTIFICATIONS ──
  async _initPush() {
    // Controlla supporto browser
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[PUSH] Non supportato su questo browser/dispositivo');
      return;
    }

    // Su iOS: funziona solo se installata come PWA (standalone)
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !window.navigator.standalone) {
      console.log('[PUSH] iOS: aggiungi alla schermata Home per le notifiche');
      return;
    }

    // Controlla permesso attuale
    if (Notification.permission === 'denied') return;

    try {
      const reg = await navigator.serviceWorker.ready;

      // Già iscritto?
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        // Chiedi permesso e iscrivi
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // Recupera VAPID public key dal server
        const res = await this.apiCall({ action: 'get_vapid_key', user_id: this.user.telegramId });
        const vapidKey = res?.vapid_public_key;
        if (!vapidKey) return;

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlBase64ToUint8Array(vapidKey),
        });
      }

      // Invia/aggiorna subscription al server
      const subJson = sub.toJSON();
      await fetch('app_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action:   'save_push_subscription',
          user_id:  this.user.telegramId,
          endpoint: subJson.endpoint,
          p256dh:   subJson.keys.p256dh,
          auth:     subJson.keys.auth,
        }),
      });
      console.log('[PUSH] Subscription salvata');
    } catch(e) {
      console.warn('[PUSH] Errore iscrizione:', e.message);
    }
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  },

  // ── MAPPA COLONNINE OCM CON FUZZY MATCHING DAL BACKEND ──
  async showMap() {
    app.showScreen('map-screen');
    const mapLoading = document.getElementById('map-loading');
    
    // Inizializza mappa Leaflet (una sola volta)
    if (!this._map) {
      this._map = L.map('leaflet-map', { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 18,
      }).addTo(this._map);

      // Aggiungi listener per caricamento colonnine allo spostamento/zoom
      this._map.on('moveend', () => {
        // Se non abbiamo ancora fatto il fix iniziale, ignoriamo
        if (!this._initialFixDone) return;
        
        // Debounce per evitare troppe chiamate API
        clearTimeout(this._mapMoveTimeout);
        this._mapMoveTimeout = setTimeout(() => {
           this._fetchStationsForMap();
        }, 500);
      });
    }
    
    // Inizializza Mini-Mappa Dashboard
    if (!this._miniMap) {
      this._miniMap = L.map('dash-mini-map', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 18,
      }).addTo(this._miniMap);
    }
    
    setTimeout(() => this._map.invalidateSize(), 100);

    // Eseguiamo il fix GPS la prima volta, o se richiesto
    if (!this._initialFixDone) {
      this.centerMapOnUser();
    }
  },

  centerMapOnUser() {
    const mapLoading = document.getElementById('map-loading');
    const mapLoadingText = document.getElementById('map-loading-text');
    mapLoading.style.display = 'flex';
    mapLoadingText.textContent = 'Rilevamento posizione...';

    if (!navigator.geolocation) {
      mapLoadingText.textContent = 'GPS non disponibile';
      setTimeout(() => { mapLoading.style.display = 'none'; }, 2000);
      // Se non abbiamo GPS, usiamo una posizione di default per permettere l'uso
      this._initialFixDone = true;
      this._map.setView([41.9028, 12.4964], 14); // Roma
      this._fetchStationsForMap();
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      this._initialFixDone = true;
      // Centra mappa principale sull'utente
      this._map.setView([lat, lng], 14);
      // Aggiorna anche mini mappa
      this._miniMap.setView([lat, lng], 14);

      if (this._userMarker) this._userMarker.remove();
      this._userMarker = L.circleMarker([lat, lng], {
        radius: 10, fillColor: '#FF9800', color: '#fff',
        weight: 3, opacity: 1, fillOpacity: 1,
      }).addTo(this._map).bindPopup('📍 Sei qui');
      
      if (this._miniUserMarker) this._miniUserMarker.remove();
      this._miniUserMarker = L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#FF9800', color: '#fff',
        weight: 2, opacity: 1, fillOpacity: 1,
      }).addTo(this._miniMap);
      
      mapLoading.style.display = 'none';
      this._fetchStationsForMap();

    }, (err) => {
      let errorText = 'Errore GPS';
      switch(err.code) {
        case err.PERMISSION_DENIED:
          errorText = 'Permesso GPS negato';
          break;
        case err.POSITION_UNAVAILABLE:
          errorText = 'Posizione non disponibile';
          break;
        case err.TIMEOUT:
          errorText = 'Timeout GPS. Riprova.';
          break;
      }
      document.getElementById('map-loading-text').textContent = errorText;
      setTimeout(() => { document.getElementById('map-loading').style.display = 'none'; }, 2000);
      
      // Fallback
      if(!this._initialFixDone) {
        this._initialFixDone = true;
        this._map.setView([41.9028, 12.4964], 14);
        this._fetchStationsForMap();
      }
    }, { timeout: 10000, enableHighAccuracy: false });
  },

  async _fetchStationsForMap() {
    if (!this._map) return;
    
    // Calcoliamo il centro e il raggio approssimativo in base ai bounds visibili
    const center = this._map.getCenter();
    const bounds = this._map.getBounds();
    // Distanza in km dal centro all'angolo nord-est (approssimazione del raggio visibile)
    const radiusMeters = center.distanceTo(bounds.getNorthEast());
    // Convertiamo in km, con un minimo di 1km e massimo di 50km
    let radiusKm = Math.min(Math.max(radiusMeters / 1000, 1), 50);

    try {
      // Potremmo mostrare uno spinner leggero qui se vogliamo
      const resp = await this.apiCall({
        action: 'get_map_pois',
        lat: center.lat,
        lng: center.lng,
        radius: radiusKm,
        user_id: this.user.telegramId
      });

      if (resp.error) throw new Error(resp.error);

      // Rimuovi marker colonnine precedenti
      if (this._stationMarkers) this._stationMarkers.forEach(m => m.remove());
      this._stationMarkers = [];
      
      if (this._miniStationMarkers) this._miniStationMarkers.forEach(m => m.remove());
      this._miniStationMarkers = [];

      (resp.pois || []).forEach(poi => {
        const color = poi.is_supported ? '#4CAF50' : '#9E9E9E';
        const icon  = poi.is_supported ? '⚡' : '🔌';

        // Marker per mappa principale
        const marker = L.circleMarker([poi.lat, poi.lng], {
          radius: poi.is_supported ? 10 : 7,
          fillColor: color, color: '#fff',
          weight: 2, opacity: 1, fillOpacity: 0.9,
        }).addTo(this._map);

        // Marker per mini mappa
        const miniMarker = L.circleMarker([poi.lat, poi.lng], {
          radius: poi.is_supported ? 5 : 3,
          fillColor: color, color: 'transparent',
          weight: 0, opacity: 1, fillOpacity: 0.6,
        }).addTo(this._miniMap);

        let popupHtml = `<div style="min-width:180px;font-family:sans-serif">`;
        popupHtml += `<b style="font-size:13px">${icon} ${this._esc(poi.title)}</b>`;
        const opDisplay = poi.operator || '';
        if (opDisplay) {
            popupHtml += `<div style="margin-top:4px;font-size:12px;font-weight:600;color:#FF9800;">${this._esc(opDisplay)}</div>`;
        }
        
        const connDisplay = poi.connections_info || 'Info prese non disponibili';
        popupHtml += `<div style="margin-top:4px;font-size:12px;color:#ccc;">🔌 ${this._esc(connDisplay)}</div>`;
        
        if (poi.is_supported) {
          popupHtml += `<div style="margin-top:8px;padding:6px 8px;background:rgba(76, 175, 80, 0.15);border: 1px solid rgba(76, 175, 80, 0.3);border-radius:6px;font-size:12px;color:#000;">`;
          popupHtml += `<b style="color:#4CAF50">✅ Usa queste tessere:</b><br>`;
          (poi.matched_slots || []).forEach(c => { popupHtml += `• ${this._esc(c)}<br>`; });
          popupHtml += `</div>`;
        } else {
          popupHtml += `<div style="margin-top:6px;font-size:11px;color:#999">Operatore non verificato nelle tue tessere</div>`;
        }
        popupHtml += `</div>`;

        marker.bindPopup(popupHtml);
        this._stationMarkers.push(marker);
        this._miniStationMarkers.push(miniMarker);
      });
      
    } catch(e) {
      console.error('[MAP FETCH]', e);
    }
  },

  // ── MINI MAPPA DASHBOARD ──
  _initMiniMap() {
    if (!this._miniMap) {
      this._miniMap = L.map('dash-mini-map', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 18,
      }).addTo(this._miniMap);
    }
    
    // Centra temporaneamente su Roma e usa IP geolocation se disponibile, per evitare richieste GPS premature.
    this._miniMap.setView([41.9028, 12.4964], 6);
    fetch('https://get.geojs.io/v1/ip/geo.json')
      .then(r => r.json())
      .then(geo => {
        if (geo && geo.latitude && geo.longitude) {
          this._miniMap.setView([parseFloat(geo.latitude), parseFloat(geo.longitude)], 12);
        }
      }).catch(e => console.log('IP geoloc failed', e));
    
    // Invalida size in caso fosse nascosta durante l'init
    setTimeout(() => this._miniMap.invalidateSize(), 100);
  },

  // ── CAROSELLO ──
  _initCarousel() {
    const carousel = document.getElementById('how-to-carousel');
    const dots     = document.querySelectorAll('.how-to-dot');
    if (!carousel || !dots.length) return;
    let current = 0;
    const total = carousel.querySelectorAll('.how-to-slide').length;
    const update = (idx) => {
      current = (idx + total) % total;
      carousel.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d,i) => d.classList.toggle('active', i===current));
    };
    carousel.addEventListener('touchstart', e => { this._swipeX = e.touches[0].clientX; }, {passive:true});
    carousel.addEventListener('touchend',   e => {
      const dx = e.changedTouches[0].clientX - (this._swipeX||0);
      if (Math.abs(dx) > 40) update(current + (dx < 0 ? 1 : -1));
    }, {passive:true});
    dots.forEach((d,i) => d.addEventListener('click', () => update(i)));
    if (this._carouselTimer) clearInterval(this._carouselTimer);
    this._carouselTimer = setInterval(() => update(current+1), 4000);
  },

  // ── PROFILO ──
  async showProfile() {
    app.showScreen('profile-screen');
    const cont = document.getElementById('profile-content');
    cont.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_profile', user_id:this.user.telegramId });
      this._renderProfile(cont, d);
    } catch(e) {
      cont.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  _renderProfile(cont, d) {
    const isPremium = !!d.is_premium;
    const saldo     = parseFloat(d.saldo_kwh||0).toFixed(2);
    const since     = d.member_since
      ? new Date(d.member_since).toLocaleDateString('it-IT',{month:'long',year:'numeric'}) : '';

    // Card premium o standard
    let premiumHtml = '';
    if (isPremium && d.premium_expires) {
      const exp     = new Date(d.premium_expires);
      const days    = Math.max(0, Math.round((exp-Date.now())/86400000));
      const expStr  = exp.toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'});
      const urgCls  = days<=7 ? 'prem-expiry-urgent' : days<=30 ? 'prem-expiry-warn' : '';
      premiumHtml = `
        <div class="premium-card">
          <div class="premium-card-top">
            <div class="premium-star">⭐</div>
            <div style="flex:1">
              <div class="premium-title">FOX PREMIUM CLUB</div>
              <div class="premium-level">Membro attivo</div>
            </div>
            <div class="premium-days ${urgCls}">
              <div class="premium-days-num">${days}</div>
              <div class="premium-days-lbl">giorni</div>
            </div>
          </div>
          <div class="premium-expiry ${urgCls}">
            ${days<=7?'⚠️ ':'📅 '}Scade il ${expStr}
          </div>
        </div>`;
    } else {
      premiumHtml = `<div class="profile-level-badge">🦊 Fox Standard</div>`;
    }

    cont.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar ${isPremium?'premium':''}">${(d.first_name||'?')[0].toUpperCase()}</div>
        <div class="profile-name">${this._esc(d.first_name)} ${this._esc(d.last_name||'')}</div>
        ${d.username?`<div class="profile-username">@${this._esc(d.username)}</div>`:''}
        ${since?`<div class="profile-since">Membro da ${since}</div>`:''}
      </div>

      ${premiumHtml}

      <div class="profile-stats-row">
        <div class="profile-stat">
          <div class="profile-stat-val">€ ${saldo}</div>
          <div class="profile-stat-lbl">Saldo wallet</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-val">${d.trust_score||0}</div>
          <div class="profile-stat-lbl">Karma</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-val">${d.totals?.sessioni||0}</div>
          <div class="profile-stat-lbl">Sessioni</div>
        </div>
      </div>

      <div class="profile-section-title">📊 Totale lifetime</div>
      <div class="profile-lifetime">
        <div class="lifetime-item">
          <span class="lifetime-lbl">Energia usata</span>
          <span class="lifetime-val">${parseFloat(d.totals?.kwh_total||0).toFixed(2)} kWh</span>
        </div>
        <div class="lifetime-item">
          <span class="lifetime-lbl">Importo totale</span>
          <span class="lifetime-val">€ ${parseFloat(d.totals?.eur_total||0).toFixed(2)}</span>
        </div>
      </div>

      ${d.tariffe?.length ? `
      <div class="profile-section-title">⚡ Tariffe applicate</div>
      <div class="profile-tariffe">
        ${d.tariffe.map(t=>`
          <div class="tariffa-card">
            <div class="tariffa-price">€ ${parseFloat(t.tariffa_eur_kwh).toFixed(4)}<span>/kWh</span></div>
            <div class="tariffa-info">
              <div class="tariffa-desc">${this._esc(t.service_description||t.level_name)}</div>
              <div class="tariffa-orario">${t.start_time?.slice(0,5)||'00:00'}–${t.end_time?.slice(0,5)||'23:59'}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    `;
  },

  // ── STORICO ──
  async showHistory() {
    app.showScreen('history-screen');
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_history', user_id:this.user.telegramId, limit:20 });
      this._renderHistory(list, d);
    } catch(e) {
      list.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  _renderHistory(list, d) {
    const txs  = d.transactions||[];
    const recs = d.recharges||[];
    if (!txs.length && !recs.length) {
      list.innerHTML = '<div class="empty-state">📋<br>Nessuna transazione</div>'; return;
    }
    const stInfo = {
      'CONFIRMED':   {icon:'✅',label:'Confermata',  cls:'s-confirmed'},
      'PENDING':     {icon:'⏳',label:'In attesa',   cls:'s-pending'},
      'IN PROGRESS': {icon:'🔄',label:'In corso',    cls:'s-progress'},
      'REJECTED':    {icon:'❌',label:'Rifiutata',   cls:'s-rejected'},
    };
    let html = '';
    if (txs.length) {
      html += '<div class="history-section-title">⚡ Dichiarazioni di Consumo</div>';
      html += txs.map(t=>{
        const st  = stInfo[t.status]||{icon:'❓',label:t.status,cls:'s-pending'};
        return `<div class="history-card tx-card">
          <div class="tx-status-bar ${st.cls}"></div>
          <div class="tx-body">
            <div class="tx-top">
              <div class="tx-kwh">${parseFloat(t.kwh||0).toFixed(3)} <span>kWh</span></div>
              <div class="tx-eur">€ ${parseFloat(t.importo_eur||0).toFixed(2)}</div>
            </div>
            <div class="tx-details">
              ${t.slot_label?`<span class="tx-tag tag-slot">📍 ${this._esc(t.slot_label)}</span>`:''}
              ${t.operator_name?`<span class="tx-tag tag-op">🔌 ${this._esc(t.operator_name)}</span>`:''}
              ${t.service_description?`<span class="tx-tag tag-svc">⚡ ${this._esc(t.service_description)}</span>`:''}
            </div>
            ${t.note?`<div class="tx-note">💬 ${this._esc(t.note)}</div>`:''}
            <div class="tx-footer">
              <span class="tx-status-badge ${st.cls}">${st.icon} ${st.label}</span>
              <span class="tx-date">${this._formatDate(t.created_at)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }
    if (recs.length) {
      html += '<div class="history-section-title">💳 Ricariche Wallet</div>';
      html += recs.map(r=>{
        const st = stInfo[r.status]||{icon:'❓',label:r.status,cls:'s-pending'};
        return `<div class="history-card tx-card">
          <div class="tx-status-bar s-confirmed"></div>
          <div class="tx-body">
            <div class="tx-top">
              <div class="tx-kwh" style="color:#4CAF50">+ € ${parseFloat(r.importo_eur||0).toFixed(2)}</div>
              <div class="tx-eur" style="color:#4CAF50">→ € ${parseFloat(r.total_credited||r.importo_eur||0).toFixed(2)}</div>
            </div>
            <div class="tx-details">
              ${r.method?`<span class="tx-tag tag-op">💳 ${this._esc(r.method)}</span>`:''}
              ${r.bonus_percent>0?`<span class="tx-tag tag-svc">🎁 Bonus +${r.bonus_percent}%</span>`:''}
            </div>
            ${r.note?`<div class="tx-note">💬 ${this._esc(r.note)}</div>`:''}
            <div class="tx-footer">
              <span class="tx-status-badge ${st.cls}">${st.icon} ${st.label}</span>
              <span class="tx-date">${this._formatDate(r.created_at)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }
    list.innerHTML = html;
  },

  // ── MESSAGGI ADMIN ──
  async showBroadcasts() {
    app.showScreen('broadcasts-screen');
    const list = document.getElementById('broadcasts-list');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_broadcasts', user_id:this.user.telegramId });
      const msgs = d.broadcasts||[];
      if (!msgs.length) { list.innerHTML='<div class="empty-state">📭<br>Nessun messaggio</div>'; return; }
      const typeIcon = {info:'ℹ️',warning:'⚠️',alert:'🚨',promo:'🎁',update:'🔄'};
      list.innerHTML = msgs.map(m=>`
        <div class="bc-card">
          <div class="bc-icon">${typeIcon[m.msg_type]||'📢'}</div>
          <div class="bc-body">
            ${m.custom_subject?`<div class="bc-subject">${this._esc(m.custom_subject)}</div>`:''}
            <div class="bc-text">${this._esc(m.message)}</div>
            <div class="bc-date">${this._formatDate(m.scheduled_at)}</div>
          </div>
        </div>`).join('');
    } catch(e) {
      list.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  // PASSO 1: utente clicca "Collega e Configura"
  // Avvia connessione BLE, legge stato slot, mostra dashboard con slot attuali
  startConnectFlow() {
    if (!navigator.bluetooth) { alert('Web Bluetooth non supportato.\nUsa Chrome su Android.'); return; }

    // Verifica connessione internet
    if (!navigator.onLine) {
      alert('⚠️ Nessuna connessione internet.\n\nFoxSync richiede internet attivo per registrare la sessione e garantire la sicurezza.\nConnettiti e riprova.');
      return;
    }

    // Richiedi geolocalizzazione (silente, non bloccante)
    this._pendingGeoLocation = null;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          this._pendingGeoLocation = {
            lat: pos.coords.latitude.toFixed(6),
            lng: pos.coords.longitude.toFixed(6),
            acc: Math.round(pos.coords.accuracy),
          };
        },
        () => { this._pendingGeoLocation = null; }, // negato o non disponibile: procede comunque
        { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false }
      );
    }

    this.showScreen('connect-screen');
    bleEngine.connectAndRead(this.user.telegramId);
  },

  // PASSO 2: dopo connessione → utente seleziona slot → clicca Sincronizza
  startSyncFlow() {
    document.getElementById('sync-dialog').classList.remove('hidden');
  },

  hideDialog() { document.getElementById('sync-dialog').classList.add('hidden'); },

  confirmSync() {
    this.hideDialog();
    this.showScreen('sync-screen');
    bleEngine.startSync(this.mapping, this.user.telegramId);
  },
};

// ============================================================
// RILEVAMENTO TIPO TESSERA
// Usa il campo "tag" del JSON Chameleon come fonte primaria.
// SAK/ATQA come fallback per tessere senza campo tag.
// ============================================================
function detectCardProfile(res) {
  const { TagType, Buffer } = window.ChameleonUltraJS;
  const blocks=res.data||[], numBlocks=blocks.length, totalBytes=numBlocks*16;

  // Normalizza UID
  let uidHex='';
  if (typeof res.uid==='string') uidHex=res.uid.replace(/\s+/g,'');
  else if (Array.isArray(res.uid)) uidHex=res.uid.map(b=>b.toString(16).padStart(2,'0')).join('');
  const uidLen=uidHex.length/2;

  // Normalizza ATQA
  let atqaBytes;
  if (Array.isArray(res.atqa)) atqaBytes=res.atqa;
  else if (typeof res.atqa==='string'){const h=res.atqa.replace(/\s+/g,'');atqaBytes=[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16)];}
  else atqaBytes=[0,0];

  // SAK originale dalla tessera (usato per anti-collision, anche se 0)
  const sak=typeof res.sak==='number'?res.sak:parseInt(res.sak||'0',16);

  let tagType, writeMode, tagName;

  // ── METODO 1: usa campo "tag" del JSON Chameleon (autoritativo) ──
  // I codici corrispondono ai valori enum TagType della libreria
  const tagCode = res.tag || res.tag_type || null;
  if (tagCode) {
    const tagMap = {
      1001: [TagType.MIFARE_1024,     'mf1',        `MIFARE 1K${uidLen===7?' (7B)':''}`],
      1002: [TagType.MIFARE_2048,     'mf1',        `MIFARE 4K${uidLen===7?' (7B)':''}`],
      1003: [TagType.MIFARE_Mini,     'mf1',        'MIFARE Mini'],
      1004: [TagType.MifareUltralight,'ultralight', 'Ultralight'],
      1005: [TagType.NTAG_213,        'ultralight', 'NTAG213'],
      1006: [TagType.NTAG_215,        'ultralight', 'NTAG215'],
      1007: [TagType.NTAG_216,        'ultralight', 'NTAG216'],
    };
    const mapped = tagMap[tagCode];
    if (mapped) {
      [tagType, writeMode, tagName] = mapped;
      console.log(`[detectCardProfile] tag=${tagCode} → ${tagName}`);
    }
  }

  // ── METODO 2: fallback su SAK + dimensione (per tessere senza campo tag) ──
  if (!tagType) {
    const sakMasked=sak&0x7F;
    if      (sakMasked===0x09)                              { tagType=TagType.MIFARE_Mini;      writeMode='mf1';        tagName='MIFARE Mini'; }
    else if (sakMasked===0x08&&totalBytes<=1024)             { tagType=TagType.MIFARE_1024;     writeMode='mf1';        tagName=`MIFARE 1K${uidLen===7?' (7B)':''}`; }
    else if ((sakMasked===0x18||sakMasked===0x08)&&totalBytes>1024){ tagType=TagType.MIFARE_2048;writeMode='mf1';       tagName=`MIFARE 4K${uidLen===7?' (7B)':''}`; }
    else if (sakMasked===0x00&&totalBytes<=64)               { tagType=TagType.MifareUltralight;writeMode='ultralight'; tagName='Ultralight'; }
    else if (sakMasked===0x00&&totalBytes<=192)              { tagType=TagType.NTAG_213;        writeMode='ultralight'; tagName='NTAG213'; }
    else if (sakMasked===0x00&&totalBytes<=540)              { tagType=TagType.NTAG_215;        writeMode='ultralight'; tagName='NTAG215'; }
    else if (sakMasked===0x00&&totalBytes<=924)              { tagType=TagType.NTAG_216;        writeMode='ultralight'; tagName='NTAG216'; }
    // ── METODO 3: fallback su dimensione pura (ultimo tentativo) ──
    else if (totalBytes<=1024)  { tagType=TagType.MIFARE_1024; writeMode='mf1'; tagName=`MIFARE 1K (fallback dim, SAK=0x${sak.toString(16).toUpperCase()})`; }
    else if (totalBytes<=2048)  { tagType=TagType.MIFARE_2048; writeMode='mf1'; tagName=`MIFARE 4K (fallback dim, SAK=0x${sak.toString(16).toUpperCase()})`; }
    else { tagType=null; writeMode='unsupported'; tagName=`Non supportato (SAK=0x${sak.toString(16).toUpperCase()}, ${totalBytes}B)`; }
    console.log(`[detectCardProfile] fallback SAK=0x${sak.toString(16)} totalBytes=${totalBytes} → ${tagName}`);
  }

  const flatBytes=[];
  for (const block of blocks) for (const byte of block) flatBytes.push(byte);
  return { tagType,writeMode,tagName,numBlocks,uid:Buffer.from(uidHex,'hex'),atqa:Buffer.from(atqaBytes),sak:Buffer.from([sak]),ats:Buffer.alloc(0),body:Buffer.from(flatBytes) };
}

// ============================================================
// SESSIONE SICURA — timer 60s, cancellazione automatica
// ============================================================
const secureSession = {
  _timer: null, _startedAt: null, _slotLabels: [], _wiping: false, _sessionId: null,

  start(slotLabels) {
    this._slotLabels = slotLabels;
    this._startedAt  = Date.now();
    this._wiping     = false;
    // Aggiorna UI sessione
    const s=document.getElementById('session-slots-summary');
    if(s){
      s.innerHTML=slotLabels.map(label=>{
        const card=(app.cards||[]).find(c=>c.slot_label===label)||
          Object.values(app.mapping||{}).find(c=>c&&c.slot_label===label);
        const ops=card?.roaming_detail||[];
        const opsHtml=ops.length?ops.slice(0,5).map(r=>{
          const col=app._opColor(r.operator_name);
          return `<span class="session-op-pill" style="background:${col.pill.bg};color:${col.pill.fg};border:0.5px solid ${col.pill.border}">${app._esc(r.operator_name)}</span>`;
        }).join('')+(ops.length>5?`<span class="session-op-pill" style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4)">+${ops.length-5}</span>`:''):'';
        return `<div class="session-slot-card"><div class="session-slot-name">✅ ${app._esc(label)}</div>${opsHtml?`<div class="session-slot-ops">${opsHtml}</div>`:''}</div>`;
      }).join('');
    }
    document.getElementById('session-warning-bar').classList.add('hidden');
    document.getElementById('session-cancel-btn').disabled=false;
    this._updateRing(SESSION_TIMEOUT_SEC);
    app.showScreen('session-screen');
    // Avvia timer
    if (this._timer) clearInterval(this._timer);
    this._timer=setInterval(()=>{
      const rem=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));
      this._tick(rem);
      if (rem<=0){clearInterval(this._timer);this._timer=null;this.cancel('auto');}
    },500);
    // Visibilità: ricalcola quando torna in foreground
    document.addEventListener('visibilitychange',this._onVis=()=>{
      if(!this._startedAt || this._wiping) return;

      if(document.visibilityState==='hidden') {
        // App in background: verifica se BLE ancora connesso
        if(bleEngine.ultra) {
          try {
            bleEngine.ultra.isConnected().then(connected => {
              if(!connected && !this._wiping) {
                this._sendEndSession('ble_lost');
                app.apiCall({
                  action:'notify_admin', user_id:app.user.telegramId,
                  event:'ble_disconnected_during_session',
                  slots:(this._slotLabels||[]).join(','),
                  error:'BLE perso con schermo spento o app in background'
                }).catch(()=>{});
              }
            }).catch(()=>{});
          } catch(e){}
        }
        return;
      }
      // Torna in foreground: ricalcola timer
      const rem=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));
      if(rem<=0) this.cancel('auto');
      else{
        this._tick(rem);
        if(!this._timer){
          this._timer=setInterval(()=>{
            const r=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));
            this._tick(r);
            if(r<=0){clearInterval(this._timer);this._timer=null;this.cancel('auto');}
          },500);
        }
      }
    });
    // SICUREZZA: blocca navigazione browser durante sessione attiva
    window.addEventListener('beforeunload', this._onUnload=e=>{
      if (!this._wiping && this._startedAt) {
        e.preventDefault();
        e.returnValue='Sessione attiva! Premi "Cancella ora" prima di uscire.';
        // Tenta comunque di registrare la chiusura forzata
        this._sendEndSession('ble_lost');
      }
    });
    // pagehide: più affidabile su mobile quando l'app viene killata/swipata via
    window.addEventListener('pagehide', this._onPageHide=()=>{
      if (!this._wiping && this._startedAt) {
        this._sendEndSession('ble_lost');
      }
    });
    // SICUREZZA: intercetta tasto Back Android (history.back)
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', this._onPop=()=>{
      if (!this._wiping && this._startedAt) {
        history.pushState(null,'',location.href); // rimetti nello stack
        this._showBlockAlert();
      }
    });
  },

  _showBlockAlert() {
    // Mostra overlay di blocco invece di lasciare uscire
    const existing=document.getElementById('session-block-overlay');
    if (existing) { existing.classList.remove('hidden'); return; }
    const overlay=document.createElement('div');
    overlay.id='session-block-overlay';
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px';
    overlay.innerHTML=`
      <div style="font-size:60px;margin-bottom:20px">⚠️</div>
      <div style="font-size:20px;font-weight:900;color:white;margin-bottom:15px">SESSIONE ATTIVA</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.7);margin-bottom:30px;line-height:1.7">
        Non puoi uscire con le tessere caricate.<br>
        Premi il pulsante qui sotto per cancellare<br>gli slot e chiudere la sessione in sicurezza.
      </div>
      <button onclick="document.getElementById('session-block-overlay').classList.add('hidden');secureSession.cancel('manual')" 
        style="background:#B71C1C;color:white;padding:16px 32px;border-radius:15px;font-size:16px;font-weight:900;border:none;cursor:pointer;width:100%">
        🗑️ CANCELLA E CHIUDI SESSIONE
      </button>
      <button onclick="document.getElementById('session-block-overlay').classList.add('hidden')"
        style="background:transparent;color:rgba(255,255,255,0.5);padding:12px;border:none;cursor:pointer;margin-top:10px;font-size:14px">
        Torna alla sessione
      </button>`;
    document.body.appendChild(overlay);
  },

  _tick(rem) {
    const n=document.getElementById('session-countdown-num');
    const ring=document.getElementById('session-ring-fill');
    const bar=document.getElementById('session-warning-bar');
    const secs=document.getElementById('session-warning-secs');
    if(!n)return;
    const urgent=rem<=10;
    n.textContent=rem; n.className='session-countdown-num'+(urgent?' urgent':'');
    if(ring){ring.style.strokeDashoffset=427.26*(1-rem/SESSION_TIMEOUT_SEC);ring.className='session-ring-fill'+(urgent?' urgent':'');}
    if(bar&&secs){if(urgent&&rem>0){bar.classList.remove('hidden');secs.textContent=rem;}else bar.classList.add('hidden');}
    // Vibrazione progressiva negli ultimi 10 secondi
    if(navigator.vibrate && rem>0) {
      if(rem<=3)       navigator.vibrate(200);        // ultimi 3s: vibrazione lunga
      else if(rem<=5)  navigator.vibrate([100,50,100]); // 4-5s: doppia
      else if(rem<=10 && rem%2===0) navigator.vibrate(50); // 6-10s: ogni 2s leggera
    }
  },

  _updateRing(r){
    const ring=document.getElementById('session-ring-fill');
    if(ring)ring.style.strokeDashoffset=326.73*(1-r/SESSION_TIMEOUT_SEC);
    const n=document.getElementById('session-countdown-num');if(n)n.textContent=r;
  },

  // Invia end_session con sendBeacon (funziona anche se browser viene killato)
  // ============================================================
  // FEEDBACK POST-SESSIONE
  // ============================================================
  _fbSelectedSlot: null,
  _fbSelectedOp:   null,

  _showFeedback() {
    const labels = this._slotLabels || [];
    if (!labels.length) { this._fbFinish(); return; }

    const slotList = document.getElementById('fb-slot-list');
    slotList.innerHTML = '';
    labels.forEach(label => {
      const card = (app.cards||[]).find(c => c.slot_label === label);
      const ops  = (card?.roaming_detail||[])
        .filter(r => (parseInt(r.usage_count)||0) > 0)
        .map(r => r.operator_name).join(', ');
      const btn = document.createElement('button');
      btn.className = 'fb-slot-btn';
      btn.innerHTML = `
        <div class="fb-slot-num">${app._esc(card?.id||'?')}</div>
        <div class="fb-slot-info">
          <div class="fb-slot-label">${app._esc(label)}</div>
          ${ops ? `<div class="fb-slot-ops">Usato con: ${app._esc(ops)}</div>` : ''}
        </div>
        <span style="color:var(--text-muted);font-size:20px">›</span>`;
      btn.onclick = () => this._fbSelectSlot(card, label, btn);
      slotList.appendChild(btn);
    });

    this._fbSelectedSlot = null;
    this._fbSelectedOp   = null;
    document.getElementById('fb-step0').classList.add('hidden');
    document.getElementById('fb-step1').classList.remove('hidden');
    document.getElementById('fb-step2').classList.add('hidden');
    document.getElementById('fb-step3').classList.add('hidden');
    app.showScreen('feedback-screen');
  },

  _fbSelectSlot(card, label, btn) {
    document.querySelectorAll('.fb-slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    this._fbSelectedSlot = { card, label };
    if(navigator.vibrate) navigator.vibrate(30);
    setTimeout(() => {
      document.getElementById('fb-step1').classList.add('hidden');
      this._buildOpList(card);
      document.getElementById('fb-step2').classList.remove('hidden');
    }, 200);
  },

  _buildOpList(card) {
    const opList = document.getElementById('fb-op-list');
    opList.innerHTML = '';
    document.getElementById('fb-op-custom').value = '';
    document.getElementById('fb-note-used').value = '';
    const ops = (card?.roaming_detail||[])
      .sort((a,b) => (parseInt(b.usage_count)||0) - (parseInt(a.usage_count)||0));
    if (!ops.length) {
      opList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Nessun operatore precedente — usa il campo sotto</div>';
      return;
    }
    ops.forEach(r => {
      const col = app._opColor(r.operator_name);
      const ini = app._opInitials(r.operator_name);
      const cnt = parseInt(r.usage_count)||0;
      const btn = document.createElement('button');
      btn.className = 'fb-op-btn';
      btn.innerHTML = `
        <div class="fb-op-avatar" style="background:${col.grad}">${app._esc(ini)}</div>
        <div style="flex:1">
          <div class="fb-op-name">${app._esc(r.operator_name)}</div>
          ${cnt ? `<div class="fb-op-count">✓ usato ${cnt} volta${cnt>1?'e':''}</div>` : ''}
        </div>
        <span style="color:var(--text-muted);font-size:20px">›</span>`;
      btn.onclick = () => {
        document.querySelectorAll('.fb-op-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this._fbSelectedOp = r.operator_name;
        document.getElementById('fb-op-custom').value = '';
        if(navigator.vibrate) navigator.vibrate(30);
      };
      opList.appendChild(btn);
    });
  },

  _fbBack(toStep) {
    document.getElementById(`fb-step${toStep}`).classList.remove('hidden');
    document.getElementById(`fb-step${toStep+1}`).classList.add('hidden');
    if (toStep === 1) { this._fbSelectedSlot = null; this._fbSelectedOp = null; }
  },

  _fbConfirmOp() {
    const custom = document.getElementById('fb-op-custom').value.trim();
    if (custom) this._fbSelectedOp = custom;
    if (!this._fbSelectedOp) {
      document.getElementById('fb-op-custom').style.borderColor = 'var(--error-red)';
      document.getElementById('fb-op-custom').placeholder = 'Seleziona o scrivi un operatore...';
      return;
    }
    document.getElementById('fb-op-custom').style.borderColor = '';
    const notes = (document.getElementById('fb-note-used')?.value || '').trim();

    if (this._sessionId) {
      app.apiCall({
        action:     'save_session_survey',
        user_id:    app.user.telegramId,
        session_id: this._sessionId,
        slot_used:  this._fbSelectedSlot?.label || '',
        operator:   this._fbSelectedOp || '',
        notes:      notes,
      }).catch(()=>{});
    }

    document.getElementById('fb-summary-slot').textContent = this._fbSelectedSlot?.label || '';
    document.getElementById('fb-summary-op').textContent   = this._fbSelectedOp || '';
    const noteWrap = document.getElementById('fb-summary-note-wrap');
    const noteEl   = document.getElementById('fb-summary-note');
    if (notes && noteWrap && noteEl) { noteEl.textContent = notes; noteWrap.style.display = 'block'; }
    else if (noteWrap) { noteWrap.style.display = 'none'; }

    const slotLabel = encodeURIComponent(this._fbSelectedSlot?.label || '');
    const opLabel   = encodeURIComponent(this._fbSelectedOp || '');
    document.getElementById('fb-tg-link').href = `https://t.me/Fox_Ev_bot?start=consumo_${slotLabel}_${opLabel}`;

    document.getElementById('fb-step2').classList.add('hidden');
    document.getElementById('fb-step3').classList.remove('hidden');
  },

  _fbShowSkipReason() {
    document.getElementById('fb-step1').classList.add('hidden');
    document.getElementById('fb-step0').classList.remove('hidden');
    document.querySelectorAll('.fb-skip-reason-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('fb-skip-note').value = '';
    document.getElementById('fb-skip-note-err').style.display = 'none';
    document.getElementById('fb-skip-note').style.borderColor = '';
    document.querySelectorAll('.fb-skip-reason-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.fb-skip-reason-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        if(navigator.vibrate) navigator.vibrate(30);
        if (btn.dataset.reason === 'Altro') {
          document.getElementById('fb-skip-note').value = '';
          document.getElementById('fb-skip-note').focus();
        } else {
          document.getElementById('fb-skip-note').value = btn.dataset.reason;
        }
      };
    });
  },

  _fbBackToSlots() {
    document.getElementById('fb-step0').classList.add('hidden');
    document.getElementById('fb-step1').classList.remove('hidden');
  },

  _fbSkipConfirm() {
    const note = document.getElementById('fb-skip-note').value.trim();
    if (!note) {
      document.getElementById('fb-skip-note-err').style.display = 'block';
      document.getElementById('fb-skip-note').style.borderColor = 'var(--error-red)';
      return;
    }
    document.getElementById('fb-skip-note-err').style.display = 'none';
    document.getElementById('fb-skip-note').style.borderColor = '';

    if (this._sessionId) {
      app.apiCall({
        action:     'save_session_survey',
        user_id:    app.user.telegramId,
        session_id: this._sessionId,
        slot_used:  '',
        operator:   '',
        notes:      note,
      }).catch(()=>{});
    }
    this._slotLabels = [];
    app.showScreen('dashboard-screen');
  },

  _fbFinish() {
    this._slotLabels = [];
    app.showScreen('dashboard-screen');
  },

  // ============================================================
  _sendEndSession(reason) {
    const uid = app.user?.telegramId;
    if (!uid) return;
    const url = `${window.location.origin}/app_api.php?action=end_session&user_id=${encodeURIComponent(uid)}&reason=${encodeURIComponent(reason)}`;
    // sendBeacon garantisce la consegna anche durante beforeunload/pagehide
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      // fallback sincrono XHR (legacy)
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false); // sincrono
        xhr.send();
      } catch(e) {}
    }
  },

  async cancel(reason) {
    if (this._wiping) return;
    this._wiping=true;
    if (this._timer){clearInterval(this._timer);this._timer=null;}
    if (this._onVis)      document.removeEventListener('visibilitychange',this._onVis);
    if (this._onUnload)   window.removeEventListener('beforeunload',this._onUnload);
    if (this._onPop)      window.removeEventListener('popstate',this._onPop);
    if (this._onPageHide) window.removeEventListener('pagehide',this._onPageHide);
    const overlay=document.getElementById('session-block-overlay'); if(overlay)overlay.remove();
    document.getElementById('session-cancel-btn').disabled=true;
    app.showScreen('wipe-screen');
    const setWipe=(icon,title,status)=>{
      document.getElementById('wipe-icon').textContent=icon;
      document.getElementById('wipe-title').textContent=title;
      document.getElementById('wipe-status').textContent=status;
    };
    setWipe('🗑️','CANCELLAZIONE IN CORSO',reason==='auto'?'Timer scaduto — pulizia slot...':'Cancellazione manuale...');
    try {
      await bleEngine.wipeAllSlots(setWipe);
      if(navigator.vibrate)navigator.vibrate([100,50,200]);
      this._sendEndSession(reason);
      setWipe('🦊✅','DISPOSITIVO PULITO','Tutti gli slot sono stati cancellati.');
      setTimeout(()=>{ this._wiping=false; this._showFeedback(); }, 1200);
    } catch(err) {
      console.error('[WIPE ERROR]',err);
      // BLE perso: notifica admin e logout sicuro
      secureSession._sendEndSession('ble_lost');
      app.apiCall({
        action: 'notify_admin',
        user_id: app.user.telegramId,
        event: 'ble_disconnected_during_session',
        slots: this._slotLabels.join(','),
        error: (err.message||'').substring(0,100),
      }).catch(()=>{});
      setWipe('🔒','SESSIONE INTERROTTA','Connessione persa durante la sessione attiva.\n\nGli amministratori sono stati avvisati.\nVerrai disconnesso tra pochi secondi.');
      this._startedAt=null; this._slotLabels=[]; this._wiping=false;
      setTimeout(()=>app.logout(),4000);
    }
  },
};

// ============================================================
// BLE ENGINE — UNIVERSALE (Compatibile con V1, V2.0 e V3.0)
// ============================================================
window.bleEngine = {
  ultra: null,

  _bleLog(msg, isError=false) {
    const ts = new Date().toLocaleTimeString('it-IT');
    const line = `[${ts}] ${msg}`;
    console.log('[BLE]', msg);
    const panel = document.getElementById('ble-debug-panel');
    const log   = document.getElementById('ble-debug-log');
    if (!panel || !log) return;
    log.textContent += line + '\n';
    log.scrollTop = log.scrollHeight;
    if (isError) panel.classList.remove('hidden');
  },

  // ── Schermata connect-screen ──
  setConnectStatus(icon, title, msg, showBtn=false) {
    document.getElementById('connect-icon').textContent=icon;
    document.getElementById('connect-title').textContent=title;
    document.getElementById('connect-status').textContent=msg;
    const btn=document.getElementById('connect-back-btn');
    if(showBtn)btn.classList.remove('hidden'); else btn.classList.add('hidden');
  },

  // ── Schermata sync-screen ──
  updateUI(progress, text, state='working') {
    document.getElementById('sync-progress-fill').style.width=`${progress}%`;
    document.getElementById('sync-progress-text').innerText=`${Math.round(progress)}% Completato`;
    document.getElementById('sync-status-text').innerText=text;
    const icon=document.getElementById('sync-icon');
    icon.className=`sync-status-icon ${state}`;
    icon.innerText=state==='success'?'✅':state==='error'?'❌':'📶';
    if(state!=='working')document.getElementById('sync-back-btn').classList.remove('hidden');
    else document.getElementById('sync-back-btn').classList.add('hidden');
  },

  // ── PASSO 1: Connetti e pulisci ──
  async connectAndRead(telegramId) {
    this.setConnectStatus('📶','CONNESSIONE IN CORSO','Seleziona il dispositivo nel popup e premi Accoppia...');
    try {
      const { ChameleonUltra, TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;
      
      if (this.ultra) { try{await this.ultra.disconnect();}catch(e){} this.ultra=null; }
      
      this.ultra = new ChameleonUltra();
      await this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      await this.ultra.connect();
      
      this.hwVersion = 1; // workaround universale — sicuro su tutti i modelli SE/SE2/SE3
      await new Promise(r=>setTimeout(r,300)); // stabilizza BLE post-connect

      this.setConnectStatus('🔍','LETTURA IN CORSO','Chameleon connesso, lettura slot...');
      const slotSnapshot = [];
      for (let i=0; i<8; i++) {
        let name = null, uid = null;
        try { name = await this.ultra.cmdSlotGetFreqName(i, FreqType.HF); } catch(e) {}
        if (name && name.trim()) {
          try {
            await this.ultra.cmdSlotSetActive(i);
            await new Promise(r=>setTimeout(r,50)); // Respiro universale
            const ac = await this.ultra.cmdHf14aGetAntiCollData();
            if (ac?.uid) {
              uid = Array.from(ac.uid).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(':');
            }
          } catch(e) {}
          slotSnapshot.push({ slot: i+1, name: name.trim(), uid: uid || null });
        }
      }
      this._pendingSnapshot = slotSnapshot.length > 0 ? slotSnapshot : null;

      this.setConnectStatus('🧹','PULIZIA IN CORSO','Cancellazione slot precedenti...');
      for (let i=0; i<8; i++) {
        await this.ultra.cmdSlotChangeTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(i, FreqType.HF, false);
        await this.ultra.cmdSlotDeleteFreqName(i, FreqType.HF).catch(()=>{});
        
        // TIMING UNIVERSALE: 150ms salva il V1, impercettibile per V2/V3
        await new Promise(r=>setTimeout(r,150));
      }
      
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,400)); // Tempo per la memoria flash

      // CAMBIO MODALITA' UNIVERSALE SICURO
      try { await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG); } catch(e) {}

      app.mapping = { 1:null,2:null,3:null,4:null,5:null,6:null,7:null,8:null };
      app.renderSlots();
      this.setConnectStatus('✅','PRONTO','Chameleon pronto. Seleziona le tessere.');
      document.getElementById('connect-back-btn').classList.add('hidden');
      document.getElementById('connect-config-section').classList.remove('hidden');

    } catch(err) {
      bleEngine._bleLog('ERRORE: ' + (err.message||String(err)), true);
      this.setConnectStatus('❌','ERRORE CONNESSIONE',`${err.message}\n\nAssicurati che il Bluetooth sia attivo.\n\n🔧 Vedi il log debug qui sopra e premi "Copia log" per mandarcelo.`,true);
      if (this.ultra){try{await this.ultra.disconnect();}catch(e){} this.ultra=null;}
    }
  },

  // ── PASSO 2: Scrivi slot ──
  async startSync(mapping, telegramId) {
    this.updateUI(0,'Scrittura tessere in corso...','working');
    try {
      const { TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;
      if (!this.ultra) throw new Error('Dispositivo non connesso. Torna indietro e riconnetti.');

      // Solo slot 1, 5, 8 — compatibili V1/V2/V3/V4
      const ALLOWED_SLOTS = [1, 5, 8];
      const slotsToWrite=[];
      for (let i=1;i<=8;i++) {
        if(mapping[i] && ALLOWED_SLOTS.includes(i))
          slotsToWrite.push({slotIdx:i-1, slotNum:i, card:mapping[i]});
      }
      if (slotsToWrite.length===0) throw new Error('Nessuno slot selezionato.');

      this.updateUI(5,'🧹 Reset globale degli slot...','working');

      // Firmware vecchio (<2.0): wipe flash per azzerare stato inconsistente
      // cmdWipeFds = equivalente di factory_reset --force — azzeramento completo flash
      if (bleEngine.hwVersion === 1) {
        this.updateUI(5,'🔄 Reset firmware...','working');
        try {
          const supported = await this.ultra.cmdGetSupportedCmds().catch(()=>null);
          const wipeCmdId = 1014;
          if (!supported || supported.includes(wipeCmdId)) {
            await this.ultra.cmdWipeFds();
            bleEngine._bleLog('cmdWipeFds OK (flash azzerato)');
          } else {
            bleEngine._bleLog('cmdWipeFds non supportato da questo firmware, skip', true);
          }
        } catch(e) {
          bleEngine._bleLog('cmdWipeFds ERRORE: ' + (e.message||e), true);
        }
        await new Promise(r=>setTimeout(r,1200));
      }

      for (let i=0;i<8;i++) {
        // try/catch su ogni op: se V1 fallisce non genera throw → no logout
        try { await this.ultra.cmdSlotChangeTagType(i,TagType.MIFARE_1024); }
        catch(e) {
          bleEngine._bleLog(`cmdSlotChangeTagType slot ${i} retry (${e.message||e})`, true);
          await new Promise(r=>setTimeout(r,300));
          try { await this.ultra.cmdSlotChangeTagType(i,TagType.MIFARE_1024); }
          catch(e2){ bleEngine._bleLog(`cmdSlotChangeTagType slot ${i} fallito dopo retry`, true); }
        }
        try { await this.ultra.cmdSlotResetTagType(i,TagType.MIFARE_1024); }
        catch(e) {
          bleEngine._bleLog(`cmdSlotResetTagType slot ${i} retry (${e.message||e})`, true);
          await new Promise(r=>setTimeout(r,300));
          try { await this.ultra.cmdSlotResetTagType(i,TagType.MIFARE_1024); }
          catch(e2){ bleEngine._bleLog(`cmdSlotResetTagType slot ${i} fallito dopo retry`, true); }
        }
        await this.ultra.cmdSlotSetEnable(i,FreqType.HF,false).catch(()=>{});
        await this.ultra.cmdSlotDeleteFreqName(i,FreqType.HF).catch(()=>{});
        await new Promise(r=>setTimeout(r,150)); // TIMING UNIVERSALE
      }
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,300));

      const total=slotsToWrite.length;
      const loadedLabels=[];

      for (let idx=0;idx<total;idx++) {
        const {slotIdx,card}=slotsToWrite[idx];
        const base=10+(idx/total)*80;

        this.updateUI(base,`[${idx+1}/${total}] Configurazione ${card.slot_label}...`,'working');
        const res=await app.apiCall({action:'get_json_content',user_id:telegramId,slot_id:card.id});
        const profile=detectCardProfile(res);
        if (profile.writeMode==='unsupported') throw new Error(`Tessera non supportata: ${profile.tagName}`);

        await this.ultra.cmdSlotSetActive(slotIdx);
        await this.ultra.cmdSlotChangeTagType(slotIdx,profile.tagType);
        await this.ultra.cmdSlotResetTagType(slotIdx,profile.tagType);
        await this.ultra.cmdSlotSetEnable(slotIdx,FreqType.HF,true);
        await new Promise(r=>setTimeout(r,100)); // TIMING UNIVERSALE
        await this.ultra.cmdSlotSetFreqName(slotIdx,FreqType.HF,card.slot_label);
        await this.ultra.cmdHf14aSetAntiCollData({uid:profile.uid,atqa:profile.atqa,sak:profile.sak,ats:profile.ats});

        this.updateUI(base+(80/total)*0.5,`[${idx+1}/${total}] Scrittura blocchi...`,'working');
        for (let block=0;block<profile.numBlocks;block++) {
          const chunk=profile.body.slice(block*16,(block+1)*16);
          for (let attempt=0; attempt<3; attempt++) {
            try {
              await this.ultra.cmdMf1EmuWriteBlock(block,chunk);
              break;
            } catch(e) {
              if (attempt===2) throw e;
              await new Promise(r=>setTimeout(r,300));
            }
          }
          
          // TIMING UNIVERSALE: Pausa ogni 8 blocchi per evitare saturazione buffer V1
          if (block>0 && block%8===0) {
            await new Promise(r=>setTimeout(r,150)); 
          }
          if (block%8===0||block===profile.numBlocks-1) {
            const wp=base+(80/total)*0.5+(80/total)*0.45*(block/profile.numBlocks);
            this.updateUI(wp,`[${idx+1}/${total}] Blocco ${block+1}/${profile.numBlocks}...`,'working');
          }
        }
        loadedLabels.push(card.slot_label);
        await new Promise(r=>setTimeout(r,200));
      }

      this.updateUI(92,'💾 Salvataggio in corso...','working');
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,800));

      this.updateUI(96,'🔄 Attivazione TAG...','working');
      
      // CAMBIO MODALITA' UNIVERSALE SICURO
      try { 
        await this.ultra.cmdChangeDeviceMode(DeviceMode.READER);
        await new Promise(r=>setTimeout(r,300));
        await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG);
      } catch(e) {}

      this.updateUI(100,'✅ Tessere caricate! Avvio sessione...','success');
      if(navigator.vibrate)navigator.vibrate([100,50,100]);
      await new Promise(r=>setTimeout(r,800));
      
      const geo = app._pendingGeoLocation || {};
      app.apiCall({
        action:  'start_session', user_id: telegramId, slots: loadedLabels.join(','),
        lat: geo.lat || '', lng: geo.lng || '', acc: geo.acc || '',
      }).then(res => {
        const sessionId = res?.session_id;
        // Memorizza session_id per la survey post-sessione
        secureSession._sessionId = sessionId || null;
        const snap = bleEngine._pendingSnapshot;
        if (snap && snap.length > 0) {
          app.apiCall({ action: 'save_slot_snapshot', user_id: telegramId, snapshot: JSON.stringify(snap), session_id: sessionId || '' }).catch(()=>{});
          bleEngine._pendingSnapshot = null;
        }
      }).catch(()=>{});
      
      secureSession.start(loadedLabels);

    } catch(err) {
      console.error('[SYNC ERROR]',err);
      this.updateUI(0,`❌ ERRORE:\n${err.message||err}`,'error');
      if(this.ultra){try{await this.ultra.disconnect();}catch(e){} this.ultra=null;}
    }
  },

  // ── PASSO 3: Cancella tutti gli slot e Disconnetti ──
  async wipeAllSlots(setWipe) {
    const { TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;
    if (!this.ultra) {
      setWipe('📶','RICONNESSIONE','Connessione persa. Tentativo di riconnessione...');
      const { ChameleonUltra } = window.ChameleonUltraJS;
      this.ultra = new ChameleonUltra();
      await this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      await this.ultra.connect();
    }

    setWipe('🗑️','CANCELLAZIONE IN CORSO','Pulizia slot...');
    for (let i=0;i<8;i++) {
      await this.ultra.cmdSlotChangeTagType(i,TagType.MIFARE_1024);
      await this.ultra.cmdSlotResetTagType(i,TagType.MIFARE_1024);
      await this.ultra.cmdSlotSetEnable(i,FreqType.HF,false);
      await this.ultra.cmdSlotDeleteFreqName(i,FreqType.HF).catch(()=>{});
      await new Promise(r=>setTimeout(r,800)); // TIMING UNIVERSALE
      setWipe('🗑️','CANCELLAZIONE IN CORSO',`Slot ${i+1}/8 cancellato...`);
    }
    
    // Firmware vecchio: wipe flash dopo cancellazione per garantire stato pulito
    // Questo risolve il bug "seconda sessione" su SE/SE2 con firmware <2.0
    if (this.hwVersion === 1) {
      try {
        const supported = await this.ultra.cmdGetSupportedCmds().catch(()=>null);
        const wipeCmdId = 1014;
        if (!supported || supported.includes(wipeCmdId)) {
          await this.ultra.cmdWipeFds();
        }
      } catch(e) { console.warn('[BLE] cmdWipeFds non supportato:', e.message); }
      await new Promise(r=>setTimeout(r,1200));
    }

    await this.ultra.cmdSlotSaveSettings();
    await new Promise(r=>setTimeout(r,1000)); // Tempo lungo per salvataggio Flash

    // DISCONNESSIONE UNIVERSALE SICURA (V1, V2, V3)
    try { await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG); } catch(e) {}
    
    // Dummy Read per svuotare il buffer BLE prima del disconnect
    try { await this.ultra.cmdGetAppVersion(); } catch(e) {}
    
    await new Promise(r=>setTimeout(r,1500)); // Respiro finale prima del taglio

    try {
        if (this.ultra.adapter && typeof this.ultra.adapter.disconnect === 'function') {
            await this.ultra.adapter.disconnect();
        } else {
            await this.ultra.disconnect();
        }
    } catch(e) {
        console.warn("Disconnessione forzata:", e);
    } finally {
        this.ultra = null;
    }
  },
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg=>console.log('SW registered',reg))
    .catch(err=>console.error('SW failed',err));
}

window.onload = () => app.init();