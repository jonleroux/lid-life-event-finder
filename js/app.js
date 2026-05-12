/* =========================================================================
   Lid Life Event Finder v2 — app.js
   Design: Bone / Ink / Red · Anton · Barlow Condensed · JetBrains Mono
   Logic identical to dark prototype; only rendering layer replaced. v3
   Removed: save/bookmark, share popover, distance badge (not in v2 design).
   ========================================================================= */
(function () {
  "use strict";

  // ── Constants ─────────────────────────────────────────────────────────────
  var PAGE_SIZE   = 24;
  var LS_USER     = "ll_user_events";
  var LS_GEOCACHE = "ll_geocache";

  var TYPES = [
    { name: "Bike Meets"    },
    { name: "Track Days"    },
    { name: "Ride Outs"     },
    { name: "Shows & Events"},
    { name: "Race Meets"    },
    { name: "Rider Training"}
  ];

  // Short labels for the filter bar pills
  var TYPE_ABBR = {
    "Bike Meets":     "BIKE MEETS",
    "Track Days":     "TRACK",
    "Ride Outs":      "RIDE-OUT",
    "Shows & Events": "SHOWS",
    "Race Meets":     "RACING",
    "Rider Training": "TRAINING"
  };

  var TYPE_SET = {};
  TYPES.forEach(function (t) { TYPE_SET[t.name] = true; });

  var MON_IDX  = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  var MON_NAME = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAY_NAME = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    all:        [],
    filtered:   [],
    types:      new Set(),
    dateMode:   "upcoming",
    loc:        null,
    radius:     25,
    sort:       "date-asc",
    page:       1,
    view:       "list",
    search:     "",
    userEvents: lsGet(LS_USER, [])
  };

  var _geoCache  = lsGet(LS_GEOCACHE, {});
  var _geocoding = false;

  // ── Map state ─────────────────────────────────────────────────────────────
  var _mapInst  = null;
  var _mapGroup = null;

  // ── localStorage ─────────────────────────────────────────────────────────
  function lsGet(k, fb) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; }
    catch (e) { return fb; }
  }
  function lsSave(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  function today0() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(s);
    if (!m) return null;
    var mi = MON_IDX[m[2]];
    if (mi == null) return null;
    return new Date(2000 + parseInt(m[3], 10), mi, parseInt(m[1], 10));
  }

  function fmtDate(d) {
    if (!d) return "";
    return DAY_NAME[d.getDay()] + " " + d.getDate() + " " + MON_NAME[d.getMonth()] + " " + d.getFullYear();
  }

  function dateFromInput(s) {
    if (!s) return null;
    var p = s.split("-");
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function dateRange(mode) {
    var now = today0();
    var dow = now.getDay();

    function add(n) {
      var d = new Date(now);
      d.setDate(d.getDate() + n);
      return d;
    }

    var toMon = (dow === 0) ? -6 : (1 - dow);

    switch (mode) {
      case "today":        return { from: now, to: now };
      case "tomorrow":     return { from: add(1), to: add(1) };
      case "weekend":      return { from: add(toMon + 5), to: add(toMon + 6) };
      case "next-weekend": return { from: add(toMon + 12), to: add(toMon + 13) };
      case "week":         return { from: add(toMon), to: add(toMon + 6) };
      case "next-week":    return { from: add(toMon + 7), to: add(toMon + 13) };
      case "month": {
        var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: now, to: lastDay };
      }
      default:
        return { from: now, to: null };
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms);
    };
  }

  function haversine(la1, lo1, la2, lo2) {
    var R = 3958.8, r = Math.PI / 180;
    var dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
    var a = Math.sin(dla/2)*Math.sin(dla/2) +
            Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dlo/2)*Math.sin(dlo/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function evKey(ev) {
    return ev._key || (ev.d + "|" + ev.t + "|" + (ev.loc || ""));
  }

  function byId(id) { return document.getElementById(id); }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    bind();
    showLoading();
    loadEvents();
  }

  // ── Bind ──────────────────────────────────────────────────────────────────
  function bind() {

    // EVENT TYPE dropdown button
    byId("btn-type-filter").addEventListener("click", function () {
      var dd = byId("type-dropdown");
      var isOpen = dd.classList.contains("is-open");
      closeAllDropdowns();
      if (!isOpen) {
        positionDropdown(dd, byId("btn-type-filter"));
        dd.classList.add("is-open");
        dd.setAttribute("aria-hidden", "false");
        byId("btn-type-filter").setAttribute("aria-expanded", "true");
      }
    });

    byId("btn-close-type").addEventListener("click", closeAllDropdowns);

    // TYPE dropdown items (delegated from #type-dd-list)
    byId("type-dd-list").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-type]");
      if (!btn) return;
      var t = btn.dataset.type;
      if (t === "") {
        state.types.clear();
      } else {
        if (state.types.has(t)) state.types.delete(t);
        else state.types.add(t);
      }
      renderTypeDropdown();
      updateTypeBtnLabel();
      state.page = 1;
      render();
    });

    // DATES dropdown button
    byId("btn-dates-filter").addEventListener("click", function () {
      var dd = byId("dates-dropdown");
      var isOpen = dd.classList.contains("is-open");
      closeAllDropdowns();
      if (!isOpen) {
        var rect = byId("btn-dates-filter").getBoundingClientRect();
        dd.style.top = (rect.bottom + 4) + "px";
        dd.classList.add("is-open");
        dd.setAttribute("aria-hidden", "false");
        byId("btn-dates-filter").setAttribute("aria-expanded", "true");
      }
    });

    byId("btn-close-dates").addEventListener("click", closeAllDropdowns);

    // Date chips inside dates dropdown (delegated)
    byId("dates-dropdown").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-date]");
      if (!btn) return;
      byId("dates-dropdown").querySelectorAll("[data-date]").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      state.dateMode = btn.dataset.date;
      updateDatesBtnLabel();
      state.page = 1;
      closeAllDropdowns();
      render();
    });

    // Sort
    byId("sort-select").addEventListener("change", function () {
      state.sort = this.value;
      state.page = 1;
      render();
    });

    // Location input
    byId("loc-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); startSearch(); }
    });
    byId("loc-input").addEventListener("input", debounce(function () {
      if (!this.value.trim()) clearLoc();
    }, 600));

    byId("btn-locate").addEventListener("click", geolocate);
    var clearLocBtn = byId("btn-clear-loc");
    if (clearLocBtn) clearLocBtn.addEventListener("click", clearLoc);

    // Event text search
    var searchInp   = byId("search-input");
    var searchClear = byId("btn-clear-search");
    if (searchInp) {
      searchInp.addEventListener("input", debounce(function () {
        state.search = searchInp.value.trim();
        if (searchClear) searchClear.style.display = state.search ? "block" : "none";
        state.page = 1;
        render();
      }, 220));
    }
    if (searchClear) {
      searchClear.addEventListener("click", function () {
        if (searchInp) searchInp.value = "";
        state.search = "";
        searchClear.style.display = "none";
        state.page = 1;
        render();
      });
    }

    byId("radius").addEventListener("input", function () {
      state.radius = parseInt(this.value, 10);
      byId("radius-val").textContent = this.value + " mi";
      if (state.loc) { state.page = 1; render(); }
    });

    // Event list delegated — only reset button needed (no save/share in v2)
    byId("event-grid").addEventListener("click", function (e) {
      if (e.target.closest("#btn-reset")) { resetFilters(); return; }
    });

    // Pagination
    byId("pagination").addEventListener("click", function (e) {
      var btn = e.target.closest(".page-btn");
      if (!btn || btn.disabled) return;
      var p = parseInt(btn.dataset.page, 10);
      if (p >= 1) {
        state.page = p;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    // Overlay closes modal
    byId("overlay").addEventListener("click", closeAll);

    // Add event buttons (results bar + sub-filters)
    byId("btn-submit").addEventListener("click", openSubmitModal);
    var addEventBtn = byId("btn-add-event");
    if (addEventBtn) addEventBtn.addEventListener("click", openSubmitModal);

    // [data-close] buttons anywhere
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) closeAll();
    });

    // Submit form
    byId("submit-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitEvent();
    });

    // Add another
    byId("btn-add-another").addEventListener("click", function () {
      byId("submit-success").classList.add("hidden");
      byId("submit-form-wrap").style.display = "";
      byId("submit-form").reset();
    });

    // Map / List toggle (results bar)
    byId("btn-view-toggle").addEventListener("click", function () {
      setView(state.view === "list" ? "map" : "list");
    });

    // Back-to-list button inside map sidebar (desktop)
    var backList = byId("btn-back-list");
    if (backList) backList.addEventListener("click", function () { setView("list"); });

    // Floating back-to-list button (mobile map mode)
    var mobBackToList = byId("mob-back-to-list");
    if (mobBackToList) mobBackToList.addEventListener("click", function () { setView("list"); });


    // Escape key
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeAll(); closeAllDropdowns(); }
    });

    // Click outside dropdowns to close them
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".filter-dropdown") &&
          !e.target.closest("#btn-type-filter") &&
          !e.target.closest("#btn-dates-filter")) {
        closeAllDropdowns();
      }
    });
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  function loadEvents() {
    fetch("events.json?v=1")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (list) {
        var parsed = [];
        for (var i = 0; i < list.length; i++) {
          var ev = list[i];
          if (!ev || !ev.d || !ev.t || !ev.ty) continue;
          var d = parseDate(ev.d);
          if (!d) continue;
          if (typeof ev.lat === "number" && typeof ev.lng === "number") {
            ev._lat = ev.lat;
            ev._lon = ev.lng;
          }
          ev._date = d;
          ev._key  = evKey(ev);
          parsed.push(ev);
        }

        // Prepend user-submitted events
        var userParsed = state.userEvents.map(function (ev) {
          var c = Object.assign({}, ev);
          c._date = parseDate(c.d);
          c._user = true;
          c._key  = c._key || evKey(c);
          return c;
        }).filter(function (ev) { return !!ev._date; });

        state.all = userParsed.concat(parsed);
        applyCachedCoords();
        render();
        renderTypeDropdown();
      })
      .catch(function (err) {
        byId("event-grid").innerHTML =
          '<div class="empty-state"><h3>Could not load events</h3>' +
          '<p>Please refresh the page.</p></div>';
        console.error("loadEvents:", err);
      });
  }

  // ── Filter + sort ─────────────────────────────────────────────────────────
  function applyFilters() {
    var range    = dateRange(state.dateMode);
    var from     = range.from;
    var to       = range.to;
    var hasTypes = state.types.size > 0;
    var hasLoc   = !!state.loc;
    var searchQ  = state.search.toLowerCase();

    var out = [];
    for (var i = 0; i < state.all.length; i++) {
      var ev = state.all[i];
      if (from && ev._date < from) continue;
      if (to   && ev._date > to)   continue;
      if (hasTypes && !state.types.has(ev.ty)) continue;
      if (searchQ) {
        var inTitle = ev.t    && ev.t.toLowerCase().indexOf(searchQ)    !== -1;
        var inDesc  = ev.desc && ev.desc.toLowerCase().indexOf(searchQ) !== -1;
        var inLoc   = ev.loc  && ev.loc.toLowerCase().indexOf(searchQ)  !== -1;
        if (!inTitle && !inDesc && !inLoc) continue;
      }
      if (hasLoc) {
        if (ev._lat == null) continue;
        var d = haversine(state.loc.lat, state.loc.lon, ev._lat, ev._lon);
        if (d > state.radius) continue;
        ev._dist = d;
      } else {
        ev._dist = null;
      }
      out.push(ev);
    }

    var s = state.sort;
    if (s === "date-desc") {
      out.sort(function (a, b) { return b._date - a._date; });
    } else if (s === "title") {
      out.sort(function (a, b) { return a.t.localeCompare(b.t); });
    } else if (s === "distance" && hasLoc) {
      out.sort(function (a, b) {
        var da = a._dist == null ? Infinity : a._dist;
        var db = b._dist == null ? Infinity : b._dist;
        return da !== db ? da - db : a._date - b._date;
      });
    } else {
      out.sort(function (a, b) { return a._date - b._date; });
    }

    state.filtered = out;
    var maxPage = Math.max(1, Math.ceil(out.length / PAGE_SIZE));
    if (state.page > maxPage) state.page = 1;
  }

  function render() {
    applyFilters();
    if (state.view === "map") {
      renderMap();
    } else {
      renderCards();
    }
  }

  // ── Type dropdown ─────────────────────────────────────────────────────────
  function renderTypeDropdown() {
    var list = byId("type-dd-list");
    if (!list) return;
    var allActive = (state.types.size === 0);
    var html = '<button class="type-dd-item' + (allActive ? " active" : "") + '" data-type="">All types</button>';
    TYPES.forEach(function (t) {
      var active = state.types.has(t.name);
      html += '<button class="type-dd-item' + (active ? " active" : "") +
              '" data-type="' + esc(t.name) + '">' + esc(t.name) + '</button>';
    });
    list.innerHTML = html;
  }

  function updateTypeBtnLabel() {
    var label = byId("type-btn-label");
    if (!label) return;
    if (state.types.size === 0) {
      label.textContent = "EVENT TYPE";
    } else if (state.types.size === 1) {
      label.textContent = Array.from(state.types)[0].toUpperCase();
    } else {
      label.textContent = state.types.size + " TYPES";
    }
  }

  function updateDatesBtnLabel() {
    var label = byId("dates-btn-label");
    if (!label) return;
    var labelMap = {
      "upcoming":     "DATES",
      "today":        "TODAY",
      "tomorrow":     "TOMORROW",
      "week":         "THIS WEEK",
      "weekend":      "WEEKEND",
      "next-weekend": "NEXT W/E",
      "next-week":    "NEXT WEEK",
      "month":        "THIS MONTH"
    };
    label.textContent = labelMap[state.dateMode] || "DATES";
  }

  function closeAllDropdowns() {
    ["type-dropdown", "dates-dropdown"].forEach(function (id) {
      var el = byId(id);
      if (!el) return;
      el.classList.remove("is-open");
      el.setAttribute("aria-hidden", "true");
    });
    var typeBtn  = byId("btn-type-filter");
    var datesBtn = byId("btn-dates-filter");
    if (typeBtn)  typeBtn.setAttribute("aria-expanded", "false");
    if (datesBtn) datesBtn.setAttribute("aria-expanded", "false");
  }

  function positionDropdown(dropdown, trigger) {
    var rect = trigger.getBoundingClientRect();
    dropdown.style.top   = (rect.bottom + 4) + "px";
    dropdown.style.right = "";
    dropdown.style.left  = rect.left + "px";
    // Shift left if it would overflow the right edge
    var w = dropdown.offsetWidth || 220;
    if (rect.left + w > window.innerWidth - 8) {
      dropdown.style.left  = "";
      dropdown.style.right = "8px";
    }
  }

  // ── Event rows ────────────────────────────────────────────────────────────
  function renderCards() {
    var list = state.filtered;
    byId("count-num").textContent = list.length;
    var grid = byId("event-grid");

    if (!list.length) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<h3>No events found</h3>' +
          '<p>Try adjusting your filters or widening the search area.</p>' +
          '<button id="btn-reset" class="btn-reset">Reset filters</button>' +
        '</div>';
      byId("pagination").innerHTML = "";
      return;
    }

    var start = (state.page - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);

    grid.innerHTML = slice.map(function (ev) {
      return buildRow(ev);
    }).join("");

    renderPagination(list.length);
  }

  function buildRow(ev) {
    var d    = ev._date;
    var day  = pad2(d.getDate());
    var mon  = MON_NAME[d.getMonth()].toUpperCase();
    var dow  = DAY_NAME[d.getDay()].toUpperCase();

    var dateBlock =
      '<div class="date-block">' +
        '<span class="db-d">' + day + '</span>' +
        '<span class="db-m">' + mon + '</span>' +
        '<span class="db-w">' + dow + '</span>' +
      '</div>';

    var badge = '<span class="cat-badge">' + esc(ev.ty) + '</span>';
    if (ev._user) badge += ' <span class="cat-badge user-badge">Your event</span>';

    var locHtml = ev.loc
      ? '<div class="row-loc">' + icoPin() + '<span>' + esc(ev.loc) + '</span></div>'
      : '';

    var descHtml = ev.desc
      ? '<p class="row-desc">' + esc(ev.desc) + '</p>'
      : '';

    // Action buttons
    var actions = "";
    var mapHref = ev.map || (ev.loc
      ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.loc)
      : "");

    if (ev.link) {
      actions += '<a class="btn-event btn-event-primary" href="' + esc(ev.link) +
                 '" target="_blank" rel="noopener noreferrer">Event link ↗</a>';
    }
    if (mapHref) {
      actions += '<a class="btn-event btn-event-secondary" href="' + esc(mapHref) +
                 '" target="_blank" rel="noopener noreferrer">' + icoPin() + 'Map ↗</a>';
    }

    return (
      '<article class="event-row" data-key="' + esc(evKey(ev)) + '">' +
        dateBlock +
        '<div class="row-body">' +
          badge +
          '<h2 class="row-title">' + esc(ev.t) + '</h2>' +
          locHtml +
          descHtml +
        '</div>' +
        (actions ? '<div class="row-actions">' + actions + '</div>' : '') +
      '</article>'
    );
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  function renderPagination(total) {
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    var pag   = byId("pagination");
    if (pages <= 1) { pag.innerHTML = ""; return; }

    var cur  = state.page;
    var html = '<button class="page-btn" data-page="' + (cur - 1) + '"' +
               (cur === 1 ? " disabled" : "") + '>← Prev</button>';

    var items = [];
    if (pages <= 7) {
      for (var i = 1; i <= pages; i++) items.push(i);
    } else {
      items.push(1);
      if (cur > 4) items.push("…");
      var s = Math.max(2, cur - 1), e = Math.min(pages - 1, cur + 1);
      for (var j = s; j <= e; j++) items.push(j);
      if (cur < pages - 3) items.push("…");
      items.push(pages);
    }

    items.forEach(function (it) {
      if (it === "…") {
        html += '<span class="page-gap">…</span>';
      } else {
        html += '<button class="page-btn' + (it === cur ? " active" : "") +
                '" data-page="' + it + '">' + it + '</button>';
      }
    });

    html += '<button class="page-btn" data-page="' + (cur + 1) + '"' +
            (cur === pages ? " disabled" : "") + '>Next →</button>';
    pag.innerHTML = html;
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  function showLoading() {
    byId("event-grid").innerHTML =
      '<div class="loading-state">' +
        '<div class="spinner"></div>' +
        '<p>Loading events…</p>' +
      '</div>';
    byId("count-num").textContent = "—";
  }

  // ── Map ───────────────────────────────────────────────────────────────────
  function setView(v) {
    state.view = v;
    var isMap = (v === "map");

    // Elements managed by JS
    byId("event-grid").style.display   = isMap ? "none" : "";
    byId("pagination").style.display   = isMap ? "none" : "";
    byId("map-container").style.display = isMap ? "" : "none";
    byId("sort-select").style.display  = isMap ? "none" : "";

    // Body class drives CSS layout switch (sidebar + map pane)
    document.body.classList.toggle("is-map-mode", isMap);

    // Show / hide sidebar
    byId("map-sidebar").style.display  = isMap ? "" : "none";

    // Toggle button state
    var btn = byId("btn-view-toggle");
    btn.setAttribute("aria-pressed", String(isMap));
    btn.classList.toggle("active", isMap);
    btn.textContent = isMap ? "List" : "Map View";

    // Close-map X button — always visible in map mode
    var mobBackEl = byId("mob-back-to-list");
    if (mobBackEl) {
      mobBackEl.style.display = isMap ? "flex" : "none";
    }

    if (isMap) {
      render();
      setTimeout(function () { if (_mapInst) _mapInst.invalidateSize(); }, 120);
    } else {
      renderCards();
    }
  }

  function initMap() {
    if (_mapInst) return;
    _mapInst = L.map("map-container", { zoomControl: true }).setView([54.2, -2.5], 6);

    // CartoDB Dark Matter — no API key required
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: "abcd"
      }
    ).addTo(_mapInst);

    _mapGroup = L.layerGroup().addTo(_mapInst);
  }

  function renderMap() {
    initMap();
    _mapGroup.clearLayers();

    // Group by lat/lng — keep soonest event per location
    var locMap = {};
    state.filtered.forEach(function (ev) {
      if (typeof ev._lat !== "number" || typeof ev._lon !== "number") return;
      var key = ev._lat.toFixed(5) + "," + ev._lon.toFixed(5);
      if (!locMap[key] || ev._date < locMap[key].ev._date) {
        var count = locMap[key] ? locMap[key].count : 0;
        locMap[key] = { ev: ev, count: count + 1 };
      } else {
        locMap[key].count++;
      }
    });

    var bounds = [];
    Object.keys(locMap).forEach(function (key) {
      var entry = locMap[key];
      var ev    = entry.ev;
      var more  = entry.count - 1;

      var dotHtml =
        '<div style="width:12px;height:12px;border-radius:50%;' +
        'background:#D6202A;border:2px solid rgba(244,241,234,0.9);' +
        'box-shadow:0 1px 6px rgba(0,0,0,0.5)"></div>';

      var icon = L.divIcon({
        className:   "",
        html:        dotHtml,
        iconSize:    [12, 12],
        iconAnchor:  [6, 6],
        popupAnchor: [0, -10]
      });

      var marker = L.marker([ev._lat, ev._lon], { icon: icon });
      marker.bindPopup(buildMapPopup(ev, more), {
        maxWidth:  340,
        className: "ll-popup-wrap"
      });
      _mapGroup.addLayer(marker);
      bounds.push([ev._lat, ev._lon]);
    });

    if (bounds.length) {
      _mapInst.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    }

    // Update sidebar
    renderMapSidebar();
  }

  function buildMapPopup(ev, more) {
    var d = ev._date;
    var dateStr = pad2(d.getDate()) + " " + MON_NAME[d.getMonth()].toUpperCase() +
                  " " + d.getFullYear();

    var h = '<div class="ll-popup">';

    // Meta line: "09 MAY 2025 · TRACK DAYS"
    h += '<div class="ll-popup-meta">';
    h += '<span class="ll-meta-date">' + esc(dateStr) + '</span>';
    h += ' · ' + esc(ev.ty);
    if (more) {
      h += '<span class="ll-meta-more">+' + more + ' more</span>';
    }
    h += '</div>';

    h += '<div class="ll-popup-title">' + esc(ev.t) + '</div>';
    if (ev.loc) h += '<div class="ll-popup-loc">' + esc(ev.loc) + '</div>';

    var mapHref = ev.map || (ev.loc
      ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.loc)
      : "");

    var btns = [];
    if (ev.link)  btns.push('<a class="ll-popup-btn ll-popup-btn-primary" href="' + esc(ev.link) + '" target="_blank" rel="noopener noreferrer">Event ↗</a>');
    if (mapHref)  btns.push('<a class="ll-popup-btn ll-popup-btn-secondary" href="' + esc(mapHref) + '" target="_blank" rel="noopener noreferrer">Map ↗</a>');
    if (btns.length) h += '<div class="ll-popup-btns">' + btns.join("") + '</div>';

    h += '</div>';
    return h;
  }

  function renderMapSidebar() {
    var list   = state.filtered;
    var count  = byId("map-count");
    if (count) count.textContent = list.length;

    var el = byId("map-sidebar-list");
    if (!el) return;

    if (!list.length) {
      el.innerHTML = '<div style="padding:24px 16px;font-family:var(--f-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--ll-steel)">No events match the current filters.</div>';
      return;
    }

    // Show first 60 in sidebar (avoid DOM overload)
    var slice = list.slice(0, 60);
    el.innerHTML = slice.map(function (ev) {
      var d   = ev._date;
      var day = pad2(d.getDate());
      var mon = MON_NAME[d.getMonth()].toUpperCase();
      var dow = DAY_NAME[d.getDay()].toUpperCase();

      return (
        '<div class="sidebar-row">' +
          '<div class="date-block">' +
            '<span class="db-d">' + day + '</span>' +
            '<span class="db-m">' + mon + '</span>' +
            '<span class="db-w">' + dow + '</span>' +
          '</div>' +
          '<div class="sidebar-row-body">' +
            '<span class="cat-badge">' + esc(ev.ty) + '</span>' +
            '<div class="sidebar-row-title">' + esc(ev.t) + '</div>' +
            (ev.loc ? '<div class="sidebar-row-loc">' + esc(ev.loc) + '</div>' : '') +
          '</div>' +
        '</div>'
      );
    }).join("");

    if (list.length > 60) {
      el.innerHTML += '<div style="padding:14px 16px;font-family:var(--f-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--ll-steel)">+ ' + (list.length - 60) + ' more — zoom map to filter</div>';
    }
  }

  // ── Location ──────────────────────────────────────────────────────────────
  var PC_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;

  function startSearch() {
    var q = byId("loc-input").value.trim();
    if (!q) { clearLoc(); return; }

    showLocMsg("Searching…", "info");

    var promise = PC_RE.test(q)
      ? geocodePostcode(q.replace(/\s+/g, "").toUpperCase())
      : geocodeNominatim(q);

    promise.then(function (res) {
      state.loc = res;
      state.page = 1;
      showLocMsg("", "");
      startGeocoding();
    }).catch(function () {
      showLocMsg("Location not found. Try a postcode or town name.", "error");
    });
  }

  function geocodePostcode(pc) {
    return fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(pc))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status !== 200 || !data.result) throw new Error("not found");
        return { lat: data.result.latitude, lon: data.result.longitude, label: data.result.postcode };
      });
  }

  function geocodeNominatim(q) {
    var url = "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(q + ", UK") + "&format=json&limit=1&countrycodes=gb,ie";
    return fetch(url, { headers: { "Accept-Language": "en" } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.length) throw new Error("not found");
        var label = res[0].display_name ? res[0].display_name.split(",")[0] : q;
        return { lat: parseFloat(res[0].lat), lon: parseFloat(res[0].lon), label: label };
      });
  }

  function geolocate() {
    if (!navigator.geolocation) {
      showLocMsg("Geolocation not supported by your browser.", "error");
      return;
    }
    showLocMsg("Getting your location…", "info");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        state.loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "your location" };
        byId("loc-input").value = "Current location";
        state.page = 1;
        showLocMsg("", "");
        startGeocoding();
      },
      function () { showLocMsg("Could not get location. Check browser permissions.", "error"); },
      { timeout: 10000 }
    );
  }

  function clearLoc() {
    state.loc = null;
    byId("loc-input").value = "";
    showLocMsg("", "");
    state.page = 1;
    render();
  }

  function showLocMsg(msg, kind) {
    var el = byId("loc-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "loc-msg" + (msg ? " " + kind : "");
  }

  // ── Geocoding ─────────────────────────────────────────────────────────────
  function extractPC(loc) {
    var m = (loc || "").match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
    return m ? m[1].replace(/\s+/g, "").toUpperCase() : null;
  }

  function applyCachedCoords() {
    state.all.forEach(function (ev) {
      if (ev._lat != null) return;
      var pc = extractPC(ev.loc);
      if (pc && _geoCache[pc]) {
        ev._lat = _geoCache[pc].lat;
        ev._lon = _geoCache[pc].lon;
      }
    });
  }

  function startGeocoding() {
    applyCachedCoords();
    render();

    if (_geocoding) return;

    var pcMap = {};
    state.all.forEach(function (ev) {
      if (ev._lat != null) return;
      var pc = extractPC(ev.loc);
      if (!pc) return;
      if (!pcMap[pc]) pcMap[pc] = [];
      pcMap[pc].push(ev);
    });

    var pcs = Object.keys(pcMap);
    if (!pcs.length) return;

    _geocoding = true;
    geocodeBatch(pcs, 0, pcMap, function () {
      _geocoding = false;
      lsSave(LS_GEOCACHE, _geoCache);
      if (state.loc) render();
    });
  }

  function geocodeBatch(pcs, offset, pcMap, done) {
    var batch = pcs.slice(offset, offset + 100);
    if (!batch.length) { done(); return; }

    fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 200 && data.result) {
          data.result.forEach(function (item) {
            if (!item.result) return;
            var pc  = item.query;
            var lat = item.result.latitude;
            var lon = item.result.longitude;
            _geoCache[pc] = { lat: lat, lon: lon };
            (pcMap[pc] || []).forEach(function (ev) { ev._lat = lat; ev._lon = lon; });
          });
        }
        if (offset + 100 < pcs.length) {
          geocodeBatch(pcs, offset + 100, pcMap, done);
        } else {
          done();
        }
      })
      .catch(function () { done(); });
  }

  // ── Submit modal ──────────────────────────────────────────────────────────
  function openSubmitModal() {
    byId("submit-form-wrap").style.display = "";
    byId("submit-success").classList.add("hidden");
    byId("submit-form").reset();
    // Pre-fill date with today so the field is never blank on mobile
    var now = new Date();
    byId("f-date").value = now.getFullYear() + "-" +
      pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
    showModal(byId("submit-modal"));
  }

  function showModal(modal) {
    byId("overlay").classList.add("show");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeAll() {
    byId("overlay").classList.remove("show");
    var modal = byId("submit-modal");
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  function submitEvent() {
    var dateVal  = byId("f-date").value;
    var typeVal  = byId("f-type").value;
    var titleVal = byId("f-title").value.trim();
    var locVal   = byId("f-loc").value.trim();

    if (!dateVal)  { showToast("Please enter the event date");   return; }
    if (!typeVal)  { showToast("Please select an event type");   return; }
    if (!titleVal) { showToast("Please enter the event name");   return; }
    if (!locVal)   { showToast("Please enter the location");     return; }

    var d = dateFromInput(dateVal);
    if (!d) { showToast("Invalid date"); return; }

    var repeatEl  = document.querySelector('input[name="f-repeat"]:checked');
    var repeatVal = repeatEl ? repeatEl.value : "";

    // Build list of dates: first occurrence + repeats
    var dates = [d];
    if (repeatVal === "weekly") {
      for (var w = 1; w <= 12; w++) {
        var wd = new Date(d); wd.setDate(wd.getDate() + w * 7); dates.push(wd);
      }
    } else if (repeatVal === "monthly") {
      for (var m = 1; m <= 6; m++) {
        var md = new Date(d); md.setMonth(md.getMonth() + m); dates.push(md);
      }
    }

    var descVal = byId("f-desc").value.trim();
    var linkVal = byId("f-link").value.trim();
    var mapVal  = byId("f-map").value.trim();

    // Create one event per date
    dates.forEach(function (dt, idx) {
      var dStr = pad2(dt.getDate()) + "-" + MON_NAME[dt.getMonth()] + "-" + String(dt.getFullYear()).slice(-2);
      var key  = "user-" + Date.now() + "-" + idx + "-" + Math.random().toString(36).slice(2, 7);
      var ev   = {
        _key: key, d: dStr, t: titleVal, ty: typeVal,
        desc: descVal, link: linkVal, loc: locVal, map: mapVal
      };
      state.userEvents.unshift(ev);
      var live = Object.assign({}, ev);
      live._date = dt;
      live._user = true;
      state.all.unshift(live);
    });

    lsSave(LS_USER, state.userEvents);
    renderTypeDropdown();
    render();

    // Email via Web3Forms (single notification with repeat info)
    var repeatLabel = repeatVal === "weekly"  ? "Weekly (×12)"
                    : repeatVal === "monthly" ? "Monthly (×6)"
                    : "One-off";
    fetch("https://api.web3forms.com/submit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        access_key:    "c5a22755-eabe-4fd7-9f8c-832c7cd6d6a7",
        subject:       "New Event Submission — Lid Life",
        from_name:     "Lid Life Event Finder",
        "Event Date":  dateVal,
        "Repeat":      repeatLabel,
        "Event Type":  typeVal,
        "Event Name":  titleVal,
        "Location":    locVal,
        "Description": descVal,
        "Website URL": linkVal,
        "Maps URL":    mapVal
      })
    }).catch(function () {});

    byId("submit-form-wrap").style.display = "none";
    // Update success message
    var titleEl = byId("success-title");
    var subEl   = byId("success-sub");
    if (titleEl) titleEl.textContent = dates.length > 1 ? dates.length + " events added!" : "Event added!";
    if (subEl)   subEl.textContent   = dates.length > 1
      ? "All " + dates.length + " dates are now showing in the list on this device."
      : "It’s now showing in the list on this device.";
    byId("submit-success").classList.remove("hidden");
  }

  // ── Reset filters ─────────────────────────────────────────────────────────
  function resetFilters() {
    state.types    = new Set();
    state.dateMode = "upcoming";
    state.search   = "";
    state.page     = 1;
    var searchInp   = byId("search-input");
    var searchClear = byId("btn-clear-search");
    if (searchInp)   searchInp.value = "";
    if (searchClear) searchClear.style.display = "none";
    document.querySelectorAll("[data-date]").forEach(function (b) {
      b.classList.remove("active");
    });
    var up = document.querySelector("[data-date='upcoming']");
    if (up) up.classList.add("active");
    updateDatesBtnLabel();
    updateTypeBtnLabel();
    renderTypeDropdown();
    clearLoc();
    render();
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    var t = byId("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove("show"); }, 2500);
  }

  // ── SVG icons ─────────────────────────────────────────────────────────────
  function icoPin() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
