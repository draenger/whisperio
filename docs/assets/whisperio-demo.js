/* Whisperio site — download detection, scroll reveal, nav, demo animation */
(function () {
  'use strict';

  /* ── accent switcher ── */
  (function accent() {
    var sw = document.getElementById('accent-switch');
    if (!sw) return;
    var saved = 'blue';
    try { var ls = localStorage.getItem('wh-accent-v2'); if (ls !== null) saved = ls; } catch (e) {}
    function apply(val) {
      if (val) document.body.setAttribute('data-accent', val);
      else document.body.removeAttribute('data-accent');
      sw.querySelectorAll('.sw').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-acc') === val); });
    }
    apply(saved);
    sw.addEventListener('click', function (e) {
      var b = e.target.closest('.sw'); if (!b) return;
      var val = b.getAttribute('data-acc');
      apply(val);
      try { localStorage.setItem('wh-accent-v2', val); } catch (e2) {}
    });
  })();

  /* ── nav scrolled state ── */
  var navInner = document.querySelector('.nav-inner');
  function onScroll() {
    if (!navInner) return;
    navInner.classList.toggle('scrolled', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── scroll reveal ── */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.14 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ── download detection (GitHub releases) ── */
  (async function setupDownload() {
    var ua = navigator.userAgent;
    var label = document.getElementById('dl-label');
    var btn = document.getElementById('dl-btn');
    var badge = document.getElementById('vbadge');
    var linksEl = document.getElementById('dl-links');
    var ctaLabel = document.getElementById('cta-dl-label');
    var ctaBtn = document.getElementById('cta-dl-btn');
    var platform = 'windows';
    if (/Mac/i.test(ua)) platform = 'mac';
    else if (/Linux/i.test(ua)) platform = 'linux';

    try {
      var res = await fetch('https://api.github.com/repos/draenger/whisperio/releases/latest');
      if (!res.ok) return;
      var data = await res.json();
      if (data.tag_name && badge) { badge.textContent = data.tag_name; badge.classList.add('show'); }
      var assets = data.assets || [];
      var platforms = [
        { ext: '.exe', label: 'Windows', match: null, plat: 'windows' },
        { ext: '-arm64.dmg', label: 'macOS (Apple Silicon)', match: null, plat: 'mac' },
        { ext: '.dmg', label: 'macOS (Intel)', match: null, plat: 'mac' },
        { ext: '.AppImage', label: 'Linux (AppImage)', match: null, plat: 'linux' },
        { ext: '_amd64.deb', label: 'Linux (.deb)', match: null, plat: 'linux' }
      ];
      for (var i = 0; i < platforms.length; i++)
        for (var j = 0; j < assets.length; j++)
          if (assets[j].name.endsWith(platforms[i].ext) && !platforms[i].match) platforms[i].match = assets[j];

      var primary = null;
      for (var k = 0; k < platforms.length; k++)
        if (platforms[k].plat === platform && platforms[k].match) { primary = platforms[k]; break; }

      if (primary) {
        if (btn) btn.href = primary.match.browser_download_url;
        if (ctaBtn) ctaBtn.href = primary.match.browser_download_url;
        if (label) label.textContent = 'Download for ' + primary.label;
        if (ctaLabel) ctaLabel.textContent = 'Download for ' + primary.label;
      }
      var links = [];
      for (var m = 0; m < platforms.length; m++)
        if (platforms[m].match && platforms[m] !== primary)
          links.push('<a href="' + platforms[m].match.browser_download_url + '">' + platforms[m].label + '</a>');
      if (links.length && linksEl) { linksEl.innerHTML = links.join(''); linksEl.style.display = 'flex'; }
    } catch (_) {}
  })();

  /* ── interactive demo ── */
  (function demo() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var t = document.getElementById('win-terminal');
      if (t) t.classList.add('active');
      var p = document.getElementById('term-prompt');
      if (p) p.innerHTML = '<div class="typed"><span class="chev">&gt;</span><span>add rate limiting to the /api/users endpoint, 100 req per minute</span></div>';
      document.querySelectorAll('.step').forEach(function (s) { s.classList.add('active'); });
      return;
    }

    var windows = [
      { id: 'terminal', phrase: 'add rate limiting to the /api/users endpoint, 100 requests per minute' },
      { id: 'notepad', phrase: 'We agreed to ship the new API by Friday and deprecate the v1 endpoints next quarter.' },
      { id: 'browser', phrase: 'electron global hotkey dictation app open source' }
    ];
    var wi = 0;
    var steps = [1, 2, 3, 4, 5].map(function (n) { return document.getElementById('step-' + n); });

    function setStep(i) { steps.forEach(function (s, idx) { if (s) s.classList.toggle('active', idx === i); }); }
    function clearSteps() { steps.forEach(function (s) { if (s) s.classList.remove('active'); }); }

    function flashKeys(id, dur, cb) {
      var el = document.getElementById('keys-' + id);
      if (el) el.classList.add('flash');
      setTimeout(function () { if (el) el.classList.remove('flash'); if (cb) cb(); }, dur);
    }
    function showPill(id, mode) {
      var pill = document.getElementById('pill-' + id);
      var dot = document.getElementById('pdot-' + id);
      var label = document.getElementById('plabel-' + id);
      var wave = document.getElementById('pwave-' + id);
      var spin = document.getElementById('pspin-' + id);
      if (mode === 'rec') {
        dot.className = 'pill-dot rec'; label.textContent = 'Listening\u2026';
        wave.style.display = 'flex'; spin.style.display = 'none';
      } else {
        dot.className = 'pill-dot proc'; label.textContent = 'Transcribing\u2026';
        wave.style.display = 'none'; spin.style.display = 'block';
      }
      pill.classList.add('show');
    }
    function hidePill(id) { var p = document.getElementById('pill-' + id); if (p) p.classList.remove('show'); }
    function activate(id) {
      document.querySelectorAll('.win').forEach(function (w) { w.classList.remove('active'); });
      var el = document.getElementById('win-' + id); if (el) el.classList.add('active');
    }
    function resetTerminal() {
      var p = document.getElementById('term-prompt');
      p.innerHTML = '<div class="typed"><span class="chev">&gt;</span><span></span><span class="caret"></span></div>';
    }
    function resetNotepad() { document.getElementById('note-text').innerHTML = '<span class="caret"></span>'; }
    function resetBrowser() { document.getElementById('b-search-text').innerHTML = '<span class="caret"></span>'; }

    function typeInto(container, structure, text, cb, speed) {
      container.innerHTML = '';
      var span = document.createElement('span');
      var caret = document.createElement('span'); caret.className = 'caret';
      if (structure === 'terminal') {
        var d = document.createElement('div'); d.className = 'typed';
        var chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '>';
        d.appendChild(chev); d.appendChild(span); d.appendChild(caret); container.appendChild(d);
      } else {
        container.appendChild(span); container.appendChild(caret);
      }
      var i = 0;
      var iv = setInterval(function () {
        if (i < text.length) { span.textContent += text[i]; i++; }
        else { clearInterval(iv); setTimeout(function () { caret.remove(); if (cb) cb(); }, 520); }
      }, speed || 26);
    }

    function run(win, cb) {
      var id = win.id;
      activate(id);
      if (id === 'terminal') resetTerminal();
      else if (id === 'notepad') resetNotepad();
      else resetBrowser();
      clearSteps();

      setTimeout(function () {
        setStep(0);
        flashKeys(id, 600, function () {
          setStep(1); showPill(id, 'rec');
          setTimeout(function () {
            setStep(2);
            flashKeys(id, 600, function () {
              setStep(3); showPill(id, 'proc');
              setTimeout(function () {
                hidePill(id); setStep(4);
                setTimeout(function () {
                  var target = id === 'terminal' ? document.getElementById('term-prompt')
                    : id === 'notepad' ? document.getElementById('note-text')
                    : document.getElementById('b-search-text');
                  typeInto(target, id === 'terminal' ? 'terminal' : 'plain', win.phrase, function () {
                    setTimeout(cb, 1100);
                  }, id === 'browser' ? 34 : 26);
                }, 320);
              }, 1500);
            });
          }, 2400);
        });
      }, 800);
    }

    function cycle() { var win = windows[wi % windows.length]; wi++; run(win, cycle); }
    resetTerminal();
    cycle();
  })();
})();
