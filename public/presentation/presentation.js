(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const picker = document.querySelector('#slide-picker');
  const previous = document.querySelector('#previous');
  const next = document.querySelector('#next');
  const count = document.querySelector('#slide-count');
  const progress = document.querySelector('#slide-progress');
  const announcement = document.querySelector('#slide-announcement');
  const readingToggle = document.querySelector('#reading-toggle');
  const copyLink = document.querySelector('#copy-link');
  const shareStatus = document.querySelector('#share-status');
  let current = 0;
  let reading = false;
  let noticeTimer;

  slides.forEach((slide, index) => {
    const option = document.createElement('option');
    option.value = slide.id;
    option.textContent = `${String(index + 1).padStart(2, '0')}  ${slide.dataset.title}`;
    picker.append(option);
  });
  progress.max = slides.length;

  function render(focus = false) {
    slides.forEach((slide, index) => {
      slide.classList.toggle('is-active', index === current);
      slide.setAttribute('aria-hidden', String(!reading && index !== current));
    });
    const slide = slides[current];
    picker.value = slide.id;
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    count.textContent = `${current + 1} / ${slides.length}`;
    progress.value = current + 1;
    announcement.textContent = `Slide ${current + 1} of ${slides.length}: ${slide.dataset.title}`;
    document.title = `${slide.dataset.title} | Mail Flow presentation`;
    if (focus) {
      slide.querySelector('h2').focus({ preventScroll: true });
      if (reading) slide.scrollIntoView({ block: 'start', behavior: 'instant' });
      else window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  function goTo(index) {
    if (index < 0 || index >= slides.length || index === current) return;
    current = index;
    history.pushState(null, '', `#${slides[current].id}`);
    render(true);
  }

  function readLocation() {
    const index = slides.findIndex(slide => `#${slide.id}` === location.hash);
    current = index < 0 ? 0 : index;
    render();
  }

  previous.addEventListener('click', () => goTo(current - 1));
  next.addEventListener('click', () => goTo(current + 1));
  picker.addEventListener('change', () => goTo(slides.findIndex(slide => slide.id === picker.value)));
  window.addEventListener('popstate', readLocation);
  window.addEventListener('hashchange', readLocation);
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || reading) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const destinations = { ArrowRight: current + 1, PageDown: current + 1, ArrowLeft: current - 1, PageUp: current - 1, Home: 0, End: slides.length - 1 };
    if (Object.hasOwn(destinations, event.key)) {
      event.preventDefault();
      goTo(destinations[event.key]);
    }
  });
  readingToggle.addEventListener('click', () => {
    reading = !reading;
    document.body.classList.toggle('reading-mode', reading);
    readingToggle.setAttribute('aria-pressed', String(reading));
    readingToggle.textContent = reading ? 'Slide view' : 'View all';
    render();
    if (reading) slides[current].scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  });
  copyLink.addEventListener('click', async () => {
    clearTimeout(noticeTimer);
    try {
      await navigator.clipboard.writeText(location.href);
      shareStatus.textContent = 'Link copied. Ready to share with your committee.';
    } catch {
      shareStatus.textContent = 'Copy the address from your browser to share this presentation.';
    }
    noticeTimer = setTimeout(() => { shareStatus.textContent = ''; }, 5000);
  });

  document.body.classList.add('is-ready');
  document.querySelector('#deck-controls').hidden = false;
  readingToggle.hidden = false;
  copyLink.hidden = false;
  readLocation();
})();
