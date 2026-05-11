// SPOTS web renderer — single-file SPA mirroring the Figma layout.
// Flow: welcome → home → (past-problems | body-parts | activities | feelings | search)
//      symptoms picked → modal "question focus" (frequency/severity/interference;
//      feelings use only frequency/severity — see `questionIdsForSymptom`).
// Symptoms in the Problem Station can be clicked to re-open the modal in
// edit mode. Logout IS the "finish session" gesture — it flips the
// completion flag and flushes selected symptoms into pastProblemsArchive
// (see `logout()`).

(function () {
  const D = window.SPOTS_DATA;
  const root = document.getElementById('app');

  const state = {
    // 'en' | 'es'. Wired to the footer language toggle. Production fetches
    // Spanish from REDCap; the tutorial loads Spanish from `translations.csv`
    // at init via `loadTranslations()` and reads it through `t(en)`.
    language: 'en',
    // Set true after the user dismisses the welcome intro popup. The popup
    // only shows on the first render of the welcome screen in session 1.
    // We don't persist this across page reloads — refresh = restart the
    // whole tutorial, including the intro.
    introDismissed: false,
    // Set true after the user dismisses the "log in again" popup on the
    // session-2 login screen. Same no-persistence rule.
    loginPromptDismissed: false,
    screen: 'welcome',
    selected: [],
    currentBodyPart: null,
    currentActivity: null,
    currentSearchQuery: '',
    pendingSymptom: null,
    questionStep: 0,
    // When editing an already-selected symptom (clicked from the Problem
    // Station), the question modal points `pendingSymptom` AT the live entry
    // in `state.selected` so every answer write persists immediately — no
    // "Save" step. This id flags edit mode for the modal and is cleared on
    // close. See `openEditSymptom()` / `questionModal().setAnswer()`.
    editingSymptomId: null,
    pastProblemsArchive: [],
    showBodyBack: false,
    tutorialDockOpen: false,
    activeHintKey: null,
    // Account dropdown (top-right header). Click avatar to toggle; click
    // outside or Esc to close. See userMenu() / logout().
    userMenuOpen: false,
    // Tracks which tutorial session we're in. 1 = first session,
    // 2 = after logout/login. Past-problems archive carries across sessions
    // but the in-progress `selected` list does not.
    session: 1,
    // Identity shown in the user dropdown. Pure in-memory, no auth.
    user: { name: 'User' },
    // Tracks symptoms finalized in the CURRENT session (resets on logout /
    // session start). Powers the session-2 "Reported a problem" step which
    // needs to detect a NEW report after returning, regardless of what carries
    // over in pastProblemsArchive.
    sessionProblemsLogged: 0,
    tutorialFlags: {
      // Session 1 flags. Per-page "Pick a … symptom" milestones are sticky —
      // they flip true when a symptom from that screen is finalized through
      // the question modal and stay true even if the user later deletes the
      // symptom. Earlier the checks read directly from `state.selected`,
      // which meant deleting the only Body Parts symptom would un-check
      // that step.
      pickedBodyParts: false,
      pickedActivities: false,
      pickedFeelings: false,
      deletedProblem: false,
      completedSession: false,
      usedSearch: false,
      viewedPastProblems: false,
      // Session 2 flags — namespaced so we don't conflict with reset values
      // when the user logs back in. Reset on logout in `logout()`.
      session2VisitedReview: false,
      session2AddedPastProblem: false,
      session2Completed: false,
      // `completedSession` / `session2Completed` flip in `logout()` — the
      // logout action IS the session-finish gesture. They also trigger the
      // pastProblemsArchive upsert in the same step.
    },
  };

  // ----------------------------- session helpers -----------------------------
  // Returns the checklist (label + done) for whichever session is active. Items
  // are kept minimal and SESSION-SPECIFIC: session 1 walks the full discovery
  // flow (body parts, activities, feelings, search, etc.); session 2 focuses
  // on the returning-user flow built around past problems.
  function tutorialProgressItems() {
    if (state.session === 2) return session2ProgressItems();
    return session1ProgressItems();
  }

  function session1ProgressItems() {
    const f = state.tutorialFlags;
    // Each per-page pick is a sticky tutorial flag — set when a symptom from
    // that screen is finalized through the question modal (see `next()` in
    // `questionModal()`), never cleared until logout. Deleting a symptom
    // from the Problem Station does NOT un-check the milestone.
    return [
      { key: 'welcome',      label: t('Welcome to SPOTS'),                          done: true },
      { key: 'body-parts',   label: t('Pick a Body Parts symptom'), done: f.pickedBodyParts },
      { key: 'activities',   label: t('Pick an Activities symptom'),    done: f.pickedActivities },
      { key: 'feelings',     label: t('Pick a Feelings symptom'),      done: f.pickedFeelings },
      { key: 'search',       label: t('Use Search'),                                         done: f.usedSearch },
      { key: 'past-problems',label: t('View Past Problems'),                   done: f.viewedPastProblems },
      { key: 'delete',       label: t('Delete a problem'),                         done: f.deletedProblem },
      { key: 'completed',    label: t('Logout'),                                          done: f.completedSession },
    ];
  }

  function session2ProgressItems() {
    const f = state.tutorialFlags;
    return [
      { key: 'past-problems', label: t('Add a past problem'),    done: f.session2AddedPastProblem },
      { key: 'report',        label: t('Report a new problem'),    done: state.sessionProblemsLogged > 0 },
      { key: 'reviewed',      label: t('Edit your problems'),             done: f.session2VisitedReview },
      { key: 'completed',     label: t('Logout'),                               done: f.session2Completed },
    ];
  }

  // True when every step in the active session's checklist is `done`, EXCEPT
  // the "Completed a session" / "Finish session 2" step itself. Logging out
  // IS what finishes the session — so the gating predicate ignores that
  // terminal step. Clicking Logout then flips `completedSession` (and upserts
  // pastProblemsArchive) as part of the logout action, so by the time the
  // user logs in for session 2 the session-1 checklist is fully done.
  function isCurrentSessionComplete() {
    const items = tutorialProgressItems().filter(i => i.key !== 'completed');
    return items.length > 0 && items.every(i => i.done);
  }

  // ----------------------------- helpers -----------------------------
  function uid() { return Math.random().toString(36).slice(2, 10); }

  function go(screen, opts = {}) {
    state.screen = screen;
    Object.assign(state, opts);
    // Tutorial milestone flags. Session 1 has a "View Past Problems" step that
    // counts as soon as the user lands on the screen. Session 2's equivalent
    // step is "Add a past problem" — that's checked off in the items list by
    // looking at `state.selected`, so no flag write is needed here. The
    // Session 2's "Edit your problems" milestone (`session2VisitedReview`)
    // is set in `openEditSymptom()`. Session 1 has no edit step.
    if (screen === 'past-problems' && state.session !== 2) {
      state.tutorialFlags.viewedPastProblems = true;
    }
    // Any route change closes the account dropdown so it doesn't persist
    // visually onto a new screen.
    state.userMenuOpen = false;
    // `usedSearch` is intentionally NOT set on entering the search screen;
    // it flips to true only after a search-originated symptom is finalized
    // (see the question-modal `next()` finalize path).
    render();
  }

  // Ends the current session ("logout"). Clears in-progress symptom-picking
  // state and the per-session report counter, but PRESERVES pastProblemsArchive
  // (carries into Session 2) and the session-1 tutorialFlags (the dock keeps
  // its session-1 context). Also resets session-2 flags so they start fresh
  // when the user logs back in. Routes to the login screen.
  function logout() {
    // Logout IS the "finish session" gesture: flip the completion flag for
    // the active session and flush whatever's in the cart to
    // pastProblemsArchive so session 2 sees session 1's work. Done before
    // we clear state.selected.
    const isS2 = state.session === 2;
    if (isS2) state.tutorialFlags.session2Completed = true;
    else state.tutorialFlags.completedSession = true;
    if (state.selected.length > 0) {
      const today = new Date();
      const dateLabel = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      state.selected.forEach(s => {
        const existing = state.pastProblemsArchive.find(p =>
          p.name === s.name && p.subcategory === s.subcategory);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.dateLabel = dateLabel;
        } else {
          state.pastProblemsArchive.push({
            name: s.name,
            category: s.category,
            subcategory: s.subcategory,
            count: 1,
            dateLabel,
          });
        }
      });
    }
    state.selected = [];
    state.pendingSymptom = null;
    state.questionStep = 0;
    state.editingSymptomId = null;
    state.currentBodyPart = null;
    state.currentActivity = null;
    state.currentSearchQuery = '';
    state.showBodyBack = false;
    state.tutorialDockOpen = false;
    state.activeHintKey = null;
    state.userMenuOpen = false;
    state.sessionProblemsLogged = 0;
    // Reset session-2 flags only when logging out from session 1, so the
    // session-2 checklist starts fresh. Logging out from session 2 (rare —
    // the normal session-2 terminus is "Finish Tutorial") leaves the flag
    // we just set above intact.
    if (!isS2) {
      state.tutorialFlags.session2VisitedReview = false;
      state.tutorialFlags.session2AddedPastProblem = false;
      state.tutorialFlags.session2Completed = false;
    }
    go('login');
  }

  // Tutorial fast-forward: jump from session 1 → session 2 (welcome-back), or
  // session 2 → tutorial-complete. Wired to the "Emergency Information" Quick
  // Link in the footer as a demo shortcut. Flushes the in-progress cart into
  // pastProblemsArchive (so session 2 sees any work the demoer did) and
  // clears in-progress state — same lifecycle as logout() except: skips the
  // login screen, and does NOT set the current session's `completedSession`
  // flag (the user skipped, they didn't actually log out).
  function skipToNextSession() {
    const isS2 = state.session === 2;
    if (state.selected.length > 0) {
      const today = new Date();
      const dateLabel = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      state.selected.forEach(s => {
        const existing = state.pastProblemsArchive.find(p =>
          p.name === s.name && p.subcategory === s.subcategory);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.dateLabel = dateLabel;
        } else {
          state.pastProblemsArchive.push({
            name: s.name,
            category: s.category,
            subcategory: s.subcategory,
            count: 1,
            dateLabel,
          });
        }
      });
    }
    state.selected = [];
    state.pendingSymptom = null;
    state.questionStep = 0;
    state.editingSymptomId = null;
    state.currentBodyPart = null;
    state.currentActivity = null;
    state.currentSearchQuery = '';
    state.showBodyBack = false;
    state.tutorialDockOpen = false;
    state.activeHintKey = null;
    state.userMenuOpen = false;
    state.sessionProblemsLogged = 0;
    if (isS2) {
      state.tutorialFlags.session2Completed = true;
      go('tutorial-complete');
    } else {
      state.session = 2;
      state.tutorialFlags.session2VisitedReview = false;
      state.tutorialFlags.session2AddedPastProblem = false;
      state.tutorialFlags.session2Completed = false;
      go('welcome-back');
    }
  }

  function isSelected(category, subcategory, name) {
    return state.selected.some(s =>
      s.category === category && s.subcategory === subcategory && s.name === name);
  }

  function findSelected(category, subcategory, name) {
    return state.selected.find(s =>
      s.category === category && s.subcategory === subcategory && s.name === name);
  }

  function toggleSymptom(category, subcategory, contextLabel, name) {
    const existing = findSelected(category, subcategory, name);
    if (existing) {
      state.selected = state.selected.filter(s => s !== existing);
      render();
      return;
    }
    state.pendingSymptom = {
      id: uid(), name, category, subcategory, contextLabel,
      answers: {}, originScreen: state.screen,
      originCtx: { bodyPart: state.currentBodyPart, activity: state.currentActivity, query: state.currentSearchQuery },
      // Date the symptom was first reported. Displayed in the Problem Station
      // row as MM/DD/YYYY. Stored as a plain Date so we can re-format if needed.
      dateAdded: new Date(),
    };
    state.questionStep = 0;
    render();
  }

  // Per-symptom required question ids. Mirrors the production app's
  // QUESTION_PROGRESSION_RULES in app/_lib/services/pro-ctcae/question-service.ts:
  //   body_parts / activities / search → frequency, severity, interference
  //   feelings                          → frequency, severity (no interference)
  // The desktop build doesn't have a `prior_problems` category at runtime
  // (past problems are reported into one of the above categories via search /
  // direct picks), so we don't need that branch here.
  //
  // Single source of truth — used by questionModal() (which questions to ask
  // and how many dots) and problemStation() (answer dots per row).
  function questionIdsForSymptom(sym) {
    if (sym && sym.category === 'feelings') return ['frequency', 'severity'];
    return ['frequency', 'severity', 'interference'];
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // i18n. Spanish translations live in `translations.csv` next to index.html.
  // The CSV is fetched on init (see bottom of file) and parsed into the
  // `translations` map below. Until it loads, `t(en)` returns English; once
  // loaded, switching the footer toggle to Español flips every visible string.
  //
  // `t(en)`           — look up `en` in the map, fall back to `en` itself
  // `t(en, fallback)` — same, but use `fallback` if the CSV doesn't have a
  //                     translation for `en`. Used for dynamic strings built
  //                     with interpolation (question prompts, aria labels)
  //                     where the exact `en` string varies per render and
  //                     can't be a stable CSV key.
  //
  // CSV format: three columns — `en`, `es`, `context` (context is for
  // translator notes; ignored at runtime).
  const translations = new Map();
  let translationsLoaded = false;

  function t(en, fallbackEs) {
    if (state.language !== 'es' || !en) return en || '';
    const fromCsv = translations.get(en);
    if (fromCsv) return fromCsv;
    return fallbackEs || en;
  }
  // Data labels (body parts, activities, feelings) — keyed by `item.label`.
  function tLabel(item) {
    if (!item) return '';
    return t(item.label || item.name || '');
  }
  // Kept for clarity at call sites; same lookup as `t(name)`.
  function tSymptom(name) { return t(name); }
  function tOption(label) { return t(label); }

  function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'es') return;
    state.language = lang;
    try {
      document.documentElement.setAttribute('lang', lang);
      document.title = lang === 'es' ? 'Tutorial SPOTS' : 'SPOTS Tutorial';
    } catch (e) { /* SSR safety */ }
    render();
  }

  // Lightweight CSV parser — handles RFC 4180 double-quoted fields with
  // escaped quotes (`""`). Returns array of rows; each row is array of strings.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function loadTranslations() {
    return fetch('./translations.csv', { cache: 'no-cache' })
      .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(text => {
        // Strip UTF-8 BOM if present — Excel and some editors add one when
        // saving CSV, which would corrupt the first header column name and
        // break en/es column detection.
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const rows = parseCsv(text);
        // First row is header. Find column indexes by name so column order can
        // be reordered in the spreadsheet without breaking the runtime.
        if (!rows.length) return;
        const header = rows[0].map(h => h.trim().toLowerCase());
        const enIdx = header.indexOf('en');
        const esIdx = header.indexOf('es');
        if (enIdx < 0 || esIdx < 0) {
          console.warn('translations.csv: missing en/es column');
          return;
        }
        for (let r = 1; r < rows.length; r++) {
          const en = (rows[r][enIdx] || '').trim();
          const es = (rows[r][esIdx] || '').trim();
          if (en && es) translations.set(en, es);
        }
        translationsLoaded = true;
      })
      .catch(err => {
        console.warn('translations.csv failed to load — falling back to English:', err);
      });
  }

  // Real Figma SVG nav icons (each already includes its colored circle background)
  const NAV_ICONS = {
    'past-problems': './assets/SPOTSNavBarIcons/SPOTS-Prior-Problem-Icon_02.svg',
    'body-parts':    './assets/SPOTSNavBarIcons/SPOTS-Body-Parts-Icon_02.svg',
    'activities':    './assets/SPOTSNavBarIcons/SPOTS-Activities-Icon_02.svg',
    'feelings':      './assets/SPOTSNavBarIcons/SPOTS-Feelings-Icon_02.svg',
    'search':        './assets/SPOTSNavBarIcons/SPOTS-Search-Icon_02.svg',
    'report':        './assets/SPOTSNavBarIcons/SPOTS-Reports-Icon_01.svg',
  };

  // ----------------------------- header -----------------------------
  function logoCorner() {
    return el('div', {
      class: 'logo-corner',
      role: 'link',
      tabindex: '0',
      'aria-label': 'SPOTS — go to home',
      onclick: () => go('home'),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('home'); }
      },
    },
      el('img', { class: 'curve',     src: './assets/Spots-curve.svg',                 alt: '' }),
      el('img', { class: 'confetti',  src: './assets/Spot_Assets-01.svg',              alt: '' }),
      el('img', { class: 'word-logo', src: './assets/Spots-Logo-UpdatedBG-white.svg',  alt: 'SPOTS' }),
    );
  }

  function navButton(key, label, screen, isActive) {
    return el('button', {
      class: 'nav-item' + (isActive ? ' is-active' : ''),
      'aria-current': isActive ? 'page' : null,
      onclick: () => go(screen),
    },
      el('img', { class: 'nav-icon', src: NAV_ICONS[key], alt: '' }),
      el('span', { class: 'label' }, label),
    );
  }

  function siteHeader() {
    const activeKey = ({
      'home': null,
      'past-problems': 'past-problems',
      'body-parts': 'body-parts',
      'body-part-detail': 'body-parts',
      'activities': 'activities',
      'activity-detail': 'activities',
      'feelings': 'feelings',
      'search': 'search',
    })[state.screen];

    return el('header', { class: 'site-header' },
      logoCorner(),
      el('nav', { class: 'top-nav' },
        navButton('past-problems', t('Past Problems'), 'past-problems', activeKey === 'past-problems'),
        navButton('body-parts',    t('Body Parts'),       'body-parts',    activeKey === 'body-parts'),
        navButton('activities',    t('Activities'),             'activities',    activeKey === 'activities'),
        navButton('feelings',      t('Feelings'),              'feelings',      activeKey === 'feelings'),
        navButton('search',        t('Search'),                      'search',        activeKey === 'search'),
        el('button', {
          class: 'nav-item',
          title: t('Report (not included in this tutorial build)'),
          onclick: () => alert(t('Reports are part of the full SPOTS site. This tutorial build focuses on the symptom-reporting flow and does not include the reporting view.')),
        },
          el('img', { class: 'nav-icon', src: NAV_ICONS['report'], alt: '' }),
          el('span', { class: 'label' }, t('Report')),
        ),
      ),
      el('div', { class: 'user-area' },
        el('button', {
          class: 'icon-btn settings-btn',
          title: t('Settings (not included in this tutorial build)'),
          'aria-label': t('Settings'),
          onclick: () => alert(t('Settings are part of the full SPOTS site. This tutorial build focuses on the symptom-reporting flow and does not include the settings view.')),
          // Inline FontAwesome-style gear so it renders cleanly across systems
          // (the unicode ⚙ glyph rendered flat on most platforms).
          html: '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path fill="currentColor" d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/></svg>',
        }),
        userMenu(),
      ),
    );
  }

  // ----------------------------- Account dropdown -----------------------------
  // Avatar in the header is the trigger. Click toggles the panel below it
  // (right-aligned to the avatar, drops DOWN under the header). Clicking
  // outside or pressing Escape closes it (see global handler at bottom of
  // file). Logout clears in-progress session state and routes to the login
  // screen; pastProblemsArchive + tutorialFlags are preserved across logout.
  function userMenu() {
    const open = !!state.userMenuOpen;
    const trigger = el('button', {
      class: 'avatar' + (open ? ' is-open' : ''),
      title: t('Account'),
      'aria-label': t('Account menu'),
      'aria-haspopup': 'true',
      'aria-expanded': open ? 'true' : 'false',
      onclick: (e) => {
        e.stopPropagation();
        state.userMenuOpen = !state.userMenuOpen;
        render();
      },
    },
      el('img', { src: './assets/avatarAsset.svg', alt: '' }),
    );

    // The bottom button of the dropdown is gated on tutorial progress.
    // Session 1: "Logout" — disabled until all session-1 steps are done.
    // Session 2: "Logout" while incomplete; once all session-2 steps are done
    // it becomes "Finish Tutorial" and routes to the terminal tutorial-
    // complete screen (no further login).
    // tutorial-complete screen: dropdown shows account info only — no action
    // button (the tutorial is over).
    const sessionComplete = isCurrentSessionComplete();
    const isTerminal = state.screen === 'tutorial-complete';
    const isFinishMode = state.session === 2 && sessionComplete;
    const actionLabel = isFinishMode ? t('Finish Tutorial') : t('Logout');
    const actionTitle = sessionComplete
      ? (isFinishMode ? t('Finish the tutorial') : t('Log out'))
      : t('Complete all tutorial steps to log out');
    const actionDisabled = !sessionComplete;

    const actionButton = isTerminal ? null : el('button', {
      class: 'um-logout' + (actionDisabled ? ' is-disabled' : '') + (isFinishMode ? ' is-finish' : ''),
      role: 'menuitem',
      title: actionTitle,
      'aria-disabled': actionDisabled ? 'true' : 'false',
      onclick: () => {
        if (actionDisabled) return;
        state.userMenuOpen = false;
        if (isFinishMode) {
          state.tutorialFlags.session2Completed = true;
          go('tutorial-complete');
        } else {
          logout();
        }
      },
    }, actionLabel);

    const remainingItems = actionDisabled
      ? tutorialProgressItems().filter(i => !i.done)
      : [];

    const reasonBlock = actionDisabled ? el('div', { class: 'um-reason', role: 'tooltip' },
      el('div', { class: 'um-reason-title' }, t('Finish these steps to log out:')),
      el('ul', { class: 'um-reason-list' },
        ...remainingItems.map(i => el('li', { class: 'um-reason-item' }, i.label)),
      ),
    ) : null;

    const actionWrap = actionButton ? el('div', { class: 'um-logout-wrap' },
      actionButton,
      reasonBlock,
    ) : null;

    const panel = open ? el('div', {
      class: 'user-menu-panel',
      role: 'menu',
      onclick: (e) => e.stopPropagation(),
    },
      el('div', { class: 'um-arrow' }),
      el('div', { class: 'um-info' },
        el('div', { class: 'um-row' },
          el('span', { class: 'um-label' }, t('Logged in as:')),
          el('span', { class: 'um-value' }, state.user.name),
        ),
        isTerminal ? el('div', { class: 'um-row' },
          el('span', { class: 'um-label' }, t('Status:')),
          el('span', { class: 'um-value' }, t('Tutorial complete')),
        ) : null,
      ),
      actionWrap ? el('div', { class: 'um-divider' }) : null,
      actionWrap,
    ) : null;

    return el('div', { class: 'user-menu' }, trigger, panel);
  }

  // ----------------------------- footer -----------------------------
  function siteFooter() {
    return el('footer', { class: 'site-footer' },
      el('div', { class: 'footer-grid' },
        el('div', {},
          el('h4', {}, t('Project Contact')),
          el('p', {}, 'Dr. Stacey Crane, PhD, RN, CPON'),
          el('p', {}, t('Department of Research')),
          el('p', {}, t('Cizik School of Nursing at UTHealth Houston')),
          el('p', { style: { marginTop: '8px' } }, t('Phone: 713-500-2233')),
          el('p', {}, t('Email: SPOTS@uth.tmc.edu')),
        ),
        el('div', {},
          el('h4', {}, t('Quick Links')),
          el('a', {}, t('Privacy Policy')),
          el('a', {}, t('Site Policies & Required Links')),
          el('a', {
            href: '#',
            title: state.session === 2
              ? t('Skip to the end of the tutorial')
              : t('Skip to the next tutorial session'),
            onclick: (e) => { e.preventDefault(); skipToNextSession(); },
          }, t('Emergency Information')),
          el('a', {}, t('Campus Carry')),
        ),
        el('div', { class: 'uth-logo' },
          el('img', { src: './assets/UTHH-CSON-Logo.webp', alt: t('UTHealth Houston Cizik School of Nursing') }),
        ),
      ),
      el('div', { class: 'lang-row' },
        el('button', { class: 'theme-toggle', title: t('Toggle theme'),
          html: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z"/></svg>',
        }),
        el('div', {
          class: 'lang-toggle',
          role: 'group',
          'aria-label': t('Language'),
        },
          el('button', {
            class: state.language === 'en' ? 'is-active' : '',
            'aria-pressed': state.language === 'en' ? 'true' : 'false',
            onclick: () => setLanguage('en'),
          }, 'English'),
          el('button', {
            class: state.language === 'es' ? 'is-active' : '',
            'aria-pressed': state.language === 'es' ? 'true' : 'false',
            onclick: () => setLanguage('es'),
          }, 'Español'),
        ),
      ),
      el('p', { class: 'copyright' },
        t('Copyright 2019-2025 - The University of Texas Health Science Center at Houston (UTHealth Houston) Powered by Center for Digital Health and Analytics at McWilliams School of Biomedical Informatics at UTHealth Houston')),
      el('div', { class: 'footer-confetti' },
        el('img', { src: './assets/Spot_Assets-02.svg', alt: '' }),
      ),
    );
  }

  // ----------------------------- Problem Station sidebar -----------------------------
  // Map a symptom's origin/category to a human-readable category label for the
  // sub-line under the symptom name. Prefer origin (matches the screen the user
  // picked it from — e.g. a Search-picked symptom reads "Search" even though
  // its underlying `category` is body_parts/activities/feelings).
  function categoryLabelFor(sym) {
    const SEARCH = t('Search');
    const PAST = t('Past Problems');
    const BODY = t('Body Parts');
    const ACT = t('Activities');
    const FEEL = t('Feelings');
    const byOrigin = {
      'search': SEARCH,
      'past-problems': PAST,
      'body-parts': BODY,
      'body-part-detail': BODY,
      'activities': ACT,
      'activity-detail': ACT,
      'feelings': FEEL,
    };
    if (byOrigin[sym.originScreen]) return byOrigin[sym.originScreen];
    const byCat = {
      'body_parts': BODY,
      'activities': ACT,
      'feelings': FEEL,
      'search': SEARCH,
      'prior-problems': PAST,
    };
    return byCat[sym.category] || t('Problem');
  }

  function formatDateMDY(d) {
    const dt = d instanceof Date ? d : (d ? new Date(d) : new Date());
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${dt.getFullYear()}`;
  }

  // Trash glyph for the Problem Station row remove action. Inlined SVG so we
  // can color it via `currentColor` (red) without a separate asset fetch.
  const TRASH_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/>' +
    '<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>' +
    '</svg>';

  function problemStation() {
    const items = state.selected.length === 0
      ? el('div', { class: 'ps-empty' }, t('You have not reported any problems yet.'))
      : el('div', { class: 'ps-rows' },
          state.selected.map(s => {
            // Answer dot count is per-symptom — feelings have 2 questions,
            // body_parts/activities/search have 3 (see questionIdsForSymptom).
            const required = questionIdsForSymptom(s);
            const displayName = tSymptom(s.name);
            const subLabel = s.subcategory ? `${categoryLabelFor(s)} / ${s.subcategory}` : categoryLabelFor(s);
            const answeredCount = required.reduce(
              (n, qid) => n + ((s.answers && s.answers[qid] !== undefined) ? 1 : 0), 0);
            const dots = required.map((qid) => el('span', {
              class: 'ps-dot' + ((s.answers && s.answers[qid] !== undefined) ? ' is-on' : ''),
            }));
            return el('div', {
              class: 'ps-card',
              role: 'button',
              tabindex: '0',
              'aria-label': t(
                `Edit responses for ${displayName}. ${answeredCount} of ${required.length} questions answered.`,
                `Editar respuestas para ${displayName}. ${answeredCount} de ${required.length} preguntas respondidas.`
              ),
              title: t('Click to edit responses'),
              onclick: () => openEditSymptom(s),
              onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditSymptom(s); }
              },
            },
              el('div', { class: 'ps-card-top' },
                el('div', { class: 'ps-card-name' }, displayName),
                el('div', { class: 'ps-card-right' },
                  el('div', { class: 'ps-dots' }, ...dots),
                  el('button', {
                    class: 'ps-trash',
                    title: t('Remove'),
                    'aria-label': t(`Remove ${displayName}`, `Eliminar ${displayName}`),
                    onclick: (e) => {
                      e.stopPropagation();
                      state.selected = state.selected.filter(x => x !== s);
                      state.tutorialFlags.deletedProblem = true;
                      render();
                    },
                    onkeydown: (e) => {
                      // Don't let Enter/Space on the trash button bubble up to
                      // the row's keydown handler and re-open the edit modal.
                      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                    },
                    html: TRASH_SVG,
                  }),
                ),
              ),
              el('div', { class: 'ps-card-sub' }, subLabel),
              el('div', { class: 'ps-card-date' }, formatDateMDY(s.dateAdded)),
            );
          }));

    return el('aside', { class: 'problem-station' },
      el('h3', {}, t('Problem Station')),
      el('p', { class: 'ps-sub' }, t('Tell us about the problems you are having right now.')),
      el('div', { class: 'ps-list' }, items),
      el('p', { class: 'ps-note' },
        t("Please remember, the problems reported in SPOTS are not automatically shared with your healthcare team. You must continue to report your/your child's problems to your healthcare team as you normally would.")),
    );
  }

  // Floating dock-style tutorial-progress button. Lives top-right under the
  // avatar; magnifies on hover (Apple Dock style); click toggles a popup with
  // the full checklist. Editing is done by clicking a Problem Station row
  // directly — there's no longer a CTA in this panel.
  function tutorialDock() {
    const items = tutorialProgressItems();
    const total = items.length;
    const completed = items.filter(i => i.done).length;
    const pct = Math.round((completed / total) * 100);
    const open = !!state.tutorialDockOpen;

    // SVG circular progress ring around the button — circumference 2πr where
    // r=26, so ~163.4. The progress arc reveals from the top, clockwise.
    const ringCircumference = 163.36;
    const ringOffset = ringCircumference * (1 - completed / total);
    const button = el('button', {
      class: 'tutorial-dock-btn' + (open ? ' is-open' : ''),
      'aria-label': t(
        `Tutorial progress: ${completed} of ${total} complete`,
        `Progreso del tutorial: ${completed} de ${total} completados`
      ),
      'aria-expanded': open ? 'true' : 'false',
      onclick: (e) => {
        e.stopPropagation();
        state.tutorialDockOpen = !state.tutorialDockOpen;
        render();
      },
    },
      el('span', { class: 'dock-ring-wrap', html:
        '<svg viewBox="0 0 60 60" aria-hidden="true" focusable="false">' +
          '<circle class="ring-track" cx="30" cy="30" r="26" fill="none" stroke-width="4" />' +
          '<circle class="ring-progress" cx="30" cy="30" r="26" fill="none" stroke-width="4" ' +
          'stroke-linecap="round" ' +
          'stroke-dasharray="' + ringCircumference.toFixed(2) + '" ' +
          'stroke-dashoffset="' + ringOffset.toFixed(2) + '" ' +
          'transform="rotate(-90 30 30)" />' +
        '</svg>'
      }),
      el('span', { class: 'dock-core' },
        el('span', { class: 'dock-icon', html:
          // Graduation-cap glyph — signals "tutorial / learn" more strongly
          // than a checklist while reading clean at this size.
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M12 3L1.5 8.5 12 14l8.5-4.46V15a.75.75 0 0 0 1.5 0V8.5L12 3z"/>' +
            '<path fill="currentColor" d="M5 12.18v3.05c0 .66.39 1.26 1 1.53 1.74.79 3.83 1.24 6 1.24s4.26-.45 6-1.24c.61-.27 1-.87 1-1.53v-3.05L12 15.5l-7-3.32z"/>' +
          '</svg>'
        }),
        el('span', { class: 'dock-count' }, `${completed}/${total}`),
      ),
    );

    const panel = open ? el('div', {
      class: 'tutorial-dock-panel',
      onclick: (e) => e.stopPropagation(),
    },
      el('div', { class: 'tdp-header' },
        el('span', { class: 'tdp-title' }, t('Tutorial Progress')),
        el('span', { class: 'tdp-count' }, `${completed}/${total}`),
      ),
      el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill', style: { width: pct + '%' } }),
      ),
      el('ul', { class: 'tdp-list' }, items.map(it => {
        // Six demos are wired: search, body-parts, activities, feelings,
        // past-problems, completed (logout flow). Welcome is intentionally
        // skipped — the user has, by definition, already done it. `reviewed`
        // is still a tutorial-flag milestone with no walkthrough — keep its
        // `?` disabled.
        const HINT_KEYS = new Set(['search', 'body-parts', 'activities', 'feelings', 'past-problems', 'reviewed', 'delete', 'completed']);
        const NO_HINT_KEYS = new Set(['welcome']);
        const hasHint = HINT_KEYS.has(it.key);
        const showHintBtn = !NO_HINT_KEYS.has(it.key);
        return el('li', { class: 'tdp-item' + (it.done ? ' is-done' : '') },
          el('span', { class: 'progress-check' }, it.done ? '✓' : ''),
          el('span', { class: 'tdp-label' }, it.label),
          showHintBtn ? el('button', {
            class: 'tdp-hint-btn' + (hasHint ? '' : ' is-disabled'),
            'aria-label': hasHint
              ? t(`Show hint for ${it.label}`, `Mostrar pista para ${it.label}`)
              : t(`Hint for ${it.label} coming soon`, `Pista para ${it.label} próximamente`),
            title: hasHint ? t('Show me how') : t('Coming soon'),
            onclick: (e) => {
              e.stopPropagation();
              if (!hasHint) return;
              state.activeHintKey = it.key;
              render();
            },
          }, '?') : null,
        );
      })),
    ) : null;

    const backdrop = open ? el('div', {
      class: 'tutorial-dock-backdrop',
      onclick: () => { state.tutorialDockOpen = false; render(); },
    }) : null;

    return el('div', { class: 'tutorial-dock' }, backdrop, button, panel);
  }

  // ----------------------------- screens -----------------------------
  function welcomeScreen() {
    const dots = [
      { c: 'var(--spots-orange)',  s: 18, t: '12%', l: '8%' },
      { c: 'var(--spots-green)',   s: 12, t: '20%', l: '24%' },
      { c: 'var(--spots-yellow)',  s: 22, t: '78%', l: '12%', border: true },
      { c: 'var(--spots-feelings)',s: 14, t: '70%', l: '88%' },
      { c: 'var(--spots-red)',     s: 12, t: '14%', l: '86%' },
      { c: 'var(--spots-green)',   s: 16, t: '85%', l: '70%' },
    ];
    return el('div', {},
      siteHeader(),
      el('div', { class: 'welcome-wrap' },
        ...dots.map(d => el('span', {
          class: 'deco-dot',
          style: {
            top: d.t, left: d.l,
            width: d.s + 'px', height: d.s + 'px',
            background: d.border ? 'transparent' : d.c,
            border: d.border ? `2px solid ${d.c}` : 'none',
          },
        })),
        el('div', { class: 'welcome-card' },
          el('div', { class: 'welcome-greet' }, t('Welcome to')),
          el('div', { class: 'welcome-logo' },
            el('img', { src: './assets/Spots-Logo-UpdatedBG.svg', alt: 'SPOTS' }),
          ),
          el('div', { class: 'tagline' }, t('Symptom & Problem Observation Tracking System')),
          el('p', { class: 'blurb' }, t('Tell us how you have been feeling. Tap things on your body, activities, or feelings that have been bothering you. There are no right or wrong answers.')),
          el('button', { class: 'btn-primary', onclick: () => go('home') }, t('Get Started →')),
        ),
      ),
      siteFooter(),
    );
  }

  // Horizontal bar chart matching the production "summary chart": one bar per
  // unique reported symptom, length = report count. When the archive is empty
  // we render just the axis skeleton (matches the production empty state).
  function summaryChartSvg() {
    // Aggregate report counts across the archive.
    const counts = new Map();
    state.pastProblemsArchive.forEach(p => {
      const k = p.name;
      const prev = counts.get(k) || { name: p.name, count: 0, category: p.category };
      prev.count += (p.count || 1);
      counts.set(k, prev);
    });
    const items = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Axis max: at least 2 (matches production empty-state ticks of 0..2).
    const dataMax = items.length ? Math.max(...items.map(i => i.count)) : 0;
    const axisMax = Math.max(2, Math.ceil(dataMax));
    const tickStep = axisMax <= 2 ? 0.5 : 1;
    const ticks = [];
    for (let v = 0; v <= axisMax + 1e-6; v += tickStep) ticks.push(Number(v.toFixed(1)));

    // Layout: row height grows with item count so bars don't overflow.
    const W = 720;
    const padL = 140; // room for symptom name labels on Y axis
    const padR = 28;
    const padT = 32;
    // Keep the X-axis tick numbers and the "Number of times..." title from
    // crowding each other — tick numbers sit at plotB+24, title at H-12.
    const padB = 78;
    const rowH = 38;
    const rows = Math.max(items.length, 4); // empty state still gets ~4 rows of vertical room
    const plotH = rows * rowH;
    const H = padT + plotH + padB;
    const plotL = padL, plotR = W - padR;
    const plotT = padT, plotB = padT + plotH;
    const tickX = (v) => plotL + (v / axisMax) * (plotR - plotL);

    const muted = '#6B7280';
    const grid = '#D1D5DB';
    const baseline = '#9CA3AF';

    // Production-style palette — distinct hues per bar.
    const palette = ['#E14A4A', '#84BD3A', '#3FC1C0', '#7B2CBF', '#F08D40', '#4A90E2'];

    const gridlines = ticks.map(t => {
      const x = tickX(t);
      return `<line x1="${x}" y1="${plotT}" x2="${x}" y2="${plotB}" stroke="${grid}" stroke-width="1" stroke-dasharray="4 4" />`;
    }).join('');

    const tickMarksAndLabels = ticks.map(t => {
      const x = tickX(t);
      return `<line x1="${x}" y1="${plotB}" x2="${x}" y2="${plotB + 6}" stroke="${baseline}" stroke-width="1" />` +
             `<text x="${x}" y="${plotB + 24}" text-anchor="middle" font-size="13" fill="${muted}" font-family="inherit">${t}</text>`;
    }).join('');

    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const bars = items.map((it, i) => {
      const cy = plotT + (i + 0.5) * rowH;
      const barH = 26;
      const x = plotL + 1; // sit just inside Y-axis line
      const w = Math.max(2, tickX(it.count) - plotL - 1);
      const color = palette[i % palette.length];
      const truncated = it.name.length > 20 ? it.name.slice(0, 19) + '…' : it.name;
      return `<rect x="${x}" y="${cy - barH / 2}" width="${w}" height="${barH}" fill="${color}" rx="3" />` +
             `<text x="${plotL - 12}" y="${cy + 4}" text-anchor="end" font-size="13" fill="${muted}" font-family="inherit"><title>${escape(it.name)}</title>${escape(truncated)}</text>`;
    }).join('');

    const yLabel = `<text x="${plotL}" y="${plotT - 12}" font-size="13" font-weight="700" fill="${muted}" font-family="inherit">Symptoms</text>`;
    // Title sits ~24px below tick numbers (plotB + 24 + ~14 for line-height + breathing room).
    const xLabel = `<text x="${(plotL + plotR) / 2}" y="${plotB + 60}" text-anchor="middle" font-size="13" font-weight="700" fill="${muted}" font-family="inherit">Number of times the symptoms were reported</text>`;
    const yAxis = `<line x1="${plotL}" y1="${plotT}" x2="${plotL}" y2="${plotB}" stroke="${baseline}" stroke-width="1.25" />`;
    const xAxis = `<line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="${baseline}" stroke-width="1.25" />`;

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Symptom report summary chart">
      ${gridlines}
      ${yAxis}${xAxis}
      ${tickMarksAndLabels}
      ${bars}
      ${yLabel}
      ${xLabel}
    </svg>`;
  }

  // Legend rendered as HTML below the SVG so it inherits page font + wraps
  // gracefully without SVG text overflow.
  function summaryChartLegend() {
    const counts = new Map();
    state.pastProblemsArchive.forEach(p => {
      const prev = counts.get(p.name) || { name: p.name, count: 0 };
      prev.count += (p.count || 1);
      counts.set(p.name, prev);
    });
    const items = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    if (items.length === 0) return null;
    const palette = ['#E14A4A', '#84BD3A', '#3FC1C0', '#7B2CBF', '#F08D40', '#4A90E2'];
    return el('div', { class: 'chart-legend' },
      items.map((it, i) => el('div', { class: 'legend-item' },
        el('span', { class: 'legend-swatch', style: { background: palette[i % palette.length] } }),
        el('span', { class: 'legend-label' }, tSymptom(it.name)),
      )),
    );
  }

  function homeScreen() {
    // "What's New" = most recently reported (last in the archive, latest first).
    // "Happens a Lot" = symptoms with count >= 2, sorted by count desc.
    const archive = state.pastProblemsArchive;
    const whatsNew = archive.slice().reverse().slice(0, 3);
    const happensALot = archive
      .filter(p => (p.count || 1) >= 2)
      .slice()
      .sort((a, b) => (b.count || 1) - (a.count || 1))
      .slice(0, 3);
    const hasData = archive.length > 0;

    // Production renders each problem as a rounded gray "pill" row with the
    // symptom name on the left and a row of grey indicator dots on the right
    // (always grey on the home preview — no per-question completion signal).
    function pastList(items, emptyText) {
      if (items.length === 0) {
        return el('div', { class: 'dp-empty' }, emptyText);
      }
      return el('div', { class: 'dp-pills' },
        items.map(p => el('div', { class: 'dp-pill' },
          el('span', { class: 'dp-pill-name' }, tSymptom(p.name)),
          el('span', { class: 'dp-pill-dots' },
            el('span', { class: 'dp-pill-dot' }),
            el('span', { class: 'dp-pill-dot' }),
            el('span', { class: 'dp-pill-dot' }),
          ),
        )),
      );
    }

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('div', { class: 'home-banner' },
          el('div', { class: 'greet' }, t('Welcome to')),
          el('div', { class: 'home-logo' },
            el('img', { src: './assets/Spots-Logo-UpdatedBG.svg', alt: 'SPOTS' }),
          ),
        ),
        el('div', { class: 'two-col' },
          el('div', { class: 'dash-left' },
            el('div', { class: 'dash-past' },
              el('div', { class: 'dp-header' },
                el('span', { class: 'dp-header-title' },
                  el('span', { class: 'dp-header-icon', 'aria-hidden': 'true' }, '⚠'),
                  el('span', {}, t('Past Problems')),
                ),
                el('span', { class: 'view-all', onclick: () => go('past-problems') }, t('View All')),
              ),
              el('div', { class: 'dp-body' },
                el('div', { class: 'dp-section' },
                  el('div', { class: 'dp-section-label' },
                    el('span', { class: 'dp-section-icon', 'aria-hidden': 'true',
                      html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
                    }),
                    el('span', {}, t("What's New")),
                  ),
                  pastList(whatsNew, t('No new problems in the last 30 days.')),
                ),
                el('div', { class: 'dp-divider' }),
                el('div', { class: 'dp-section' },
                  el('div', { class: 'dp-section-label' },
                    el('span', { class: 'dp-section-icon', 'aria-hidden': 'true',
                      html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
                    }),
                    el('span', {}, t('Happens a Lot')),
                  ),
                  pastList(happensALot, t('No frequent problems yet.')),
                ),
              ),
            ),
            el('div', { class: 'dash-summary' },
              el('h3', {}, t('Here is a summary of number of times you reported the following symptoms in the last 30 days:')),
              hasData ? el('div', { class: 'chart-frame', html: summaryChartSvg() }) : null,
              hasData ? summaryChartLegend() : null,
              !hasData ? el('p', { class: 'dash-summary-empty' }, t('There are no symptoms reported. Use the other tools to tell us about your problems, then come back here next time.')) : null,
              el('a', {
                class: 'view-full',
                onclick: (e) => {
                  e.preventDefault();
                  alert(t('Reports are part of the full SPOTS site. This tutorial build focuses on the symptom-reporting flow and does not include the reporting view.'));
                },
              }, t('View Full Report →')),
            ),
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Body Parts (list)
  function bodyPartsScreen() {
    const isBack = !!state.showBodyBack;
    // The yellow tint always tracks the figure's RIGHT side: on the left of the
    // frame in the front view, on the right of the frame in the back view.
    const figureCol = el('div', { class: 'bp-figure-col' },
      el('div', { class: 'bp-figure' + (isBack ? ' is-back' : '') },
        el('div', { class: 'figure-labels' },
          el('span', {}, isBack ? t('Left')  : t('Right')),
          el('span', {}, isBack ? t('Right') : t('Left')),
        ),
        el('div', {
          class: 'body-svg',
          'data-svg-src': isBack ? './assets/SPOTSBodyBackOptimized.svg' : './assets/SPOTSBodyFrontOptimized.svg',
        }),
      ),
      el('button', {
        class: 'show-back',
        onclick: () => { state.showBodyBack = !state.showBodyBack; render(); },
      },
        el('span', { class: 'show-back-label' }, isBack ? t('Show Front') : t('Show Back')),
        el('img', { class: 'show-back-icon', src: './assets/Rotate.svg', alt: '' }),
      ),
    );

    const body = el('div', { class: 'bp-layout' },
      figureCol,
      el('div', { class: 'bp-list-panel bp-list-panel--no-header' },
        el('div', { class: 'bp-list' },
          D.bodyParts.map(bp => el('div', {
            class: 'bp-row',
            onclick: () => go('body-part-detail', { currentBodyPart: bp }),
          },
            el('img', { class: 'thumb', src: D.assetPath('BodyParts-Final', bp.image), alt: '' }),
            el('span', { class: 'row-label' }, tLabel(bp)),
            el('span', { class: 'chev' }, '›'),
          )),
        ),
      ),
    );

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('h1', { class: 'page-title' }, t('Body Parts')),
        el('p', { class: 'page-subtitle' }, t('Pick the body part where you are having problems')),
        el('div', { class: 'two-col' },
          body,
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Body Part DETAIL (figure on left, head + symptom list on right)
  function bodyPartDetailScreen() {
    const bp = state.currentBodyPart;
    const symptoms = D.bodyPartSymptoms[bp.key] || [];
    const list = el('div', { class: 'symptom-list' },
      symptoms.map(name => {
        const selected = isSelected('body_parts', bp.key, name);
        const displayName = tSymptom(name);
        return el('div', {
          class: 'symptom-row' + (selected ? ' is-selected' : ''),
          role: 'button',
          tabindex: '0',
          'aria-pressed': selected ? 'true' : 'false',
          onclick: () => toggleSymptom('body_parts', bp.key, bp.label, name),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSymptom('body_parts', bp.key, bp.label, name);
            }
          },
        },
          el('span', {}, displayName),
          el('span', { class: 'check', 'aria-hidden': 'true' }, selected ? '✓' : ''),
        );
      }),
    );

    const detail = el('div', { class: 'bp-list-panel' },
      el('div', { class: 'panel-header' },
        el('span', { class: 'panel-title' }, tLabel(bp)),
        el('button', { class: 'panel-link', onclick: () => go('body-parts') }, t('← All Body Parts')),
      ),
      el('img', { class: 'bp-detail-figure', src: D.assetPath('BodyParts-Final', bp.image), alt: '' }),
      el('button', { class: 'go-to-skin', onclick: () => go('body-part-detail', { currentBodyPart: D.bodyParts.find(b => b.key === 'skin') || bp }) }, t('Go To Skin')),
      list,
    );

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('h1', { class: 'page-title' }, t('Body Parts')),
        el('p', { class: 'page-subtitle' }, t('Pick the body part where you are having problems')),
        el('div', { class: 'two-col' },
          el('div', { class: 'bp-layout' },
            el('div', { class: 'bp-figure-col' },
              el('div', { class: 'bp-figure' + (state.showBodyBack ? ' is-back' : '') },
                el('div', { class: 'figure-labels' },
                  el('span', {}, state.showBodyBack ? t('Left') : t('Right')),
                  el('span', {}, state.showBodyBack ? t('Right') : t('Left')),
                ),
                el('div', {
                  class: 'body-svg',
                  'data-svg-src': state.showBodyBack
                    ? './assets/SPOTSBodyBackOptimized.svg'
                    : './assets/SPOTSBodyFrontOptimized.svg',
                }),
              ),
              el('button', {
                class: 'show-back',
                onclick: () => { state.showBodyBack = !state.showBodyBack; render(); },
              },
                el('span', { class: 'show-back-label' }, state.showBodyBack ? t('Show Front') : t('Show Back')),
                el('img', { class: 'show-back-icon', src: './assets/Rotate.svg', alt: '' }),
              ),
            ),
            detail,
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Activities (grid)
  function activitiesScreen() {
    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('h1', { class: 'page-title' }, t('Activities')),
        el('p', { class: 'page-subtitle' }, t('Pick the activities where you are having problems')),
        el('div', { class: 'two-col' },
          el('div', { class: 'picker-grid picker-grid--activities' },
            D.activities.map(act => el('div', {
              class: 'picker-card',
              onclick: () => go('activity-detail', { currentActivity: act }),
            },
              el('div', { class: 'top-label' }, tLabel(act)),
              el('img', { src: D.assetPath('Activities-Final', act.image), alt: '' }),
            )),
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Activity detail — overlays the activities grid as a centered modal
  function activityDetailScreen() {
    const act = state.currentActivity;
    const symptoms = D.activitySymptoms[act.key] || [];

    const detailCard = el('div', {
      class: 'modal-card activity-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'activity-modal-title',
      onclick: (e) => e.stopPropagation(), // clicks inside the card don't dismiss
    },
      el('h2', { id: 'activity-modal-title' }, tLabel(act)),
      el('img', {
        class: 'activity-modal-image',
        src: D.assetPath('Activities-Final', act.image),
        alt: '',
      }),
      el('div', { class: 'symptom-list' },
        symptoms.map(name => {
          const selected = isSelected('activities', act.key, name);
          const displayName = tSymptom(name);
          return el('div', {
            class: 'symptom-row' + (selected ? ' is-selected' : ''),
            role: 'button',
            tabindex: '0',
            'aria-pressed': selected ? 'true' : 'false',
            onclick: () => toggleSymptom('activities', act.key, act.label, name),
            onkeydown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSymptom('activities', act.key, act.label, name);
              }
            },
          },
            el('span', {}, displayName),
            el('span', { class: 'check', 'aria-hidden': 'true' }, selected ? '✓' : ''),
          );
        }),
      ),
      el('div', { class: 'activity-modal-actions' },
        el('button', { class: 'btn-secondary', onclick: () => go('activities') }, t('Done')),
      ),
    );

    const overlay = el('div', {
      class: 'modal-backdrop',
      onclick: () => go('activities'), // click outside the card to dismiss
    }, detailCard);

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('h1', { class: 'page-title' }, t('Activities')),
        el('p', { class: 'page-subtitle' }, t('Pick the activities where you are having problems')),
        el('div', { class: 'two-col' },
          el('div', { class: 'picker-grid picker-grid--activities' },
            D.activities.map(a => el('div', {
              class: 'picker-card' + (a.key === act.key ? ' is-selected' : ''),
            },
              el('div', { class: 'top-label' }, tLabel(a)),
              el('img', { src: D.assetPath('Activities-Final', a.image), alt: '' }),
            )),
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
      overlay,
    );
  }

  // ---- Feelings (grid, click toggles directly)
  function feelingsScreen() {
    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main' },
        el('h1', { class: 'page-title' }, t('Feelings')),
        el('p', { class: 'page-subtitle' }, t('Pick the feelings where you are having problems')),
        el('div', { class: 'two-col' },
          el('div', { class: 'picker-grid picker-grid--feelings' },
            D.feelings.map(f => {
              const selected = isSelected('feelings', f.key, f.label);
              return el('div', {
                class: 'picker-card feelings' + (selected ? ' is-selected' : ''),
                onclick: () => toggleSymptom('feelings', f.key, 'Feelings', f.label),
              },
                el('div', { class: 'top-label feelings-label' }, tLabel(f)),
                el('img', { src: D.assetPath('Feelings-Final', f.image), alt: '' }),
                el('div', { class: 'feelings-dots' },
                  el('span', {}), el('span', {}), el('span', {}),
                ),
              );
            }),
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Search
  function searchScreen() {
    const rawQuery = state.currentSearchQuery;
    const q = rawQuery.trim().toLowerCase();
    const results = q.length === 0 ? [] :
      D.searchCorpus.filter(it => it.name.toLowerCase().includes(q)).slice(0, 24);
    const hasQuery = rawQuery.length > 0;
    const hasResults = results.length > 0;

    // Magnifying glass — subtle gray when there's a query (sits next to the
    // X clear button), more prominent when the input is empty.
    const MAG_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>';

    const resultsList = hasResults
      ? el('div', { class: 'search-results-pills' },
          results.map(it => {
            const selected = isSelected(it.category, it.subcategory, it.name);
            return el('div', {
              class: 'search-pill-row' + (selected ? ' is-selected' : ''),
              onclick: () => toggleSymptom(it.category, it.subcategory, it.contextLabel, it.name),
              role: 'button',
              tabindex: '0',
              onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSymptom(it.category, it.subcategory, it.contextLabel, it.name);
                }
              },
            },
              el('span', { class: 'search-pill-name' }, tSymptom(it.name)),
            );
          }),
        )
      : null;

    // Empty-results state (query entered but no matches) reuses the same
    // add-custom card the user can always reach from the bottom of the page.
    const noMatchesNote = hasQuery && !hasResults
      ? el('p', { class: 'search-no-matches' }, t(
          `No matches for "${rawQuery.trim()}".`,
          `Sin resultados para «${rawQuery.trim()}».`
        ))
      : null;

    // Add-as-new-symptom card: dashed border, query echoed in orange.
    // Only renders once the user has typed something.
    const addCustomCard = hasQuery ? el('div', { class: 'search-add-block' },
      el('p', { class: 'search-add-caption' }, t("Can't find what you are looking for? Click the add button:")),
      el('button', {
        class: 'search-add-card',
        onclick: () => toggleSymptom('search', 'custom', 'Search', rawQuery.trim()),
      },
        el('div', { class: 'search-add-title' }, t('Add as a new symptom:')),
        el('div', { class: 'search-add-query' }, `"${rawQuery.trim()}"`),
      ),
    ) : null;

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main search-page' },
        el('h1', { class: 'page-title' }, t('Search')),
        el('p', { class: 'page-subtitle' }, t('Tell us the problems your child is still having:')),
        el('div', { class: 'two-col' },
          el('div', { class: 'search-column' },
            el('label', { class: 'search-label', for: 'search-input' }, t('My child is having:')),
            el('div', { class: 'search-box' + (hasQuery ? ' has-query' : '') },
              el('input', {
                id: 'search-input',
                type: 'text',
                placeholder: t('Problem'),
                value: rawQuery,
                autofocus: 'true',
                'aria-label': t('Search symptoms'),
                oninput: (e) => { state.currentSearchQuery = e.target.value; render(); },
              }),
              hasQuery ? el('button', {
                class: 'search-clear',
                'aria-label': t('Clear search'),
                title: t('Clear'),
                onclick: () => { state.currentSearchQuery = ''; render(); },
              }, '×') : null,
              el('span', { class: 'search-icon-svg' + (hasQuery ? ' is-subtle' : ''), html: MAG_SVG }),
            ),
            hasResults ? el('p', { class: 'search-results-label' }, t('Please select from the list of symptoms :')) : null,
            resultsList,
            noMatchesNote,
            addCustomCard,
          ),
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Past Problems
  function pastProblemsScreen() {
    const archive = state.pastProblemsArchive;

    // Map archive item `category` to the production-style context line shown
    // beneath the symptom name. Mirrors `formatSymptomReportContextLine` in
    // app/_lib/utils/symptom-report-context-line.ts: "Body Parts / Head",
    // "Activities / Drawing", "Feelings", "Search" — production renders the
    // subcategory after a slash for body_parts/activities, and just the
    // category name for feelings/search where the subcategory is implicit.
    function ppContextLine(item) {
      const cat = item.category;
      const BODY = t('Body Parts');
      const ACT = t('Activities');
      if (cat === 'body_parts')  return BODY + (item.contextLabel ? ' / ' + item.contextLabel : '');
      if (cat === 'activities')  return ACT  + (item.contextLabel ? ' / ' + item.contextLabel : '');
      if (cat === 'feelings')    return t('Feelings');
      if (cat === 'search')      return t('Search');
      return item.contextLabel || '';
    }

    const body = archive.length === 0
      ? el('div', { class: 'pp-empty' },
          el('p', { class: 'pp-empty-text' }, t('Past problems will show up here after you finish a session.')),
        )
      : el('div', { class: 'pp-list problem-list' },
          archive.map(item => {
            const selected = isSelected('prior_problems', item.subcategory, item.name);
            // Dot count mirrors production `slotCount` — one dot per
            // PRO-CTCAE question for this symptom (feelings=2, others=3).
            const slotCount = item.category === 'feelings' ? 2 : 3;
            const ctxLine = ppContextLine(item);
            return el('div', {
              class: 'pp-row' + (selected ? ' is-selected' : ''),
              role: 'button',
              tabindex: '0',
              'aria-pressed': selected ? 'true' : 'false',
              onclick: () => toggleSymptom('prior_problems', item.subcategory, item.contextLabel, item.name),
              onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSymptom('prior_problems', item.subcategory, item.contextLabel, item.name);
                }
              },
            },
              el('div', { class: 'pp-info' },
                el('span', { class: 'pp-name' }, tSymptom(item.name)),
                (ctxLine || item.dateLabel) ? el('div', { class: 'pp-subtext' },
                  ctxLine ? el('span', { class: 'pp-context' }, ctxLine) : null,
                  item.dateLabel ? el('span', { class: 'pp-date' }, t('Last reported ') + item.dateLabel) : null,
                ) : null,
              ),
              el('div', { class: 'pp-dots', title: t('Last reported: ') + (item.dateLabel || '') },
                Array.from({ length: slotCount }, () => el('span', { class: 'pp-dot' })),
              ),
            );
          }),
        );

    return el('div', {},
      siteHeader(),
      el('main', { class: 'site-main past-problems-page' },
        el('header', { class: 'page-header' },
          el('h1', { class: 'page-title' }, t('Past Problems')),
          el('p', { class: 'page-subtitle' }, t('These are problems your child has reported before. Tap any one to add it to today’s session.')),
        ),
        el('div', { class: 'two-col' },
          body,
          problemStation(),
        ),
      ),
      siteFooter(),
    );
  }

  // ---- Tutorial hint modal (animated walkthroughs)
  // Reusable cursor SVG (white-fill black-stroke pointer)
  const HINT_CURSOR_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 2 L3 19 L8 14.5 L11 21 L14 19.5 L11 13 L18 13 Z" ' +
    'fill="#ffffff" stroke="#101828" stroke-width="1.4" stroke-linejoin="round"/>' +
    '</svg>';

  // Build the abstracted mini-header used by every demo. `concreteKey` is the
  // nav slot that should render as the real `_02` SVG icon — every other slot
  // renders as a colored circle in the SPOTS palette. `opts.concreteAvatar`
  // (used by the "completed" / logout demo) swaps the abstract avatar dot for
  // the real avatarAsset.svg so the user recognizes the click target.
  function hintMiniHeader(concreteKey, extras, opts) {
    const concreteAvatar = !!(opts && opts.concreteAvatar);
    const SLOTS = [
      { key: 'past-problems', dotClass: 'hnd-past' },
      { key: 'body-parts',    dotClass: 'hnd-body' },
      { key: 'activities',    dotClass: 'hnd-act' },
      { key: 'feelings',      dotClass: 'hnd-feel' },
      { key: 'search',        dotClass: 'hnd-search' },
      { key: 'report',        dotClass: 'hnd-report' },
    ];
    const navChildren = SLOTS.map(slot => {
      if (slot.key === concreteKey) {
        return el('img', {
          class: 'hint-mini-navicon hint-mini-navicon-' + slot.key.replace('-', ''),
          src: NAV_ICONS[slot.key],
          alt: '',
        });
      }
      return el('div', { class: 'hint-nav-dot ' + slot.dotClass });
    });
    const avatarEl = concreteAvatar
      ? el('span', { class: 'hint-mini-avatar concrete' },
          el('img', { src: './assets/avatarAsset.svg', alt: '' }),
        )
      : el('div', { class: 'hint-mini-avatar' });
    return el('div', { class: 'hint-mini-header' },
      el('img', { class: 'hint-mini-corner', src: './assets/Spots-curve.svg', alt: '' }),
      el('div', { class: 'hint-mini-nav' }, ...navChildren),
      el('div', { class: 'hint-mini-user' },
        el('div', { class: 'hint-mini-gear' }),
        avatarEl,
      ),
      extras || null,
    );
  }

  // Mini home screen — shared across all demos. Renders the same abstract
  // home layout as the Search demo (Past Problems + abstract graph in a
  // left column, Problem Station card on the right). The `concreteKey`
  // controls which nav slot renders as the real `_02` SVG; pass the
  // demo's nav slot key so the cursor can glide to it before clicking.
  function hintMiniHome(concreteKey, navTargetExtra, opts) {
    return el('div', { class: 'hint-screen hint-screen-home' },
      hintMiniHeader(concreteKey, navTargetExtra || null, opts || null),
      el('div', { class: 'hint-mini-body' },
        el('div', { class: 'hint-mini-row' },
          el('div', { class: 'hint-mini-left' },
            el('div', { class: 'hint-mini-card hint-mini-past' },
              el('div', { class: 'hint-mini-card-bar wide' }),
              el('div', { class: 'hint-mini-card-bar' }),
              el('div', { class: 'hint-mini-card-bar short' }),
            ),
            el('div', { class: 'hint-mini-card hint-mini-graph' },
              el('div', { class: 'hint-mini-card-bar wide' }),
              el('div', { class: 'hint-mini-graph-bars' },
                el('div', { class: 'hint-mini-graph-bar', style: { width: '70%', background: 'var(--spots-red)' } }),
                el('div', { class: 'hint-mini-graph-bar', style: { width: '52%', background: 'var(--spots-green)' } }),
                el('div', { class: 'hint-mini-graph-bar', style: { width: '38%', background: 'var(--spots-teal)' } }),
              ),
            ),
          ),
          el('div', { class: 'hint-mini-card hint-mini-station' },
            el('div', { class: 'hint-mini-card-bar wide' }),
            el('div', { class: 'hint-mini-card-bar' }),
            el('div', { class: 'hint-mini-card-bar short' }),
          ),
        ),
      ),
    );
  }

  // ---- Hint demo: Body Parts ------------------------------------------------
  // Flow: home → cursor → Body Parts nav (real SVG, teal) → click → swap to
  // mini body-parts list screen → cursor → Left Foot region on the real body
  // figure → hover/click → swap to detail screen → cursor clicks one symptom
  // row → freeze on highlight.
  function bodyPartsHintStage() {
    return el('div', { class: 'hint-stage hint-bp-stage' },
      // SCREEN 0: mini home (cursor sits idle here, then glides to nav)
      hintMiniHome('body-parts', el('div', { class: 'hint-target hint-bp-target-nav-home' })),
      // SCREEN 1: body-parts list — real body figure rendered via <img>
      el('div', { class: 'hint-screen hint-bp-screen-list' },
        hintMiniHeader('body-parts', el('div', { class: 'hint-target hint-bp-target-nav' })),
        el('div', { class: 'hint-bp-body' },
          el('div', { class: 'hint-blurb-line title' }),
          el('div', { class: 'hint-blurb-line short centered' }),
          el('div', { class: 'hint-bp-row' },
            el('div', { class: 'hint-bp-figure' },
              el('img', {
                class: 'hint-bp-body-img',
                src: './assets/SPOTSBodyFrontOptimized.svg',
                alt: '',
              }),
              // Glow disc layered over the Left Foot region of the figure.
              // CSS-positioned (no SVG injection needed for this non-
              // interactive demo).
              el('div', { class: 'hint-bp-leftfoot-glow' }),
            ),
            // Body-parts list — mirrors the real `.bp-row` chassis wrapped in
            // the production `.bp-list-panel` chassis (white card, blue-light
            // outline, rounded). Without the panel chassis the rows look
            // naked vs. the real screen.
            el('div', { class: 'hint-bp-list-panel' },
              el('div', { class: 'hint-bp-list' },
                el('div', { class: 'hint-bp-parts-row' },
                  el('div', { class: 'hint-bp-parts-thumb' }),
                  el('div', { class: 'hint-bp-parts-label wide' }),
                  el('span', { class: 'hint-bp-parts-chev' }, '›'),
                ),
                // Concrete callback for Left Foot: real production thumbnail
                // (assets/BodyParts-Final/Left_Foot.jpg) in the thumb slot so
                // the user recognizes the body part the cursor will navigate
                // to on screen 2. Label + chevron stay abstract.
                el('div', { class: 'hint-bp-parts-row' },
                  el('img', {
                    class: 'hint-bp-parts-thumb hint-bp-parts-thumb-img',
                    src: './assets/BodyParts-Final/Left_Foot.jpg',
                    alt: '',
                  }),
                  el('div', { class: 'hint-bp-parts-label' }),
                  el('span', { class: 'hint-bp-parts-chev' }, '›'),
                ),
                el('div', { class: 'hint-bp-parts-row' },
                  el('div', { class: 'hint-bp-parts-thumb' }),
                  el('div', { class: 'hint-bp-parts-label short' }),
                  el('span', { class: 'hint-bp-parts-chev' }, '›'),
                ),
                el('div', { class: 'hint-bp-parts-row' },
                  el('div', { class: 'hint-bp-parts-thumb' }),
                  el('div', { class: 'hint-bp-parts-label' }),
                  el('span', { class: 'hint-bp-parts-chev' }, '›'),
                ),
                el('div', { class: 'hint-bp-parts-row' },
                  el('div', { class: 'hint-bp-parts-thumb' }),
                  el('div', { class: 'hint-bp-parts-label short' }),
                  el('span', { class: 'hint-bp-parts-chev' }, '›'),
                ),
              ),
            ),
          ),
          // The pulse target sits over the Left Foot glow
          el('div', { class: 'hint-target hint-bp-target-foot' }),
        ),
      ),
      // SCREEN 2: body-part detail (Left Foot symptoms)
      el('div', { class: 'hint-screen hint-bp-screen-detail' },
        hintMiniHeader('body-parts'),
        el('div', { class: 'hint-bp-detail' },
          el('div', { class: 'hint-blurb-line title' }),
          el('div', { class: 'hint-bp-detail-row' },
            el('div', { class: 'hint-bp-figure small' },
              el('img', {
                class: 'hint-bp-body-img',
                src: './assets/SPOTSBodyFrontOptimized.svg',
                alt: '',
              }),
            ),
            // Mirrors `.symptom-row` rows inside the same `.bp-list-panel`
            // chassis used by the real body-part detail screen (white card,
            // blue-light outline, rounded).
            el('div', { class: 'hint-bp-list-panel detail' },
              el('div', { class: 'hint-bp-detail-list' },
                el('div', { class: 'hint-bp-detail-label' }),
                el('div', { class: 'hint-bp-symptom-row concrete hint-bp-symptom-target' },
                  el('span', { class: 'hint-bp-symptom-name' }, tSymptom('Foot pain')),
                  el('span', { class: 'hint-bp-check' }),
                  el('div', { class: 'hint-target hint-bp-target-symptom' }),
                ),
                el('div', { class: 'hint-bp-symptom-row abstract' },
                  el('span', { class: 'hint-bp-symptom-bar short' }),
                  el('span', { class: 'hint-bp-check' }),
                ),
                el('div', { class: 'hint-bp-symptom-row abstract' },
                  el('span', { class: 'hint-bp-symptom-bar' }),
                  el('span', { class: 'hint-bp-check' }),
                ),
              ),
            ),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-bp-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Activities ------------------------------------------------
  // Flow: idle → cursor → Activities nav (real SVG, green) → click → swap to
  // mini activities grid → cursor → Sleep card → click → modal opens with
  // symptom list → cursor → "Fatigue" (the 2nd row, not the first) → freeze.
  function activitiesHintStage() {
    return el('div', { class: 'hint-stage hint-act-stage' },
      // SCREEN 0: mini home
      hintMiniHome('activities', el('div', { class: 'hint-target hint-act-target-nav-home' })),
      // SCREEN 1: activities grid
      el('div', { class: 'hint-screen hint-act-screen-grid' },
        hintMiniHeader('activities', el('div', { class: 'hint-target hint-act-target-nav' })),
        el('div', { class: 'hint-act-body' },
          el('div', { class: 'hint-blurb-line title' }),
          el('div', { class: 'hint-blurb-line short centered' }),
          el('div', { class: 'hint-act-grid' },
            // Abstract cards now mirror the real `.picker-card` chassis:
            // small label-bar at top, large inner gray "image area" below.
            el('div', { class: 'hint-act-card abstract' },
              el('span', { class: 'hint-act-card-label-bar' }),
              el('div', { class: 'hint-act-card-inner' }),
            ),
            el('div', { class: 'hint-act-card abstract' },
              el('span', { class: 'hint-act-card-label-bar' }),
              el('div', { class: 'hint-act-card-inner' }),
            ),
            el('div', { class: 'hint-act-card abstract' },
              el('span', { class: 'hint-act-card-label-bar' }),
              el('div', { class: 'hint-act-card-inner' }),
            ),
            // Sleep — concrete. Mirrors the real `.picker-card` chassis
            // (top label + real Activities-Final/Sleeping.jpg illustration
            // filling most of the card).
            el('div', { class: 'hint-act-card concrete' },
              el('div', { class: 'hint-act-card-label' }, t('Sleeping')),
              el('img', {
                class: 'hint-act-card-thumb',
                src: './assets/Activities-Final/Sleeping.jpg',
                alt: '',
              }),
              el('div', { class: 'hint-target hint-act-target-sleep' }),
            ),
            el('div', { class: 'hint-act-card abstract' },
              el('span', { class: 'hint-act-card-label-bar' }),
              el('div', { class: 'hint-act-card-inner' }),
            ),
            el('div', { class: 'hint-act-card abstract' },
              el('span', { class: 'hint-act-card-label-bar' }),
              el('div', { class: 'hint-act-card-inner' }),
            ),
          ),
        ),
      ),
      // SCREEN 2: activity-detail modal showing Sleep symptom list.
      // Real modal layout: title → large activity illustration → symptom
      // rows (orange-outlined pills, name left, blue radio right, NO thumb).
      el('div', { class: 'hint-screen hint-act-screen-modal' },
        hintMiniHeader('activities'),
        el('div', { class: 'hint-act-body dim' }),
        el('div', { class: 'hint-act-modal' },
          el('div', { class: 'hint-act-modal-title' }, t('Sleeping')),
          el('img', {
            class: 'hint-act-modal-image',
            src: './assets/Activities-Final/Sleeping.jpg',
            alt: 'Sleeping',
          }),
          // Activity-modal symptom row chassis: orange-outlined pill, name
          // on left, blue radio circle on right. NO thumbnail. Abstract rows
          // render placeholder text-bars; concrete Fatigue row carries the
          // word "Fatigue".
          el('div', { class: 'hint-act-modal-list' },
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar' }),
              el('span', { class: 'hint-act-check' }),
            ),
            // 2nd row — Fatigue (concrete, the cursor lands here)
            el('div', { class: 'hint-act-symptom-row concrete hint-act-symptom-target' },
              el('span', { class: 'hint-act-symptom-name' }, tSymptom('Fatigue')),
              el('span', { class: 'hint-act-check' }),
              el('div', { class: 'hint-target hint-act-target-symptom' }),
            ),
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar short' }),
              el('span', { class: 'hint-act-check' }),
            ),
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar' }),
              el('span', { class: 'hint-act-check' }),
            ),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-act-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Feelings --------------------------------------------------
  // Flow: idle → cursor → Feelings nav (real SVG, --spots-feelings) → click →
  // swap to mini feelings grid → cursor → "Worried" card → click → toggleSymptom
  // would normally open the question modal directly (feelings flow has no
  // intermediate list page). For the hint we render an "abstracted feelings
  // list" view so the user sees the click effect before stopping. The cursor
  // lands on the second-from-top row (not first). Demo stops at row click.
  function feelingsHintStage() {
    return el('div', { class: 'hint-stage hint-feel-stage' },
      // SCREEN 0: mini home
      hintMiniHome('feelings', el('div', { class: 'hint-target hint-feel-target-nav-home' })),
      // SCREEN 1: feelings grid — mirrors Activities chassis: label strip
      // at top + dominant illustration below. Blue-outlined cards.
      el('div', { class: 'hint-screen hint-feel-screen-grid' },
        hintMiniHeader('feelings', el('div', { class: 'hint-target hint-feel-target-nav' })),
        el('div', { class: 'hint-feel-body' },
          el('div', { class: 'hint-blurb-line title' }),
          el('div', { class: 'hint-blurb-line short centered' }),
          el('div', { class: 'hint-feel-grid' },
            // Abstract card chassis: small label-bar at top + gray inner
            // image area filling remainder, blue border.
            el('div', { class: 'hint-feel-card abstract' },
              el('span', { class: 'hint-feel-card-label-bar' }),
              el('div', { class: 'hint-feel-card-inner' }),
            ),
            // Worried — concrete. Real Anxiety.jpg (the production asset
            // for "Worried or nervous feelings"; see data.js feelings list)
            // fills the bulk of the card.
            el('div', { class: 'hint-feel-card concrete' },
              el('div', { class: 'hint-feel-card-label' }, t('Worried')),
              el('img', {
                class: 'hint-feel-card-thumb',
                src: './assets/Feelings-Final/Anxiety.jpg',
                alt: '',
              }),
              el('div', { class: 'hint-target hint-feel-target-worried' }),
            ),
            el('div', { class: 'hint-feel-card abstract' },
              el('span', { class: 'hint-feel-card-label-bar' }),
              el('div', { class: 'hint-feel-card-inner' }),
            ),
            el('div', { class: 'hint-feel-card abstract' },
              el('span', { class: 'hint-feel-card-label-bar' }),
              el('div', { class: 'hint-feel-card-inner' }),
            ),
            el('div', { class: 'hint-feel-card abstract' },
              el('span', { class: 'hint-feel-card-label-bar' }),
              el('div', { class: 'hint-feel-card-inner' }),
            ),
            el('div', { class: 'hint-feel-card abstract' },
              el('span', { class: 'hint-feel-card-label-bar' }),
              el('div', { class: 'hint-feel-card-inner' }),
            ),
          ),
        ),
      ),
      // SCREEN 2: feelings detail modal — mirrors Activities modal:
      // title → large Anxiety.jpg illustration → symptom rows (orange-pill,
      // name left, blue radio right, no thumb).
      el('div', { class: 'hint-screen hint-feel-screen-list' },
        hintMiniHeader('feelings'),
        el('div', { class: 'hint-feel-body dim' }),
        el('div', { class: 'hint-feel-modal' },
          el('div', { class: 'hint-feel-modal-title' }, t('Worried')),
          el('img', {
            class: 'hint-feel-modal-image',
            src: './assets/Feelings-Final/Anxiety.jpg',
            alt: 'Worried',
          }),
          el('div', { class: 'hint-feel-modal-list' },
            // Abstract row 0
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar' }),
              el('span', { class: 'hint-act-check' }),
            ),
            // Row 1 — concrete pick (Worried or nervous feelings)
            el('div', { class: 'hint-act-symptom-row concrete hint-feel-symptom-target' },
              el('span', { class: 'hint-act-symptom-name' }, tSymptom('Worried or nervous feelings')),
              el('span', { class: 'hint-act-check' }),
              el('div', { class: 'hint-target hint-feel-target-symptom' }),
            ),
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar short' }),
              el('span', { class: 'hint-act-check' }),
            ),
            el('div', { class: 'hint-act-symptom-row abstract' },
              el('span', { class: 'hint-bp-symptom-bar' }),
              el('span', { class: 'hint-act-check' }),
            ),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-feel-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Past Problems --------------------------------------------
  // Flow: idle → cursor → Past Problems nav (real SVG, orange) → click → swap
  // to mini past-problems screen → cursor → "Headache" row → click → swap to
  // question-modal-open state (modal frame visible, abstract option rows) →
  // freeze on modal.
  function pastProblemsHintStage() {
    return el('div', { class: 'hint-stage hint-pp-stage' },
      // SCREEN 0: mini home
      hintMiniHome('past-problems', el('div', { class: 'hint-target hint-pp-target-nav-home' })),
      // SCREEN 1: past-problems list
      el('div', { class: 'hint-screen hint-pp-screen-list' },
        hintMiniHeader('past-problems', el('div', { class: 'hint-target hint-pp-target-nav' })),
        el('div', { class: 'hint-pp-body' },
          el('div', { class: 'hint-blurb-line title' }),
          el('div', { class: 'hint-blurb-line short centered' }),
          // Real `.pp-row` chassis: checkbox | info (name + date) | dots | chev.
          // Abstract rows mirror that grid with placeholder bars in each slot.
          el('div', { class: 'hint-pp-list' },
            // Headache row (concrete) — first row, gets clicked
            el('div', { class: 'hint-pp-row concrete' },
              el('span', { class: 'hint-pp-checkbox' }),
              el('div', { class: 'hint-pp-info' },
                el('span', { class: 'hint-pp-name' }, tSymptom('Headache')),
                el('span', { class: 'hint-pp-date' }, t('Reported recently')),
              ),
              el('div', { class: 'hint-pp-row-dots' },
                el('span', { class: 'hint-pp-row-dot' }),
                el('span', { class: 'hint-pp-row-dot' }),
              ),
              el('span', { class: 'hint-pp-chev' }, '›'),
              el('div', { class: 'hint-target hint-pp-target-row' }),
            ),
            el('div', { class: 'hint-pp-row abstract' },
              el('span', { class: 'hint-pp-checkbox' }),
              el('div', { class: 'hint-pp-info' },
                el('span', { class: 'hint-pp-name-bar' }),
                el('span', { class: 'hint-pp-date-bar' }),
              ),
              el('div', { class: 'hint-pp-row-dots' },
                el('span', { class: 'hint-pp-row-dot' }),
                el('span', { class: 'hint-pp-row-dot' }),
              ),
              el('span', { class: 'hint-pp-chev abstract' }, '›'),
            ),
            el('div', { class: 'hint-pp-row abstract' },
              el('span', { class: 'hint-pp-checkbox' }),
              el('div', { class: 'hint-pp-info' },
                el('span', { class: 'hint-pp-name-bar short' }),
                el('span', { class: 'hint-pp-date-bar' }),
              ),
              el('div', { class: 'hint-pp-row-dots' },
                el('span', { class: 'hint-pp-row-dot' }),
                el('span', { class: 'hint-pp-row-dot' }),
              ),
              el('span', { class: 'hint-pp-chev abstract' }, '›'),
            ),
          ),
        ),
      ),
      // SCREEN 2: past-problems list with question modal overlay
      el('div', { class: 'hint-screen hint-pp-screen-modal' },
        hintMiniHeader('past-problems'),
        el('div', { class: 'hint-pp-body dim' }),
        el('div', { class: 'hint-pp-modal' },
          el('div', { class: 'hint-pp-modal-title' }, tSymptom('Headache')),
          el('div', { class: 'hint-pp-modal-prompt' }),
          el('div', { class: 'hint-pp-modal-options' },
            el('div', { class: 'hint-pp-modal-option' },
              el('span', { class: 'hint-bp-symptom-bar' }),
            ),
            el('div', { class: 'hint-pp-modal-option' },
              el('span', { class: 'hint-bp-symptom-bar short' }),
            ),
            el('div', { class: 'hint-pp-modal-option' },
              el('span', { class: 'hint-bp-symptom-bar' }),
            ),
            el('div', { class: 'hint-pp-modal-option' },
              el('span', { class: 'hint-bp-symptom-bar short' }),
            ),
          ),
          el('div', { class: 'hint-pp-modal-dots' },
            el('span', { class: 'hint-pp-dot active' }),
            el('span', { class: 'hint-pp-dot' }),
            el('span', { class: 'hint-pp-dot' }),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-pp-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Edit a problem -----------------------------------------
  // Problem Station rows are clickable — clicking one re-opens the question
  // modal in edit mode (pre-fills the user's previous answer; writes back
  // live). Demo teaches that you click a row to revise a rating.
  // Flow (10s loop):
  //   0.00–0.05  cursor idle bottom-right; home visible (concrete Headache row)
  //   0.05–0.22  cursor glides up to the Headache row in the Problem Station
  //   0.22–0.25  click pulse on the row
  //   0.25–0.30  home fades out → modal fades in
  //   0.30–0.50  cursor glides down to a different rating option in the modal
  //   0.50–0.55  click pulse on the new option; option highlights as selected
  //   0.55–0.95  HOLD on highlighted option
  //   0.95–1.00  fade back to start
  function editProblemsHintStage() {
    return el('div', { class: 'hint-stage hint-edit-stage' },
      // SCREEN 0: home with a concrete Problem Station card on the right.
      // Inside the card: a concrete "Headache" row (gray border, name + 3
      // answer dots — 1 filled green to mimic an in-progress symptom) plus
      // an abstract row beneath it. Everything else (header nav, left-column
      // cards) stays abstract so the eye lands on the click target.
      el('div', { class: 'hint-screen hint-edit-screen-home' },
        hintMiniHeader(null),
        el('div', { class: 'hint-mini-body' },
          el('div', { class: 'hint-mini-row' },
            el('div', { class: 'hint-mini-left' },
              el('div', { class: 'hint-mini-card hint-mini-past' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-card-bar' }),
                el('div', { class: 'hint-mini-card-bar short' }),
              ),
              el('div', { class: 'hint-mini-card hint-mini-graph' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-graph-bars' },
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '70%', background: 'var(--spots-red)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '52%', background: 'var(--spots-green)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '38%', background: 'var(--spots-teal)' } }),
                ),
              ),
            ),
            el('div', { class: 'hint-mini-card hint-edit-station' },
              el('div', { class: 'hint-edit-station-title' }, t('Problem Station')),
              el('div', { class: 'hint-edit-station-rows' },
                el('div', { class: 'hint-edit-ps-row concrete' },
                  el('span', { class: 'hint-edit-ps-name' }, tSymptom('Headache')),
                  el('span', { class: 'hint-edit-ps-dots' },
                    el('span', { class: 'hint-edit-ps-dot is-on' }),
                    el('span', { class: 'hint-edit-ps-dot' }),
                    el('span', { class: 'hint-edit-ps-dot' }),
                  ),
                  el('div', { class: 'hint-target hint-edit-target-row' }),
                ),
                el('div', { class: 'hint-edit-ps-row abstract' },
                  el('span', { class: 'hint-edit-ps-name-bar' }),
                  el('span', { class: 'hint-edit-ps-dots' },
                    el('span', { class: 'hint-edit-ps-dot' }),
                    el('span', { class: 'hint-edit-ps-dot' }),
                    el('span', { class: 'hint-edit-ps-dot' }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      // SCREEN 1: question modal overlay over a dimmed home body.
      // Modal mirrors the real edit-mode modal: title "Headache", prompt bar,
      // 4 rating pills in escalating blue intensities (2nd one is pre-selected
      // to reflect the user's prior answer), then progress dots, then
      // Close / Next buttons. The cursor clicks the 3rd option, which then
      // becomes the highlighted selection.
      el('div', { class: 'hint-screen hint-edit-screen-modal' },
        hintMiniHeader(null),
        el('div', { class: 'hint-mini-body dim' }),
        el('div', { class: 'hint-edit-modal' },
          el('div', { class: 'hint-edit-modal-title' }, tSymptom('Headache')),
          el('div', { class: 'hint-edit-modal-prompt' }),
          el('div', { class: 'hint-edit-modal-options' },
            el('div', { class: 'hint-edit-modal-option' }),
            el('div', { class: 'hint-edit-modal-option was-selected' }),
            el('div', { class: 'hint-edit-modal-option becomes-selected' },
              el('div', { class: 'hint-target hint-edit-target-option' }),
            ),
            el('div', { class: 'hint-edit-modal-option' }),
          ),
          el('div', { class: 'hint-edit-modal-dots' },
            el('span', { class: 'hint-edit-pd active' }),
            el('span', { class: 'hint-edit-pd' }),
            el('span', { class: 'hint-edit-pd' }),
          ),
          el('div', { class: 'hint-edit-modal-actions' },
            el('div', { class: 'hint-edit-btn' }, 'Close'),
            el('div', { class: 'hint-edit-btn primary' }, 'Next'),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-edit-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Delete a problem ---------------------------------------
  // The trash icon on each Problem Station row removes the symptom from the
  // cart. Demo teaches that clicking the red trash glyph deletes the entry.
  // Flow (10s loop):
  //   0.00–0.05  cursor idle bottom-right; row visible
  //   0.05–0.32  cursor glides to the trash icon on the Headache row
  //   0.32–0.36  click pulse on the trash icon
  //   0.36–0.55  Headache row fades / slides out (gets removed)
  //   0.55–0.95  HOLD on empty Problem Station (only "no problems" state)
  //   0.95–1.00  fade back to start
  function deleteProblemHintStage() {
    return el('div', { class: 'hint-stage hint-del-stage' },
      el('div', { class: 'hint-screen hint-del-screen' },
        hintMiniHeader(null),
        el('div', { class: 'hint-mini-body' },
          el('div', { class: 'hint-mini-row' },
            el('div', { class: 'hint-mini-left' },
              el('div', { class: 'hint-mini-card hint-mini-past' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-card-bar' }),
                el('div', { class: 'hint-mini-card-bar short' }),
              ),
              el('div', { class: 'hint-mini-card hint-mini-graph' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-graph-bars' },
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '70%', background: 'var(--spots-red)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '52%', background: 'var(--spots-green)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '38%', background: 'var(--spots-teal)' } }),
                ),
              ),
            ),
            el('div', { class: 'hint-mini-card hint-edit-station' },
              el('div', { class: 'hint-edit-station-title' }, t('Problem Station')),
              el('div', { class: 'hint-edit-station-rows' },
                // Wrap the concrete row in a collapse-only container. The
                // wrapper animates `max-height` + `margin-bottom` to nothing
                // (with `overflow: hidden`) so the row inside keeps its full
                // border/padding chassis stable — animating the row's own
                // border/padding produced visible jitter on the orange 2px
                // border as it shrank.
                el('div', { class: 'hint-del-row-wrap' },
                  el('div', { class: 'hint-edit-ps-row concrete' },
                    el('span', { class: 'hint-edit-ps-name' }, tSymptom('Headache')),
                    el('span', { class: 'hint-del-ps-right' },
                      el('span', { class: 'hint-edit-ps-dots' },
                        el('span', { class: 'hint-edit-ps-dot is-on' }),
                        el('span', { class: 'hint-edit-ps-dot' }),
                        el('span', { class: 'hint-edit-ps-dot' }),
                      ),
                      el('span', { class: 'hint-del-ps-trash', html: TRASH_SVG }),
                    ),
                    el('div', { class: 'hint-target hint-del-target-trash' }),
                  ),
                ),
                // Empty-state placeholder fades IN once the wrapper has
                // collapsed — gives the user a clear "deleted" confirmation.
                el('div', { class: 'hint-del-ps-empty' }, t('You have not reported any problems yet.')),
              ),
            ),
          ),
        ),
      ),
      el('div', { class: 'hint-cursor hint-del-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // ---- Hint demo: Completed a session (logout flow) ------------------------
  // Logout is what closes/advances a session in this build. Demo teaches the
  // user to open the avatar dropdown and click "Logout".
  // Flow (10s loop):
  //   0.00–0.05  cursor idle bottom-right
  //   0.05–0.27  cursor glides up-right to avatar in mini header
  //   0.27–0.32  click pulse on avatar; dropdown panel fades in
  //   0.32–0.55  cursor glides down-left to the Logout button in the dropdown
  //   0.55–0.60  click pulse on Logout; Logout button highlights
  //   0.60–0.95  HOLD on highlighted Logout
  //   0.95–1.00  fade back to start
  function completedHintStage() {
    // Concrete dropdown panel rendered as the avatar's open menu. Mirrors
    // `.user-menu-panel` visually (white card, arrow, "Logged in as: User",
    // divider, red Logout button) — but at mini-stage scale.
    const dropdown = el('div', { class: 'hint-comp-dropdown' },
      el('div', { class: 'hint-comp-arrow' }),
      el('div', { class: 'hint-comp-info' },
        el('div', { class: 'hint-comp-label' }, t('Logged in as:')),
        el('div', { class: 'hint-comp-value' }, t('User')),
      ),
      el('div', { class: 'hint-comp-divider' }),
      el('div', { class: 'hint-comp-logout' },
        t('Logout'),
        // Pulse target — animated via CSS so the demo lines up with the
        // cursor's click moment without any JS scheduling.
        el('div', { class: 'hint-target hint-comp-target-logout' }),
      ),
    );

    return el('div', { class: 'hint-stage hint-comp-stage' },
      // Single screen — the demo never navigates away. The avatar is the
      // only concrete header element (rest stays abstract dots); the body
      // beneath is the same mini-home layout as the other demos so the user
      // sees they're "on a page" when the dropdown opens.
      el('div', { class: 'hint-screen hint-comp-screen' },
        hintMiniHeader(null, el('div', { class: 'hint-target hint-comp-target-avatar' }), { concreteAvatar: true }),
        el('div', { class: 'hint-mini-body' },
          el('div', { class: 'hint-mini-row' },
            el('div', { class: 'hint-mini-left' },
              el('div', { class: 'hint-mini-card hint-mini-past' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-card-bar' }),
                el('div', { class: 'hint-mini-card-bar short' }),
              ),
              el('div', { class: 'hint-mini-card hint-mini-graph' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-graph-bars' },
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '70%', background: 'var(--spots-red)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '52%', background: 'var(--spots-green)' } }),
                  el('div', { class: 'hint-mini-graph-bar', style: { width: '38%', background: 'var(--spots-teal)' } }),
                ),
              ),
            ),
            el('div', { class: 'hint-mini-card hint-mini-station' },
              el('div', { class: 'hint-mini-card-bar wide' }),
              el('div', { class: 'hint-mini-card-bar' }),
              el('div', { class: 'hint-mini-card-bar short' }),
            ),
          ),
        ),
        dropdown,
      ),
      el('div', { class: 'hint-cursor hint-comp-cursor', html: HINT_CURSOR_SVG }),
    );
  }

  // First-load orientation popup. Shown ONCE on the home screen in session
  // 1, right after the user clicks "Get Started" on the welcome screen.
  // Calls out the floating tutorial-progress button (top-right) and the
  // per-step `?` hint buttons inside it. Dismissed via the "Got it!"
  // button, Escape, or backdrop click. State lives on `introDismissed`.
  function introModal() {
    if (state.introDismissed) return null;
    if (state.session !== 1) return null;
    if (state.screen !== 'home') return null;

    function dismiss() {
      state.introDismissed = true;
      render();
    }

    // Mini-illustration of the tutorial dock — same chrome (ring + cap icon)
    // as the live dock so the user recognizes it.
    const dockMini = el('div', { class: 'intro-dock-mini', 'aria-hidden': 'true' },
      el('span', { class: 'intro-dock-ring', html:
        '<svg viewBox="0 0 60 60" aria-hidden="true">' +
          '<circle cx="30" cy="30" r="26" fill="none" stroke-width="4" />' +
          '<circle cx="30" cy="30" r="26" fill="none" stroke-width="4" ' +
          'stroke-linecap="round" stroke-dasharray="163.36" stroke-dashoffset="98" ' +
          'transform="rotate(-90 30 30)" />' +
        '</svg>'
      }),
      el('span', { class: 'intro-dock-cap', html:
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path fill="currentColor" d="M12 3L1.5 8.5 12 14l8.5-4.46V15a.75.75 0 0 0 1.5 0V8.5L12 3z"/>' +
          '<path fill="currentColor" d="M5 12.18v3.05c0 .66.39 1.26 1 1.53 1.74.79 3.83 1.24 6 1.24s4.26-.45 6-1.24c.61-.27 1-.87 1-1.53v-3.05L12 15.5l-7-3.32z"/>' +
        '</svg>'
      }),
    );

    return el('div', {
      class: 'modal-backdrop intro-backdrop',
      onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) dismiss(); },
    },
      el('div', {
        class: 'modal-card tutorial-popup intro-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'intro-modal-title',
        onclick: (e) => e.stopPropagation(),
      },
        el('h2', { id: 'intro-modal-title' }, t('Quick Tutorial Tips')),
        el('p', { class: 'tutorial-popup-sub' }, t('Two things to know before you start:')),
        el('div', { class: 'intro-rows' },
          el('div', { class: 'intro-row' },
            dockMini,
            el('p', {}, t('Your tutorial progress lives in the top-right corner. Click it any time to see your steps.')),
          ),
          el('div', { class: 'intro-row' },
            el('span', { class: 'intro-hint-badge', 'aria-hidden': 'true' }, '?'),
            el('p', {}, t('Inside tutorial progress, click the ? next to any step to watch a quick demo.')),
          ),
        ),
        el('div', { class: 'tutorial-popup-actions' },
          el('button', { class: 'btn-pill primary', onclick: dismiss }, t('Got it!')),
        ),
      ),
    );
  }

  // Session-2 login prompt. Shown when the user lands on the login screen
  // (only reachable via logout() at the end of session 1). Tells the user
  // they need to sign back in to begin session 2, so the screen change
  // doesn't feel like an unexplained dead end. Uses the same chassis as
  // the welcome intro popup for visual consistency.
  function loginPromptModal() {
    if (state.loginPromptDismissed) return null;
    if (state.screen !== 'login') return null;

    function dismiss() {
      state.loginPromptDismissed = true;
      render();
    }

    return el('div', {
      class: 'modal-backdrop intro-backdrop',
      onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) dismiss(); },
    },
      el('div', {
        class: 'modal-card tutorial-popup login-prompt-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'login-prompt-title',
        onclick: (e) => e.stopPropagation(),
      },
        el('h2', { id: 'login-prompt-title' }, t('Session 1 complete!')),
        el('p', { class: 'tutorial-popup-sub' }, t('Please sign back in to start your second session.')),
        el('p', { class: 'login-prompt-body' },
          t("Great work — you finished session 1. Use the form below to log back in and pick up where you left off."),
        ),
        el('div', { class: 'tutorial-popup-actions' },
          el('button', { class: 'btn-pill primary', onclick: dismiss }, t('Got it!')),
        ),
      ),
    );
  }

  function hintModal() {
    const key = state.activeHintKey;
    if (!key) return null;

    function close() {
      state.activeHintKey = null;
      render();
    }

    const cursorSvg = HINT_CURSOR_SVG;

    let body;
    let title = t('Walkthrough');
    if (key === 'search') {
      title = t('How to use Search');
      // Mini header — abstract by design. Only the icon we're navigating to
      // (Search) renders as the real nav SVG; the rest are plain colored
      // circles in the SPOTS palette so the user's eye lands on the live
      // target. Same approach for the body of each screen: abstract bars
      // for non-interacted areas, real elements for the things being clicked
      // or typed into.
      const navDot = (cls) => el('div', { class: 'hint-nav-dot ' + cls });
      const miniHeader = (extras) => el('div', { class: 'hint-mini-header' },
        el('img', { class: 'hint-mini-corner', src: './assets/Spots-curve.svg', alt: '' }),
        el('div', { class: 'hint-mini-nav' },
          navDot('hnd-past'),
          navDot('hnd-body'),
          navDot('hnd-act'),
          navDot('hnd-feel'),
          el('img', { class: 'hint-mini-navicon hint-mini-navicon-search', src: NAV_ICONS['search'], alt: '' }),
          navDot('hnd-report'),
        ),
        el('div', { class: 'hint-mini-user' },
          el('div', { class: 'hint-mini-gear' }),
          el('div', { class: 'hint-mini-avatar' }),
        ),
        extras || null,
      );

      body = el('div', { class: 'hint-stage' },
        // Mini home screen — abstract layout that mirrors the real home page:
        // Past Problems callout next to the Problem Station sidebar on top,
        // summary chart card below. Nothing here is interacted with — the
        // only target is the Search nav icon up in the header.
        el('div', { class: 'hint-screen hint-screen-home' },
          miniHeader(el('div', { class: 'hint-target hint-target-search' })),
          el('div', { class: 'hint-mini-body' },
            el('div', { class: 'hint-mini-row' },
              el('div', { class: 'hint-mini-left' },
                el('div', { class: 'hint-mini-card hint-mini-past' },
                  el('div', { class: 'hint-mini-card-bar wide' }),
                  el('div', { class: 'hint-mini-card-bar' }),
                  el('div', { class: 'hint-mini-card-bar short' }),
                ),
                el('div', { class: 'hint-mini-card hint-mini-graph' },
                  el('div', { class: 'hint-mini-card-bar wide' }),
                  el('div', { class: 'hint-mini-graph-bars' },
                    el('div', { class: 'hint-mini-graph-bar', style: { width: '70%', background: 'var(--spots-red)' } }),
                    el('div', { class: 'hint-mini-graph-bar', style: { width: '52%', background: 'var(--spots-green)' } }),
                    el('div', { class: 'hint-mini-graph-bar', style: { width: '38%', background: 'var(--spots-teal)' } }),
                  ),
                ),
              ),
              el('div', { class: 'hint-mini-card hint-mini-station' },
                el('div', { class: 'hint-mini-card-bar wide' }),
                el('div', { class: 'hint-mini-card-bar' }),
                el('div', { class: 'hint-mini-card-bar short' }),
              ),
            ),
          ),
        ),
        // Mini search screen — only the input and the "Headache" row that
        // gets clicked are concrete. Title, subtitle, and other rows are
        // abstract bars.
        el('div', { class: 'hint-screen hint-screen-search' },
          miniHeader(),
          el('div', { class: 'hint-search-body' },
            el('div', { class: 'hint-blurb-line title' }),
            el('div', { class: 'hint-blurb-line short centered' }),
            el('div', { class: 'hint-search-input' },
              el('span', { class: 'hint-search-input-text' }),
              el('span', { class: 'hint-search-caret' }),
              el('span', { class: 'hint-search-input-icon' }),
              el('div', { class: 'hint-target hint-target-input' }),
            ),
            el('div', { class: 'hint-search-results' },
              el('div', { class: 'hint-search-row hint-search-row-1 hint-result-real' },
                el('span', { class: 'hint-result-name' }, tSymptom('Headache')),
                el('span', { class: 'hint-row-chev' }, '›'),
                el('div', { class: 'hint-target hint-target-row' }),
              ),
              el('div', { class: 'hint-search-row hint-result-abstract hint-result-2' },
                el('span', { class: 'hint-blurb-line abstract-row' }),
              ),
              el('div', { class: 'hint-search-row hint-result-abstract hint-result-3' },
                el('span', { class: 'hint-blurb-line abstract-row short' }),
              ),
            ),
          ),
        ),
        // The animated cursor sits above both screens
        el('div', { class: 'hint-cursor', html: cursorSvg }),
      );
    } else if (key === 'body-parts') {
      title = t('How to pick a Body Part');
      body = bodyPartsHintStage();
    } else if (key === 'activities') {
      title = t('How to pick an Activity');
      body = activitiesHintStage();
    } else if (key === 'feelings') {
      title = t('How to pick a Feeling');
      body = feelingsHintStage();
    } else if (key === 'past-problems') {
      title = t('How to use Past Problems');
      body = pastProblemsHintStage();
    } else if (key === 'reviewed') {
      title = t('How to edit a problem');
      body = editProblemsHintStage();
    } else if (key === 'delete') {
      title = t('How to delete a problem');
      body = deleteProblemHintStage();
    } else if (key === 'completed') {
      title = t('How to complete a session');
      body = completedHintStage();
    } else {
      // Defensive fallback — shouldn't be reachable since other rows can't open.
      body = el('div', { class: 'hint-stage hint-stage-empty' },
        el('div', { class: 'hint-empty' }, t('Walkthrough coming soon.')),
      );
    }

    return el('div', {
      class: 'modal-backdrop hint-backdrop',
      onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) close(); },
    },
      el('div', {
        class: 'modal-card tutorial-popup hint-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'hint-modal-title',
        onclick: (e) => e.stopPropagation(),
      },
        el('button', {
          class: 'hint-close',
          'aria-label': t('Close walkthrough'),
          onclick: close,
        }, '×'),
        el('h2', { id: 'hint-modal-title' }, title),
        el('p', { class: 'tutorial-popup-sub' }, t('Watch the example below')),
        body,
        el('div', { class: 'tutorial-popup-actions' },
          el('button', { class: 'btn-pill primary', onclick: close }, t('Got it')),
        ),
      ),
    );
  }

  // Open the question modal in EDIT mode for an already-selected symptom.
  // The modal pre-fills each rating with the user's previous choice and writes
  // edits BACK TO THE ORIGINAL `state.selected` entry live (no Save button) —
  // see the `setAnswer` path in `questionModal()`. We keep a `pendingSymptom`
  // pointer here only so the modal can read the symptom's name/answers for
  // rendering; we do NOT clone the answers (writes target the original).
  //
  // Clicking a Problem Station row to open the modal satisfies session 2's
  // "Edit your problems" tutorial milestone. Session 1 no longer has an edit
  // step — its tutorial step is "Delete a problem", set in the trash button
  // handler in problemStation().
  function openEditSymptom(sym) {
    state.editingSymptomId = sym.id;
    state.pendingSymptom = sym;
    state.questionStep = 0;
    if (state.session === 2) state.tutorialFlags.session2VisitedReview = true;
    render();
  }

  function questionModal() {
    const sym = state.pendingSymptom;
    if (!sym) return null;
    // Per-symptom required question ids — feelings get 2 steps, others 3.
    // The modal's step count, progress dots, and prompts are all driven from
    // this list (not `D.ratingQuestions.length`). Each id here is looked up
    // against D.ratingQuestions for its prompt + option set.
    const stepIds = questionIdsForSymptom(sym);
    const totalSteps = stepIds.length;
    // Clamp the step in case state was carried over from a different symptom
    // (e.g. switching from a 3-step body_parts symptom to a 2-step feelings
    // symptom while editing). Without this the modal could land out of bounds.
    if (state.questionStep >= totalSteps) state.questionStep = totalSteps - 1;
    const step = state.questionStep;
    const qid = stepIds[step];
    const q = D.ratingQuestions.find(rq => rq.id === qid);
    // Defensive: if a stepId is somehow not in `D.ratingQuestions` (could only
    // happen via a data mismatch), bail rather than crash on `q.id`.
    if (!q) {
      console.warn('questionModal: unknown question id', qid);
      return null;
    }
    const current = sym.answers[q.id];
    const isEditMode = !!state.editingSymptomId;
    const isLastStep = step + 1 === totalSteps;

    function close() {
      // Closing the modal — add or edit — never sets `completedSession`.
      // Session completion happens in `logout()`.
      state.pendingSymptom = null;
      state.editingSymptomId = null;
      state.questionStep = 0;
      render();
    }

    function next() {
      if (step + 1 < totalSteps) { state.questionStep = step + 1; render(); }
      else if (isEditMode) {
        // Edit-mode "Done": same as Close — dismiss the modal.
        close();
      } else {
        // Add-mode finalize (Save on last step). Push the new symptom into
        // the cart and bump the per-session counter. Session completion is
        // gated on logout (see `logout()`), not on adding a problem.
        state.selected.push(sym);
        // Sticky per-page tutorial flags. We attribute the milestone to the
        // SCREEN the user picked from (`originScreen`), not the underlying
        // category — a Search result for a body_parts symptom credits "Use
        // Search", not "Pick a Body Parts symptom".
        const origin = sym.originScreen;
        if (origin === 'search') state.tutorialFlags.usedSearch = true;
        else if (origin === 'body-parts' || origin === 'body-part-detail') state.tutorialFlags.pickedBodyParts = true;
        else if (origin === 'activities' || origin === 'activity-detail') state.tutorialFlags.pickedActivities = true;
        else if (origin === 'feelings') state.tutorialFlags.pickedFeelings = true;
        // Session-2 "Add a past problem" step credits a prior-problems pick.
        if (sym.category === 'prior_problems') state.tutorialFlags.session2AddedPastProblem = true;
        // Per-session report counter — powers the session-2 "Report a new
        // problem" step. Reset on logout, so a session-1 report does NOT
        // pre-credit the user in session 2.
        state.sessionProblemsLogged += 1;
        state.pendingSymptom = null;
        state.questionStep = 0;
        render();
      }
    }
    function back() {
      if (step > 0) { state.questionStep = step - 1; render(); }
      // Add-mode: Back on step 0 acts as Cancel (closes the modal — the user
      // hasn't committed the new symptom yet). Edit-mode: Back on step 0 is
      // routed to close() so it dismisses cleanly (edits already persisted
      // live; nothing to discard). Earlier this was disabled with no exit
      // beyond the bottom-right button, which felt cramped.
      else close();
    }

    // Write an answer to the live symptom. In add-mode `sym === pendingSymptom`
    // (not yet in `state.selected`); in edit-mode `sym` IS the entry in
    // `state.selected` (pendingSymptom points at it directly — see
    // `openEditSymptom`), so this mutation is what makes edits persist live.
    //
    // No auto-advance. Both add- and edit-mode require an explicit click on
    // Next / Done — picking a rating only writes the answer. This is more
    // predictable: tapping the wrong option doesn't shoot the user forward
    // a step, and the user can re-click the same option without consequence.
    function setAnswer(value) {
      sym.answers[q.id] = value;
      render();
    }

    // Edit-mode bottom row: Back + Next/Done.
    // Add-mode bottom row: Cancel/Back + Next/Save.
    let primaryLabel;
    const NEXT = t('Next');
    if (isEditMode) primaryLabel = isLastStep ? t('Done') : NEXT;
    else primaryLabel = isLastStep ? t('Save') : NEXT;
    // In edit-mode every step is always advanceable — the answer is already
    // populated (the user edited an EXISTING symptom; we pre-fill from
    // `sym.answers`). Even if `current === undefined` we still let them step
    // forward without changing anything; the existing answer is preserved.
    // In add-mode keep the original gating: must pick a rating to proceed.
    const primaryDisabled = isEditMode ? false : (current === undefined);

    // Prompt text per question id. Falls back to the q.prompt string if the
    // id isn't one of the three known ones — but in practice we only ever
    // see frequency/severity/interference here.
    let promptText;
    const symLower = tSymptom(sym.name).toLowerCase();
    if (q.id === 'frequency') promptText = t(
      `In the past 7 days, how often did you have ${symLower}?`,
      `En los últimos 7 días, ¿con qué frecuencia tuviste ${symLower}?`
    );
    else if (q.id === 'severity') promptText = t(
      `In the past 7 days, how bad was ${symLower} at its worst?`,
      `En los últimos 7 días, ¿qué tan grave fue ${symLower} en su peor momento?`
    );
    else if (q.id === 'interference') promptText = t(
      `In the past 7 days, how much did ${symLower} get in the way of things you wanted to do?`,
      `En los últimos 7 días, ¿cuánto te impidió ${symLower} hacer las cosas que querías hacer?`
    );
    else promptText = q.prompt;

    return el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) close(); } },
      el('div', {
        class: 'modal-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'q-modal-title',
      },
        el('h2', { id: 'q-modal-title' }, tSymptom(sym.name)),
        el('div', { class: 'q-prompt', id: 'q-modal-prompt' }, promptText),
        el('div', {
          class: 'rating-col',
          role: 'radiogroup',
          'aria-labelledby': 'q-modal-prompt',
        },
          q.options.map(opt => el('button', {
            class: 'rating-btn' + (current === opt.value ? ' is-selected' : ''),
            role: 'radio',
            'aria-checked': current === opt.value ? 'true' : 'false',
            'data-level': String(Math.min(opt.value, 3)),
            onclick: () => setAnswer(opt.value),
          }, tOption(opt.label))),
        ),
        // Progress dots reflect the per-symptom step count — 2 for feelings,
        // 3 otherwise. Earlier versions hard-coded 3 dots regardless.
        el('div', { class: 'progress-dots' },
          ...Array.from({ length: totalSteps }, (_, i) =>
            el('span', { class: 'pd' + (i <= step ? ' is-active' : '') })),
        ),
        el('div', { class: 'modal-actions' },
          el('button', {
            class: 'btn-pill',
            onclick: back,
          }, step === 0 ? (isEditMode ? t('Close') : t('Cancel')) : t('Back')),
          el('button', {
            class: 'btn-pill primary',
            disabled: primaryDisabled ? '' : null,
            onclick: next,
          }, primaryLabel),
        ),
      ),
    );
  }

  // ----------------------------- login / session 2 -----------------------------
  // Visually mirrors the production LoginForm (see spots-app-main
  // `_components/auth/LoginPageLayout.tsx` + `LoginForm.tsx`): decorative
  // bubbles top-left, "Welcome to" + SPOTS wordmark, white bordered card
  // containing the Sign In form, then an info box below.
  //
  // In the tutorial this is purely visual — any submission bumps
  // `state.session = 2` and routes to welcome-back. No validation.
  function loginScreen() {
    const submit = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      state.session = 2;
      go('welcome-back');
    };
    const toggleShowPassword = (e) => {
      e.preventDefault();
      const wrap = e.currentTarget.closest('.login-pw-wrap');
      if (!wrap) return;
      const input = wrap.querySelector('input');
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      e.currentTarget.setAttribute('aria-label', showing ? t('Show password') : t('Hide password'));
      e.currentTarget.querySelector('.eye-open').style.display = showing ? 'inline' : 'none';
      e.currentTarget.querySelector('.eye-closed').style.display = showing ? 'none' : 'inline';
    };

    const googleSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 31.7 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.3 3 3 12.3 3 24s9.3 21 21 21 21-9.3 21-21c0-1.4-.1-2.7-.4-4z"/>' +
      '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16.2 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 16.1 3 9.2 7.1 6.3 14.7z"/>' +
      '<path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.1C29.1 36.5 26.7 37 24 37c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.1 40.9 16 45 24 45z"/>' +
      '<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3-3.5 5.4-6.3 6.7l6.2 5.1C37.3 41.6 42 37 42 29c0-1.4-.1-2.7-.4-4.5z"/>' +
      '</svg>';

    const eyeOpenSvg =
      '<svg class="eye-open" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 12c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3z"/>' +
      '</svg>';
    const eyeClosedSvg =
      '<svg class="eye-closed" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" style="display:none">' +
      '<path fill="currentColor" d="M2 4.27l1.41-1.41L20.73 20.18l-1.41 1.41-2.65-2.65A11.3 11.3 0 0 1 12 19c-7 0-11-7-11-7a18.4 18.4 0 0 1 4.66-5.4L2 4.27zM12 9a3 3 0 0 1 3 3c0 .35-.06.68-.18.99l-3.81-3.81c.31-.12.64-.18.99-.18zm0-4c7 0 11 7 11 7a18.5 18.5 0 0 1-3.04 4.04l-2.06-2.06A6 6 0 0 0 12 7c-.34 0-.67.04-.99.1L9.45 5.55C10.27 5.2 11.12 5 12 5z"/>' +
      '</svg>';

    return el('div', { class: 'login-page-layout' },
      // Decorative bubbles in the top-left, mirroring production
      el('div', { class: 'deco-bubbles' },
        el('img', {
          src: './assets/Spot_Assets-01.svg',
          alt: '',
          'aria-hidden': 'true',
        }),
      ),
      el('main', { class: 'login-main' },
      el('section', { class: 'login-section' },
        // Welcome logo block: "Welcome to" + SPOTS wordmark
        el('div', { class: 'welcome-logo' },
          el('p', { class: 'welcome-greet' }, t('Welcome to')),
          el('div', { class: 'welcome-logo-img' },
            el('img', {
              src: './assets/Spots-Logo-UpdatedBG.svg',
              alt: 'SPOTS',
              width: '240',
              height: '112',
            }),
          ),
        ),
        // Main login card
        el('div', { class: 'login-card' },
          el('h1', { class: 'login-title', id: 'login-title' }, t('Sign In')),
          el('form', {
            class: 'login-form',
            'aria-labelledby': 'login-title',
            onsubmit: submit,
          },
            el('input', {
              class: 'login-input',
              type: 'text',
              name: 'username',
              placeholder: t('Username or Email'),
              'aria-label': t('Username or email'),
              autocomplete: 'username',
              value: state.user.name,
            }),
            el('div', { class: 'login-pw-wrap' },
              el('input', {
                class: 'login-input',
                type: 'password',
                name: 'password',
                placeholder: t('Password'),
                'aria-label': t('Password'),
                autocomplete: 'current-password',
                // Tutorial: pre-fill a placeholder so the form looks ready
                // to submit. The browser renders this as dots regardless of
                // the string contents.
                value: 'tutorial-demo-pwd',
              }),
              el('button', {
                class: 'login-pw-toggle',
                type: 'button',
                'aria-label': t('Show password'),
                onclick: toggleShowPassword,
                html: eyeOpenSvg + eyeClosedSvg,
              }),
            ),
            el('button', {
              class: 'login-btn login-btn-primary',
              type: 'submit',
            }, t('Sign in')),
          ),
          el('div', { class: 'login-divider', role: 'separator', 'aria-label': t('or') },
            el('span', { class: 'login-divider-rule' }),
            el('span', { class: 'login-divider-text' }, t('OR')),
            el('span', { class: 'login-divider-rule' }),
          ),
          el('button', {
            class: 'login-btn login-btn-outline',
            type: 'button',
            onclick: submit, // tutorial: Google button just advances
          },
            el('span', { class: 'login-google-icon', html: googleSvg }),
            el('span', {}, t('Sign in with Google')),
          ),
          el('div', { class: 'login-links' },
            el('button', { class: 'login-link', type: 'button', onclick: submit }, t('Forgot password?')),
            el('button', { class: 'login-link', type: 'button', onclick: submit }, t('Sign up')),
          ),
        ),
        // Info box: matches the production layout (border, padded card with
        // an intro blurb). Copy mirrors the live site's SpotsIntro string.
        el('div', { class: 'login-info-box' },
          el('p', {},
            el('strong', {}, t("SPOTS (Supporting Pediatric Oncology Treatment Success) helps children and teens with cancer track how they're feeling throughout treatment — and share that information with their care team. This is a guided tutorial; no account is required."))),
        ),
      ),
      ),
      siteFooter(),
    );
  }

  // Session 2 entry screen — visually mirrors welcomeScreen() but with
  // returning-user copy. Dismiss → home (which now shows past-problems data
  // carried over from session 1).
  function welcomeBackScreen() {
    const dots = [
      { c: 'var(--spots-orange)',  s: 18, t: '12%', l: '8%' },
      { c: 'var(--spots-green)',   s: 12, t: '20%', l: '24%' },
      { c: 'var(--spots-yellow)',  s: 22, t: '78%', l: '12%', border: true },
      { c: 'var(--spots-feelings)',s: 14, t: '70%', l: '88%' },
      { c: 'var(--spots-red)',     s: 12, t: '14%', l: '86%' },
      { c: 'var(--spots-green)',   s: 16, t: '85%', l: '70%' },
    ];
    return el('div', {},
      siteHeader(),
      el('div', { class: 'welcome-wrap' },
        ...dots.map(d => el('span', {
          class: 'deco-dot',
          style: {
            top: d.t, left: d.l,
            width: d.s + 'px', height: d.s + 'px',
            background: d.border ? 'transparent' : d.c,
            border: d.border ? `2px solid ${d.c}` : 'none',
          },
        })),
        el('div', { class: 'welcome-card' },
          el('div', { class: 'welcome-greet' }, t('Welcome back to')),
          el('div', { class: 'welcome-logo' },
            el('img', { src: './assets/Spots-Logo-UpdatedBG.svg', alt: 'SPOTS' }),
          ),
          el('div', { class: 'tagline' }, t("Let's check in on how you've been.")),
          el('p', { class: 'blurb' }, t("We've kept the problems you reported last time. Take a look at your Past Problems, add anything new that's bothering you, and review when you're ready.")),
          el('button', { class: 'btn-primary', onclick: () => go('home') }, t('Continue →')),
        ),
      ),
      siteFooter(),
    );
  }

  // Terminal "Tutorial Complete" screen — reached at the end of Session 2.
  // No nav forward, no logout. Mirrors the welcome-screen chassis (deco dots
  // + centered card) for visual consistency. The header still renders so the
  // user can see their avatar; the account dropdown panel hides the logout/
  // finish button on this screen (see userMenu()).
  function tutorialCompleteScreen() {
    const dots = [
      { c: 'var(--spots-orange)',  s: 18, t: '12%', l: '8%' },
      { c: 'var(--spots-green)',   s: 12, t: '20%', l: '24%' },
      { c: 'var(--spots-yellow)',  s: 22, t: '78%', l: '12%', border: true },
      { c: 'var(--spots-feelings)',s: 14, t: '70%', l: '88%' },
      { c: 'var(--spots-red)',     s: 12, t: '14%', l: '86%' },
      { c: 'var(--spots-green)',   s: 16, t: '85%', l: '70%' },
    ];
    return el('div', {},
      siteHeader(),
      el('div', { class: 'welcome-wrap' },
        ...dots.map(d => el('span', {
          class: 'deco-dot',
          style: {
            top: d.t, left: d.l,
            width: d.s + 'px', height: d.s + 'px',
            background: d.border ? 'transparent' : d.c,
            border: d.border ? `2px solid ${d.c}` : 'none',
          },
        })),
        el('div', { class: 'welcome-card' },
          el('div', { class: 'check-circle tutorial-complete-check' }, '✓'),
          el('div', { class: 'welcome-greet' }, t("You've completed")),
          el('div', { class: 'welcome-logo' },
            el('img', { src: './assets/Spots-Logo-UpdatedBG.svg', alt: 'SPOTS' }),
          ),
          el('div', { class: 'tagline' }, t('the SPOTS tutorial.')),
          el('p', { class: 'blurb' }, t('Thanks for trying it out! You now know how to report body-part problems, activities, feelings, and how to revisit past problems on a return visit.')),
        ),
      ),
      siteFooter(),
    );
  }

  // ----------------------------- body SVG hotspots -----------------------------
  // Mirrors InteractiveBody.tsx in spots-app-main: load the SVG inline so we can
  // attach click + hover handlers to each .body-part group.
  const bodySvgCache = {};

  function loadAndWireBodySvgs() {
    const containers = document.querySelectorAll('.body-svg[data-svg-src]:not([data-wired])');
    containers.forEach((container) => {
      container.setAttribute('data-wired', '1');
      const src = container.getAttribute('data-svg-src');
      // Cache the fetch PROMISE (not just the resolved text) so concurrent
      // calls for the same URL share a single network roundtrip. When the
      // CSV-completion re-render runs while the SVG fetch is in flight, the
      // newly-created container hits this cached promise and gets the same
      // text — no extra request, no race.
      if (!bodySvgCache[src]) {
        const p = fetch(src)
          .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
          .catch(err => {
            // Don't lock the failure into the cache — drop it so a subsequent
            // render gets a clean retry. Otherwise one network hiccup would
            // leave the body figure permanently broken for the session.
            console.warn('body svg fetch failed', src, err);
            if (bodySvgCache[src] === p) delete bodySvgCache[src];
            return '';
          });
        bodySvgCache[src] = p;
      }
      bodySvgCache[src].then(text => {
        // Skip if `render()` recreated the DOM before the fetch resolved —
        // the closure-captured container is now detached. The new container
        // will run loadAndWireBodySvgs() itself and hit the cached promise.
        if (!text || !container.isConnected) return;
        container.innerHTML = text;
        const svg = container.querySelector('svg');
        if (!svg) return;
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        wireBodyHotspots(svg);
      });
    });
  }

  // Body parts whose visible artwork is too small for an easy hover target.
  // We inject an invisible circular hit-zone behind each so the user can find
  // them without pixel-perfect aim.
  const ZONE_PARTS = new Set(['left_eye', 'right_eye', 'nose', 'mouth']);

  function ensureHotspotZone(group) {
    if (group.querySelector('.hotspot-zone')) return;
    let bbox;
    try { bbox = group.getBBox(); } catch (e) { return; }
    if (!bbox || (bbox.width === 0 && bbox.height === 0)) return;
    const pad = 7;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const r = Math.max(bbox.width, bbox.height) / 2 + pad;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    circle.setAttribute('class', 'hotspot-zone');
    // Insert as first child so the actual eye/nose/mouth artwork renders on top.
    group.insertBefore(circle, group.firstChild);
  }

  function wireBodyHotspots(svg) {
    const groups = svg.querySelectorAll('.body-part');
    groups.forEach((g) => {
      const partKey = (g.getAttribute('data-partview') || g.id || '').toLowerCase();
      const bp = D.bodyParts.find(b => b.key === partKey);
      if (!bp) return;
      if (ZONE_PARTS.has(partKey)) ensureHotspotZone(g);
      g.style.cursor = 'pointer';
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', tLabel(bp));
      g.addEventListener('click', () => go('body-part-detail', { currentBodyPart: bp }));
      g.addEventListener('mouseenter', () => g.classList.add('highlighted'));
      g.addEventListener('mouseleave', () => g.classList.remove('highlighted'));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go('body-part-detail', { currentBodyPart: bp });
        }
      });
    });
    // Reveal facial-feature rings only while the cursor is inside the Head
    // region (Head's mouseenter fires when entering Head OR any descendant).
    const head = svg.querySelector('.body-part[data-partview="Head" i], #Head.body-part');
    if (head) {
      head.addEventListener('mouseenter', () => svg.classList.add('head-hover'));
      head.addEventListener('mouseleave', () => svg.classList.remove('head-hover'));
    }
  }

  // ----------------------------- router -----------------------------
  // Tracks whether the previous render had a modal open. Used to fire the
  // scroll-preserve/restore exactly once per modal-open / modal-close
  // transition (not every render — re-renders during modal-open shouldn't
  // re-capture the scroll position).
  let lastModalOpen = false;

  function applyModalScrollLock(isOpen) {
    if (isOpen && !lastModalOpen) {
      // Modal just opened — capture current scroll so we can restore it.
      const y = window.scrollY || window.pageYOffset || 0;
      document.body.style.setProperty('--scroll-y', `-${y}px`);
      document.body.dataset.scrollY = String(y);
      document.body.classList.add('modal-open');
    } else if (!isOpen && lastModalOpen) {
      // Modal closed — restore scroll. Read y BEFORE removing the class,
      // since clearing `position: fixed` snaps the page to top on iOS.
      const y = parseInt(document.body.dataset.scrollY || '0', 10);
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('--scroll-y');
      delete document.body.dataset.scrollY;
      window.scrollTo(0, y);
    }
    lastModalOpen = isOpen;
  }

  function render() {
    root.innerHTML = '';
    let view;
    switch (state.screen) {
      case 'welcome':            view = welcomeScreen(); break;
      case 'home':               view = homeScreen(); break;
      case 'past-problems':      view = pastProblemsScreen(); break;
      case 'body-parts':         view = bodyPartsScreen(); break;
      case 'body-part-detail':   view = bodyPartDetailScreen(); break;
      case 'activities':         view = activitiesScreen(); break;
      case 'activity-detail':    view = activityDetailScreen(); break;
      case 'feelings':           view = feelingsScreen(); break;
      case 'search':             view = searchScreen(); break;
      case 'login':              view = loginScreen(); break;
      case 'welcome-back':       view = welcomeBackScreen(); break;
      case 'tutorial-complete':  view = tutorialCompleteScreen(); break;
      default:
        console.warn('Unknown screen:', state.screen, '— falling back to welcome');
        view = welcomeScreen();
    }
    root.appendChild(view);
    const modal = questionModal();
    if (modal) root.appendChild(modal);
    // Floating tutorial-progress dock — present on every interactive screen.
    // Hidden on welcome (pre-session), login (logged out), welcome-back
    // (session 2 intro), and tutorial-complete (post-session) where progress
    // tracking isn't meaningful.
    const hideDockOn = new Set(['welcome', 'welcome-back', 'login', 'tutorial-complete']);
    if (!hideDockOn.has(state.screen)) {
      root.appendChild(tutorialDock());
    }
    const hint = hintModal();
    if (hint) root.appendChild(hint);
    const intro = introModal();
    if (intro) root.appendChild(intro);
    const loginPrompt = loginPromptModal();
    if (loginPrompt) root.appendChild(loginPrompt);

    // Lock body scroll while a modal is open so the page-behind doesn't
    // scroll on iOS / Android. `activity-detail` renders its own overlay
    // inside the screen (not via state flag) so we treat that screen as
    // a modal-open state too.
    const introOpen = !state.introDismissed && state.session === 1 && state.screen === 'home';
    const loginPromptOpen = !state.loginPromptDismissed && state.screen === 'login';
    const isModalOpen = !!(
      state.activeHintKey
      || state.pendingSymptom
      || state.screen === 'activity-detail'
      || introOpen
      || loginPromptOpen
    );
    applyModalScrollLock(isModalOpen);

    loadAndWireBodySvgs();
    // Search input loses focus across re-renders (every keystroke triggers
    // render → DOM rebuild → input recreated). Restore focus + put the caret
    // back at the end so typing continues uninterrupted.
    if (state.screen === 'search') {
      const input = root.querySelector('.search-box input');
      if (input && document.activeElement !== input) {
        input.focus();
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (e) { /* some input types don't support */ }
      }
    }
    // Modal focus: when a dialog is open, pull focus into it on first paint
    // and keep Tab cycling inside it.
    const dialogs = root.querySelectorAll('[role="dialog"]');
    const topDialog = dialogs[dialogs.length - 1];
    if (topDialog && !topDialog.contains(document.activeElement)) {
      const firstFocusable = topDialog.querySelector(FOCUSABLE_SELECTOR);
      if (firstFocusable) firstFocusable.focus();
    }
  }

  const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // Keep Tab inside the topmost dialog when one is open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const dialogs = root.querySelectorAll('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Global Esc handler — closes the hint modal, the question modal, the
  // welcome intro popup, or the account dropdown when any are open (in
  // priority order).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.activeHintKey) {
      state.activeHintKey = null;
      render();
    } else if (state.pendingSymptom) {
      state.pendingSymptom = null;
      state.editingSymptomId = null;
      state.questionStep = 0;
      render();
    } else if (!state.introDismissed && state.session === 1 && state.screen === 'home') {
      state.introDismissed = true;
      render();
    } else if (!state.loginPromptDismissed && state.screen === 'login') {
      state.loginPromptDismissed = true;
      render();
    } else if (state.userMenuOpen) {
      state.userMenuOpen = false;
      render();
    }
  });

  // Global click-outside handler — closes the account dropdown when the user
  // clicks anywhere that isn't the avatar trigger or the panel itself. The
  // trigger and panel both call e.stopPropagation() on their own clicks so
  // this fires only for "outside" clicks.
  document.addEventListener('click', () => {
    if (state.userMenuOpen) {
      state.userMenuOpen = false;
      render();
    }
  });

  render();

  // Fetch translations in the background. First render is English; once the
  // CSV lands, re-render so any Spanish-toggle clicks made during the fetch
  // window pick up real translations. Failure is non-fatal — the app keeps
  // working in English.
  loadTranslations().then(() => {
    if (translationsLoaded) render();
  });
})();
