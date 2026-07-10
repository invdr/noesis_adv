(() => {
  // Страница /catalog: каталожные данные запечены (window.NOESIS_CATALOG), а
  // занятость на выбранный период тянется из публичного API и мёржится по id.
  const CFG = (typeof window !== 'undefined' && window.NOESIS_CATALOG) || {};
  const ITEMS = CFG.items || [];
  const MAP = CFG.map || {};
  const API = (typeof window !== 'undefined' && window.NOESIS_API_URL) || '';

  const form = document.getElementById('catalogFilters');
  const listEl = document.getElementById('catalogList');
  const emptyEl = document.getElementById('catalogEmpty');
  const statusEl = document.getElementById('catalogStatus');
  const legendEl = document.getElementById('catalogLegend');
  const mapEl = document.getElementById('catalogMap');
  if (!form || !listEl) return;

  const onlyFree = form.querySelector('input[name="onlyFree"]');
  const resetBtn = document.getElementById('catalogReset');

  let map = null;
  const placemarks = new Map(); // id -> текущий placemark на карте
  let availability = null;      // Map id -> { status, sides }
  let availabilityLabel = '';
  let availabilityError = false;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toNum(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function shiftDate(iso, days) {
    const t = new Date(iso + 'T00:00:00.000Z').getTime();
    if (!Number.isFinite(t)) return '';
    return new Date(t + days * 86400000).toISOString().slice(0, 10);
  }
  function fmtRu(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}.${m[2]}` : iso;
  }

  // Агрегат занятости конструкции из статусов её сторон: свободна, если есть
  // хотя бы одна полностью свободная сторона; занята, если заняты все; иначе —
  // частично.
  function aggregate(sides) {
    if (!sides || !sides.length) return 'free';
    if (sides.some((s) => s.status === 'free')) return 'free';
    if (sides.every((s) => s.status === 'occupied')) return 'occupied';
    return 'partial';
  }

  const AVAIL_TEXT = {
    free: 'Свободно на период',
    partial: 'Частично занято на период',
    occupied: 'Занято на период',
  };
  const AVAIL_PRESET = {
    free: 'islands#greenDotIcon',
    partial: 'islands#orangeDotIcon',
    occupied: 'islands#grayDotIcon',
  };

  function readFilters() {
    const data = new FormData(form);
    return {
      format: String(data.get('format') || ''),
      district: String(data.get('district') || ''),
      priceFrom: toNum(data.get('priceFrom')),
      priceTo: toNum(data.get('priceTo')),
      onlyFree: onlyFree.checked && !!availability,
    };
  }

  function matches(item, f) {
    if (f.format && item.format !== f.format) return false;
    if (f.district && (item.district || '') !== f.district) return false;
    if (f.priceFrom != null || f.priceTo != null) {
      if (item.pricePerMonth == null) return false; // «по запросу» вне диапазона
      if (f.priceFrom != null && item.pricePerMonth < f.priceFrom) return false;
      if (f.priceTo != null && item.pricePerMonth > f.priceTo) return false;
    }
    if (f.onlyFree) {
      const a = availability.get(item.id);
      if (!a || a.status !== 'free') return false;
    }
    return true;
  }

  function balloonHTML(item) {
    const lines = [
      `<strong>${esc(item.priceLabel)}</strong>`,
      esc(item.address),
      `${esc(item.formatLabel)} · ${esc(item.sideLabel)}`,
    ];
    const a = availability && availability.get(item.id);
    if (a) {
      const perSide = a.sides
        .map((s) => `${esc(s.code)}: ${esc(AVAIL_TEXT[s.status === 'partiallyOccupied' ? 'partial' : s.status].replace(' на период', ''))}`)
        .join(' · ');
      lines.push(`<span class="catalog-balloon-avail">${perSide}</span>`);
    }
    return lines.join('<br>');
  }

  function focusCard(id) {
    const card = listEl.querySelector(`[data-id="${id}"]`);
    if (!card || card.hidden) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlighted');
    setTimeout(() => card.classList.remove('is-highlighted'), 1600);
  }

  function renderPins(visibleItems) {
    if (!map) return;
    map.geoObjects.removeAll();
    placemarks.clear();
    const ymaps = window['ymaps'];
    visibleItems.forEach((item) => {
      if (typeof item.lat !== 'number' || typeof item.lng !== 'number') return;
      const a = availability && availability.get(item.id);
      const preset = a ? (AVAIL_PRESET[a.status] || 'islands#redIcon') : 'islands#redIcon';
      const pm = new ymaps.Placemark([item.lat, item.lng], {
        hintContent: item.name,
        balloonContentHeader: esc(item.name),
        balloonContentBody: balloonHTML(item),
        balloonContentFooter: `<a href="${esc(item.href)}">Открыть карточку</a>`,
      }, { preset });
      pm.events.add('click', () => focusCard(item.id));
      placemarks.set(item.id, pm);
      map.geoObjects.add(pm);
    });
  }

  function annotateCards() {
    ITEMS.forEach((item) => {
      const card = listEl.querySelector(`[data-id="${item.id}"]`);
      if (!card) return;
      const slot = card.querySelector('[data-avail]');
      if (!slot) return;
      const a = availability && availability.get(item.id);
      if (!a) {
        slot.hidden = true;
        slot.textContent = '';
        slot.className = 'catalog-card-avail';
        return;
      }
      slot.hidden = false;
      slot.textContent = AVAIL_TEXT[a.status];
      slot.className = `catalog-card-avail catalog-card-avail--${a.status}`;
    });
  }

  function updateStatus(shown) {
    let text = `Показано ${shown} из ${ITEMS.length}`;
    if (availabilityError) text += ' · занятость недоступна, показаны все';
    else if (availabilityLabel) text += ` · период ${availabilityLabel}`;
    statusEl.textContent = text;
  }

  function apply() {
    const f = readFilters();
    let shown = 0;
    const visibleItems = [];
    ITEMS.forEach((item) => {
      const ok = matches(item, f);
      const card = listEl.querySelector(`[data-id="${item.id}"]`);
      if (card) card.hidden = !ok;
      if (ok) {
        shown++;
        visibleItems.push(item);
      }
    });
    if (emptyEl) emptyEl.hidden = shown !== 0;
    renderPins(visibleItems);
    updateStatus(shown);
  }

  function refreshAvailability() {
    const from = String(new FormData(form).get('from') || '');
    const toIncl = String(new FormData(form).get('to') || '');
    const clear = () => {
      availability = null;
      availabilityLabel = '';
      onlyFree.checked = false;
      onlyFree.disabled = true;
      if (legendEl) legendEl.hidden = true;
    };
    availabilityError = false;
    if (!from || !toIncl) {
      clear();
      annotateCards();
      apply();
      return;
    }
    if (from > toIncl) {
      clear();
      availabilityError = false;
      annotateCards();
      apply();
      statusEl.textContent = 'Начало периода должно быть раньше окончания';
      return;
    }
    const toExcl = shiftDate(toIncl, 1);
    fetch(`${API}/api/public/construction-availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(toExcl)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        availability = new Map();
        (data.items || []).forEach((c) => {
          availability.set(c.id, { status: aggregate(c.sides), sides: c.sides || [] });
        });
        availabilityLabel = `${fmtRu(from)}–${fmtRu(toIncl)}`;
        onlyFree.disabled = false;
        if (legendEl) legendEl.hidden = false;
        annotateCards();
        apply();
      })
      .catch(() => {
        clear();
        availabilityError = true;
        annotateCards();
        apply();
      });
  }

  function setupMap() {
    if (!mapEl) return;
    const points = ITEMS.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
    const setMsg = (t) => { mapEl.innerHTML = `<p class="map-placeholder">${esc(t)}</p>`; };
    if (!MAP.apiKey) {
      setMsg('Для карты нужен ключ Яндекс.Карт. Список конструкций доступен справа.');
      return;
    }
    if (!points.length) {
      setMsg('У опубликованных конструкций пока нет координат.');
      return;
    }
    const center = Array.isArray(MAP.center) && MAP.center.length === 2 ? MAP.center : [43.318, 45.698];
    const zoom = typeof MAP.zoom === 'number' ? MAP.zoom : 12;
    const boot = () => {
      const ymaps = window['ymaps'];
      ymaps.ready(() => {
        mapEl.innerHTML = '';
        map = new ymaps.Map(mapEl, {
          center, zoom, controls: ['zoomControl', 'fullscreenControl'],
        }, { suppressMapOpenBlock: true });
        apply();
      });
    };
    if (window['ymaps'] && window['ymaps'].ready) { boot(); return; }
    const script = document.createElement('script');
    script.src = 'https://api-maps.yandex.ru/2.1/?apikey=' + encodeURIComponent(MAP.apiKey) + '&lang=ru_RU';
    script.async = true;
    script.onload = boot;
    script.onerror = () => setMsg('Не удалось загрузить Яндекс.Карту. Список конструкций доступен справа.');
    document.head.appendChild(script);
  }

  // --- события ---
  form.addEventListener('input', (e) => {
    const name = e.target && e.target.name;
    if (name === 'from' || name === 'to') refreshAvailability();
    else apply();
  });
  form.addEventListener('change', (e) => {
    const name = e.target && e.target.name;
    if (name === 'from' || name === 'to') refreshAvailability();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      form.reset();
      refreshAvailability(); // сбросит занятость и перерисует
    });
  }
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-map-focus]');
    if (!btn) return;
    const id = btn.getAttribute('data-map-focus');
    const pm = placemarks.get(id);
    const item = ITEMS.find((i) => i.id === id);
    if (map && pm && item) {
      map.setCenter([item.lat, item.lng], Math.max(map.getZoom(), 15));
      pm.balloon.open();
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  updateStatus(ITEMS.length);
  setupMap();
  apply();
})();
