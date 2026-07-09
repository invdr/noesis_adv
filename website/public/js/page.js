// Лёгкий скрипт отдельных страниц (конструкция, новости): reveal-анимации при
// скролле, защита плейсхолдер-ссылок и модальная форма заявки по конструкции.
// Главная использует main.js; обвязка формы здесь повторяет его
// (public/js — отдельные бандлы без сборщика, поэтому код продублирован
// осознанно, как и setupReveal).
(() => {
  function setupReveal() {
    const els = Array.from(
      document.querySelectorAll('.reveal-up, .project-card, .news-card, .doc-card, .advantage'),
    );
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    );
    els.forEach((el) => io.observe(el));
  }

  let closeMobileMenu = () => {};
  function setupMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const burger = document.getElementById('burgerBtn');
    const closeBtn = document.getElementById('mobileCloseBtn');
    if (!menu || !burger || !closeBtn) return;

    const open = () => {
      menu.classList.add('open');
      setBackgroundInert(menu);
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    };
    const close = () => {
      menu.classList.remove('open');
      setBackgroundInert(null);
      document.body.style.overflow = '';
    };
    closeMobileMenu = close;
    burger.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  // ---------- телефон ----------
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

  // Делает фон недоступным для скринридера/таба, пока открыта модалка.
  function setBackgroundInert(activeEl) {
    Array.from(document.body.children).forEach((ch) => {
      if (ch.tagName === 'SCRIPT') return;
      if (activeEl && ch !== activeEl) ch.setAttribute('inert', '');
      else ch.removeAttribute('inert');
    });
  }

  // ---------- лид-форма ----------
  // Обвязка лид-формы: маска телефона, валидация, отправка в API и состояния
  // успеха/ошибки. Источник, сообщение и constructionId задаются через getContext().
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
      if (ctx.constructionId) payload.constructionId = ctx.constructionId;

      const API_URL = (typeof window !== 'undefined' && window.NOESIS_API_URL) || '';
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

  // Модальная форма заявки на странице конструкции: лид привязывается к ней
  // (source=project, constructionId из window.NOESIS_CONSTRUCTION).
  function setupLeadModal() {
    const modal = document.getElementById('leadModal');
    if (!modal) return;
    const form = document.getElementById('modalLeadForm');
    const nameInput = document.getElementById('modalLeadName');
    let lastTrigger = null;

    function open() {
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

    wireLeadForm(form, () => {
      const p = window.NOESIS_CONSTRUCTION || {};
      return {
        source: 'project',
        constructionId: p.id || undefined,
        message: p.name ? 'Заявка со страницы конструкции «' + p.name + '»' : undefined,
        onSuccess: () => setTimeout(close, 1500),
      };
    });

    document.querySelectorAll('[data-lead-open]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });
    });
    modal.querySelectorAll('[data-lead-close]').forEach((el) => {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }

  // Плейсхолдер-ссылки "#" не должны прыгать наверх.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileMenu();
  });

  document.addEventListener('DOMContentLoaded', () => {
    setupReveal();
    setupMobileMenu();
    setupLeadModal();
  });
})();
