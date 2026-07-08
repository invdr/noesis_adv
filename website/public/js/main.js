(() => {
  // Данные лендинга запечены из API на сборке и прокинуты через window.NOESIS_DATA
  // (см. website/src/pages/index.astro). Подписи (цена, комнатность, дата) уже
  // готовы во view-моделях — здесь только рендер 1:1 с дизайном.
  const DATA = (typeof window !== 'undefined' && window.NOESIS_DATA) || {};
  const PROJECTS = DATA.projects || [];   // {slug,name,address,img,isSoon,priceLabel,rooms,roomsLabel,href,tools,badges}
  const NEWS = DATA.news || [];           // {slug,tag,title,excerpt,img,date,body,href}
  const DOC_CATEGORIES = DATA.docs || []; // [{name,slug,projects:[{slug,name,address,img}]}]
  const API_BASE = (typeof window !== 'undefined' && window.NOESIS_API_URL) || '';

  // Документы ЖК тянем лениво по slug (на запуске их нет — блок скрыт).
  const docsCache = new Map();
  async function loadProjectDocs(slug) {
    if (docsCache.has(slug)) return docsCache.get(slug);
    let groups = [];
    try {
      const res = await fetch(API_BASE + '/api/public/documents/project/' + encodeURIComponent(slug));
      if (res.ok) groups = await res.json();
    } catch (_) { /* нет связи — покажем как «без документов» */ }
    docsCache.set(slug, groups);
    return groups;
  }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    const kb = bytes / 1024;
    if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : String(Math.round(kb))).replace('.', ',') + ' КБ';
    const mb = kb / 1024;
    return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace('.', ',') + ' МБ';
  }
  const DOC_TYPE = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  };
  function docMeta(doc) {
    if (doc.kind === 'link') return doc.caption || 'Внешняя ссылка';
    const t = DOC_TYPE[doc.asset && doc.asset.mimeType] || 'Файл';
    return doc.asset && typeof doc.asset.size === 'number' ? t + ' · ' + fileSize(doc.asset.size) : t;
  }
  function docHref(doc) {
    const url = doc.kind === 'link' ? doc.url : (doc.asset ? doc.asset.url : '#');
    // Защита href: пропускаем только относительные и http(s)-ссылки (бэкенд и так
    // ограничивает url документа, но рендер на innerHTML — дополнительный рубеж).
    return /^(https?:|\/)/i.test(url) ? url : '#';
  }

  // Экранирование строк из API перед вставкой в innerHTML/атрибуты (контент
  // редактируется в CRM — закрываем XSS-поверхность клиентского рендера).
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Атрибуты srcset/sizes для адаптивных картинок (если есть производные).
  function srcsetAttr(srcset, sizes) {
    return srcset ? ` srcset="${esc(srcset)}" sizes="${esc(sizes)}"` : '';
  }
  const CARD_SIZES = '(max-width:559px) 100vw, (max-width:899px) 50vw, 33vw';
  const NEWS_SIZES = '(max-width:719px) 100vw, 380px';
  const PROJECT_TOOL_CARDS = [
    {
      key: 'chessboardUrl',
      title: 'Интерактивная шахматка',
      label: 'Шахматка',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
    },
    {
      key: 'plansUrl',
      title: 'Планировки',
      label: 'Планировки',
      icon: '<path d="M3 4h18v16H3z"></path><path d="M9 4v9H3M21 13h-6v7"></path>',
    },
    {
      key: 'tour3dUrl',
      title: '3D тур',
      label: '3D-тур',
      icon: '<path d="M12 2l9 5v10l-9 5-9-5V7z"></path><path d="M12 12l9-5M12 12v10M12 12L3 7"></path>',
    },
  ];

  const docCardHTML = (doc) => `
    <a href="${esc(docHref(doc))}" class="doc-card" target="_blank" rel="noopener">
      <span class="doc-card-icon"><svg width="20" height="24" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H5a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"></path><path d="M14 2v7h7"></path></svg></span>
      <span class="doc-card-text"><span class="doc-card-name">${esc(doc.name)}</span><span class="doc-card-meta mono">${esc(docMeta(doc))}</span></span>
      <span class="doc-card-dl">↓</span>
    </a>`;

  const docCategoryCardHTML = (cat, i) => `
    <button type="button" class="doc-card" data-doc-category="${i}">
      <span class="doc-card-icon"><svg width="20" height="24" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H5a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"></path><path d="M14 2v7h7"></path></svg></span>
      <span class="doc-card-text"><span class="doc-card-name">${esc(cat.name)}</span><span class="doc-card-meta mono">Документы по каждому ЖК</span></span>
      <span class="doc-card-dl">→</span>
    </button>`;

  const docsProjectCardHTML = (p, i) => `
    <button type="button" class="project-card" data-docs-open="${i}">
      <span class="project-card-media">
        <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">
        <span class="project-card-shade"></span>
        <span class="project-card-name-row">
          <span class="project-card-name">${esc(p.name)}</span>
          <span class="project-card-arrow">→</span>
        </span>
      </span>
      <span class="project-card-body">
        <span class="project-card-addr">${esc(p.address)}</span>
      </span>
    </button>`;

  const projectBadgesHTML = (p) => {
    const items = [
      ...(p.isSoon ? [{ text: 'Скоро', bg: '', fg: '' }] : []),
      ...((p.badges || []).filter((b) => b && b.text)),
    ];
    if (!items.length) return '';
    return `<span class="project-card-badges">${items.map((b) => {
      const style = b.bg ? ` style="background:${esc(b.bg)};color:${esc(b.fg)}"` : '';
      return `<span class="project-badge${b.bg ? '' : ' project-badge-soon'}"${style}>${esc(b.text)}</span>`;
    }).join('')}</span>`;
  };

  const projectToolsHTML = (p) => {
    const tools = p.tools || {};
    const items = PROJECT_TOOL_CARDS
      .map((t) => ({ ...t, href: tools[t.key] }))
      .filter((t) => t.href);
    if (!items.length) return '';
    return `<div class="project-card-tools">${items.map((t) => `
      <a class="tool-btn" href="${esc(t.href)}" target="_blank" rel="noopener" title="${esc(t.title)}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${t.icon}</svg>
        <span>${esc(t.label)}</span>
      </a>`).join('')}</div>`;
  };

  const projectMediaHTML = (p) => {
    const inner = `
      <img src="${esc(p.img)}"${srcsetAttr(p.imgSrcset, CARD_SIZES)} alt="${esc(p.name)}" loading="lazy">
      <div class="project-card-shade"></div>
      ${projectBadgesHTML(p)}
      <div class="project-card-name-row">
        <span class="project-card-name">${esc(p.name)}</span>
        <span class="project-card-arrow">→</span>
      </div>`;
    return p.href
      ? `<a class="project-card-media" href="${esc(p.href)}">${inner}</a>`
      : `<span class="project-card-media project-card-media-static">${inner}</span>`;
  };

  const groupsHTML = (groups) => groups.map(g => `
    <div class="docs-category">
      <h2 class="h2 docs-category-title">${esc(g.category.name)}</h2>
      <div class="docs-grid">${g.documents.map(d => docCardHTML(d)).join('')}</div>
    </div>`).join('');

  function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    if (!grid) return;
    grid.innerHTML = PROJECTS.map((p, i) => `
      <div class="project-card" data-project-index="${i}">
        ${projectMediaHTML(p)}
        <div class="project-card-body">
          <div class="project-card-meta">
            <div class="project-card-addr-col">
              <span class="project-card-addr">${esc(p.address)}</span>
              <span class="project-card-rooms mono">${esc(p.rooms)}</span>
            </div>
            <span class="project-card-price">${esc(p.priceLabel)}</span>
          </div>
          ${projectToolsHTML(p)}
        </div>
      </div>`).join('');
  }

  const newsCardHTML = (n, i) => `
    <a class="news-card" href="${esc(n.href)}" data-news="${i}">
      <div class="news-card-media">
        <img src="${esc(n.img)}"${srcsetAttr(n.imgSrcset, NEWS_SIZES)} alt="${esc(n.title)}" loading="lazy">
        <div class="news-card-shade"></div>
        <span class="news-card-tag mono">${esc(n.tag)}</span>
      </div>
      <div class="news-card-body">
        <span class="news-card-title">${esc(n.title)}</span>
        <span class="news-card-desc">${esc(n.excerpt)}</span>
        <span class="news-card-link">Подробнее <span>→</span></span>
      </div>
    </a>`;

  function renderNews() {
    // Сколько новостей на главной — из настроек сайта (Веха 4.3), по умолчанию 3.
    const HOME_COUNT = DATA.newsHomeCount === 6 ? 6 : 3;
    const homeGrid = document.getElementById('newsGrid');
    const listGrid = document.getElementById('newsListGrid');
    if (!homeGrid || !listGrid) return;
    homeGrid.innerHTML = NEWS.slice(0, HOME_COUNT).map((n, i) => newsCardHTML(n, i)).join('');
    listGrid.innerHTML = NEWS.map((n, i) => newsCardHTML(n, i)).join('');
    // listing cards live in a hidden overlay — show them immediately
    listGrid.querySelectorAll('.news-card').forEach(c => c.classList.add('in-view'));

    // Карточки — настоящие ссылки на /news/<slug>; на клик открываем наложение.
    const open = (el, fromList) => (e) => {
      e.preventDefault();
      openArticle(parseInt(el.getAttribute('data-news'), 10), fromList);
    };
    homeGrid.querySelectorAll('[data-news]').forEach(el => el.addEventListener('click', open(el, false)));
    listGrid.querySelectorAll('[data-news]').forEach(el => el.addEventListener('click', open(el, true)));
  }

  function renderDocs() {
    const grid = document.getElementById('docsGrid');
    if (!grid || !DOC_CATEGORIES.length) return;
    grid.innerHTML = DOC_CATEGORIES.map((cat, i) => docCategoryCardHTML(cat, i)).join('');
    grid.querySelectorAll('[data-doc-category]').forEach(el => {
      el.addEventListener('click', () => {
        openDocsPage(parseInt(el.getAttribute('data-doc-category'), 10));
      });
    });
  }

  // ---------- nav scroll state ----------
  function setupNavScroll() {
    const nav = document.getElementById('nav');
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      nav.classList.toggle('scrolled', y > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- hero parallax ----------
  function setupHeroParallax() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = document.getElementById('heroParallax');
    const onScroll = () => {
      const y = Math.min(window.scrollY || 0, 1100);
      target.style.transform = `scale(1.1) translateY(${y * 0.16}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- mobile menu ----------
  let closeMobileMenu = () => {};
  function setupMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const open = () => { menu.classList.add('open'); setBackgroundInert(menu); document.body.style.overflow = 'hidden'; document.getElementById('mobileCloseBtn').focus(); };
    const close = () => { menu.classList.remove('open'); setBackgroundInert(null); document.body.style.overflow = ''; };
    closeMobileMenu = close;
    document.getElementById('burgerBtn').addEventListener('click', open);
    document.getElementById('mobileCloseBtn').addEventListener('click', close);
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  }

  // ---------- reveal on scroll ----------
  function setupReveal() {
    const els = Array.from(document.querySelectorAll('.reveal-up, .project-card, .news-card, .doc-card, .advantage'));
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
  }

  // ---------- count-up stats ----------
  function setupCounters() {
    const els = Array.from(document.querySelectorAll('.stat-count'));
    const animate = (el) => {
      const target = parseFloat(el.getAttribute('data-target'));
      const grouped = el.getAttribute('data-group') === '1';
      const dur = 1500, start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(target * eased);
        el.textContent = grouped ? val.toLocaleString('ru-RU') : String(val);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!('IntersectionObserver' in window)) { els.forEach(animate); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { animate(entry.target); io.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    els.forEach(el => io.observe(el));
  }

  // ---------- overlay helpers ----------
  // Keep keyboard/screen-reader focus inside the open overlay: make every
  // other top-level element inert. Pass null to release.
  function setBackgroundInert(activeEl) {
    Array.from(document.body.children).forEach(ch => {
      if (ch.tagName === 'SCRIPT') return;
      if (activeEl && ch !== activeEl) ch.setAttribute('inert', '');
      else ch.removeAttribute('inert');
    });
  }

  // ---------- docs page ----------
  let lastDocsFocusedEl = null;

  function docsPageEl() { return document.getElementById('docsPage'); }

  // Список ЖК выбранной категории (категория → ЖК с документами в ней).
  function openDocsCategory(categoryIndex) {
    const cat = DOC_CATEGORIES[categoryIndex];
    const grid = document.getElementById('docsProjectGrid');
    grid.innerHTML = cat.projects.map((p, i) => docsProjectCardHTML(p, i)).join('');
    grid.querySelectorAll('.project-card').forEach(c => c.classList.add('in-view'));
    grid.querySelectorAll('[data-docs-open]').forEach(el => {
      el.addEventListener('click', () =>
        openDocsProject(cat.projects[parseInt(el.getAttribute('data-docs-open'), 10)]));
    });
    document.getElementById('docsPageTitle').textContent = 'Выберите жилой комплекс';
    document.getElementById('docsPageDetail').hidden = true;
    document.getElementById('docsPageList').hidden = false;
    docsPageEl().scrollTop = 0;
  }

  // Детальный список: документы ЖК, сгруппированные по категориям.
  async function openDocsProject(ref) {
    const groups = await loadProjectDocs(ref.slug);
    document.getElementById('docsProjectName').textContent = ref.name;
    const categories = document.getElementById('docsCategories');
    categories.innerHTML = groupsHTML(groups);
    categories.querySelectorAll('.doc-card').forEach(c => c.classList.add('in-view'));
    document.getElementById('docsPageList').hidden = true;
    document.getElementById('docsPageDetail').hidden = false;
    docsPageEl().scrollTop = 0;
  }

  function backToDocsList() {
    const list = document.getElementById('docsProjectGrid');
    if (!list || !list.childElementCount) { closeDocsPage(); return; }
    document.getElementById('docsPageDetail').hidden = true;
    document.getElementById('docsPageList').hidden = false;
    docsPageEl().scrollTop = 0;
  }

  function openDocsPageShell() {
    const page = docsPageEl();
    lastDocsFocusedEl = document.activeElement;
    page.classList.add('open');
    setBackgroundInert(page);
    document.body.style.overflow = 'hidden';
  }

  function openDocsPage(categoryIndex) {
    if (!docsPageEl()) return;
    openDocsPageShell();
    openDocsCategory(categoryIndex != null ? categoryIndex : 0);
    document.getElementById('docsPageBackBtn').focus();
  }

  function closeDocsPage() {
    const page = docsPageEl();
    if (!page) return;
    page.classList.remove('open');
    setBackgroundInert(null);
    document.body.style.overflow = '';
    if (lastDocsFocusedEl && typeof lastDocsFocusedEl.focus === 'function') lastDocsFocusedEl.focus();
    lastDocsFocusedEl = null;
  }

  function setupDocsPage() {
    if (!docsPageEl()) return;
    document.getElementById('docsPageBackBtn').addEventListener('click', closeDocsPage);
    document.getElementById('docsDetailBackBtn').addEventListener('click', backToDocsList);
  }

  // ---------- news list + article overlays ----------
  let articleReturn = 'home';
  let lastNewsFocus = null;

  function openNewsList() {
    lastNewsFocus = lastNewsFocus || document.activeElement;
    const p = document.getElementById('newsListPage');
    p.classList.add('open');
    setBackgroundInert(p);
    document.body.style.overflow = 'hidden';
    p.scrollTop = 0;
    document.getElementById('newsListBackBtn').focus();
  }
  function closeNewsList() {
    document.getElementById('newsListPage').classList.remove('open');
    setBackgroundInert(null);
    document.body.style.overflow = '';
    if (lastNewsFocus && typeof lastNewsFocus.focus === 'function') lastNewsFocus.focus();
    lastNewsFocus = null;
  }

  function openArticle(index, fromList) {
    const n = NEWS[index];
    if (!fromList) lastNewsFocus = document.activeElement;
    articleReturn = fromList ? 'list' : 'home';
    const aImg = document.getElementById('articleHeroImg');
    aImg.src = n.img;
    aImg.alt = n.title;
    if (n.imgSrcset) { aImg.srcset = n.imgSrcset; aImg.sizes = '100vw'; }
    else aImg.removeAttribute('srcset');
    document.getElementById('articleTag').textContent = n.tag;
    document.getElementById('articleTitle').textContent = n.title;
    document.getElementById('articleDate').textContent = n.date || '';
    document.getElementById('articleContent').innerHTML = ((n.body && n.body.length ? n.body : [n.excerpt]).map(p => `<p>${esc(p)}</p>`)).join('');
    document.getElementById('newsListPage').classList.remove('open');
    const p = document.getElementById('articlePage');
    p.classList.add('open');
    setBackgroundInert(p);
    document.body.style.overflow = 'hidden';
    p.scrollTop = 0;
    document.getElementById('articleBackBtn').focus();
  }
  function closeArticle() {
    document.getElementById('articlePage').classList.remove('open');
    if (articleReturn === 'list') {
      openNewsList();
    } else {
      setBackgroundInert(null);
      document.body.style.overflow = '';
      if (lastNewsFocus && typeof lastNewsFocus.focus === 'function') lastNewsFocus.focus();
      lastNewsFocus = null;
    }
  }

  function setupNewsPages() {
    const allBtn = document.getElementById('newsAllBtn');
    if (allBtn) allBtn.addEventListener('click', openNewsList);
    const listBack = document.getElementById('newsListBackBtn');
    if (!listBack) return;
    listBack.addEventListener('click', closeNewsList);
    document.getElementById('articleBackBtn').addEventListener('click', closeArticle);
    document.getElementById('articleCtaBack').addEventListener('click', () => {
      document.getElementById('articlePage').classList.remove('open');
      openNewsList();
    });
  }

  // ---------- phone mask ----------
  function formatPhone(value) {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (!digits.startsWith('7')) digits = '7' + digits;
    digits = digits.slice(0, 11);
    let out = '+7';
    if (digits.length > 1) out += ' (' + digits.slice(1, 4);
    if (digits.length >= 4) out += ') ' + digits.slice(4, 7);
    if (digits.length >= 7) out += '-' + digits.slice(7, 9);
    if (digits.length >= 9) out += '-' + digits.slice(9, 11);
    return out;
  }

  function setupPhoneInput(input) {
    input.addEventListener('input', () => {
      input.value = formatPhone(input.value);
    });
    input.addEventListener('focus', () => {
      if (!input.value) input.value = '+7 (';
    });
  }

  function isPhoneComplete(input) {
    return input.value.replace(/\D/g, '').length === 11;
  }

  // ---------- lead forms (hero + modal) ----------
  var API_URL = (typeof window !== 'undefined' && window.NOESIS_API_URL) || '';

  // Общая обвязка лид-формы: маска телефона, валидация, отправка в API и
  // состояния успеха/ошибки. Источник и сообщение задаются на момент отправки
  // через getContext() — так одна функция обслуживает hero и модальную форму.
  function wireLeadForm(form, getContext) {
    const success = form.querySelector('.hero-card-success');
    const consent = form.querySelector('input[name="consent"]');
    const consentLabel = form.querySelector('.hero-card-consent');
    const phone = form.querySelector('input[name="phone"]');
    const submitBtn = form.querySelector('[type="submit"]');
    setupPhoneInput(phone);
    if (consent) consent.addEventListener('change', () => consentLabel.classList.remove('error'));
    // Ссылка на политику внутри <label> не должна переключать чекбокс согласия.
    if (consentLabel) {
      const policyLink = consentLabel.querySelector('a');
      if (policyLink) policyLink.addEventListener('click', (e) => e.stopPropagation());
    }
    phone.addEventListener('input', () => phone.setCustomValidity(''));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (consent && !consent.checked) consentLabel.classList.add('error');
      phone.setCustomValidity(isPhoneComplete(phone) ? '' : 'Введите номер телефона полностью');
      if (!form.checkValidity()) {
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      const ctx = (getContext && getContext()) || {};
      const payload = {
        name: form.elements.name.value.trim(),
        phone: phone.value,
        consent: true,
        source: ctx.source || 'hero_form',
        // honeypot: скрытое поле; у человека пусто, боты заполняют
        company: form.elements.company ? form.elements.company.value : '',
      };
      if (ctx.message) payload.message = ctx.message;

      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch(API_URL + '/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let msg = 'Не удалось отправить заявку, попробуйте позже';
          try {
            const data = await res.json();
            if (data && data.error) {
              if (data.error.fields && data.error.fields.phone) msg = data.error.fields.phone;
              else if (data.error.message) msg = data.error.message;
            }
          } catch (_) { /* ignore parse errors */ }
          phone.setCustomValidity(msg);
          phone.reportValidity();
          return;
        }
      } catch (_) {
        phone.setCustomValidity('Нет связи с сервером, попробуйте позже');
        phone.reportValidity();
        return;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }

      // Цель Метрики «отправлена заявка» с источником (Веха 4.3).
      if (window.ymGoal) window.ymGoal('lead', { source: payload.source });

      form.reset();
      if (success) {
        success.hidden = false;
        clearTimeout(success._t);
        success._t = setTimeout(() => { success.hidden = true; }, 6000);
      }
      if (ctx.onSuccess) ctx.onSuccess();
    });
  }

  function setupLeadForm() {
    const hero = document.getElementById('heroLeadForm');
    if (hero) wireLeadForm(hero, () => ({ source: 'hero_form' }));
  }

  // ---------- lead modal (contacts) ----------
  function setupLeadModal() {
    const modal = document.getElementById('leadModal');
    if (!modal) return;
    const form = document.getElementById('modalLeadForm');
    const nameInput = document.getElementById('modalLeadName');
    let lastTrigger = null;
    let currentSource = 'contacts';
    let currentMessage = '';

    function open(source) {
      currentSource = source || 'contacts';
      currentMessage = '';
      lastTrigger = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('lead-modal-open');
      setBackgroundInert(modal);
      if (nameInput) nameInput.focus();
    }
    function close() {
      modal.hidden = true;
      document.body.classList.remove('lead-modal-open');
      setBackgroundInert(null);
      if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    }
    modal._close = () => { if (!modal.hidden) close(); };

    wireLeadForm(form, () => ({
      source: currentSource,
      message: currentMessage || undefined,
      onSuccess: () => setTimeout(close, 1500),
    }));

    document.querySelectorAll('[data-lead-open]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        open(btn.getAttribute('data-lead-open'));
      });
    });
    modal.querySelectorAll('[data-lead-close]').forEach((el) => {
      el.addEventListener('click', close);
    });
  }

  // ---------- global keyboard & placeholder-link guards ----------
  function setupGlobalHandlers() {
    // prevent placeholder "#" links from jumping to top
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href="#"]');
      if (a) e.preventDefault();
    });
    // Escape closes the open overlay / mobile menu
    const isOpen = (id) => {
      const el = document.getElementById(id);
      return !!el && el.classList.contains('open');
    };
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const leadModal = document.getElementById('leadModal');
      if (leadModal && !leadModal.hidden) { leadModal._close(); return; }
      if (isOpen('articlePage')) closeArticle();
      else if (isOpen('newsListPage')) closeNewsList();
      else if (isOpen('docsPage')) closeDocsPage();
      else if (isOpen('mobileMenu')) closeMobileMenu();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderCatalog();
    renderNews();
    renderDocs();
    setupNavScroll();
    setupHeroParallax();
    setupMobileMenu();
    setupReveal();
    setupCounters();
    setupNewsPages();
    setupDocsPage();
    setupLeadForm();
    setupLeadModal();
    setupGlobalHandlers();
  });
})();
