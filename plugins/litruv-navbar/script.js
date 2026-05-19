(function () {
  // Derive the plugin folder name from this script's own URL (/plugins/<name>/script.js)
  const _PLUGIN_ID = (document.currentScript instanceof HTMLScriptElement &&
    document.currentScript.src.match(/\/plugins\/([^/]+)\/script\.js/))?.[1] ?? "litruv-navbar";
  const ICON_BASE = `/plugins/${_PLUGIN_ID}/images/`;
  const CONFIG_URL = `/api/plugin/${_PLUGIN_ID}/config`;

  /**
   * Resolves an icon value to a full URL.
   * - Full URL / absolute path / data URI → used as-is
   * - "sh-name" → selfh.st via jsDelivr
   * - "name" (no prefix, no extension path) → dashboard-icons via jsDelivr
   * - "name.png" (local filename, no slash) → local images folder
   * @param {string} raw
   * @returns {string}
   */
  function resolveIcon(raw) {
    if (!raw) return "";
    const s = String(raw).trim();
    if (!s) return "";
    if (/^(https?:)?\/\//i.test(s) || s.startsWith("/") || s.startsWith("data:")) return s;
    // Bare filename with image extension → local uploaded file
    if (/\.[a-z]{2,4}$/i.test(s) && !s.includes("/")) return ICON_BASE + s;
    // CDN slug → proxy through local cache route (downloads + caches on first hit)
    return `/api/plugin/${_PLUGIN_ID}/icon?name=${encodeURIComponent(s)}`;
  }

  let _uptimeFetchPromise = null;

  /**
   * @param {string} uptimeUrl
   * @param {string} uptimeSlug
   */
  /**
   * Applies uptime badges to a specific set of tiles using one Uptime Kuma status page.
   * @param {string} uptimeUrl
   * @param {string} uptimeSlug
   * @param {Element[]} tiles
   */
  async function applyUptimeBadgesForGroup(uptimeUrl, uptimeSlug, tiles) {
    if (!uptimeUrl || !uptimeSlug || !tiles.length) return;
    let config, heartbeat;
    try {
      const [cfgRes, hbRes] = await Promise.all([
        fetch(`${uptimeUrl}/api/status-page/${uptimeSlug}`),
        fetch(`${uptimeUrl}/api/status-page/heartbeat/${uptimeSlug}`),
      ]);
      if (!cfgRes.ok || !hbRes.ok) return;
      [config, heartbeat] = await Promise.all([cfgRes.json(), hbRes.json()]);
    } catch { return; }

    const urlById = {};
    for (const group of config.publicGroupList ?? []) {
      for (const m of group.monitorList ?? []) {
        if (m.id != null && m.url) urlById[m.id] = m.url;
      }
    }

    const uptimeByUrl = {};
    const beatsByUrl = {};
    for (const [key, ratio] of Object.entries(heartbeat.uptimeList ?? {})) {
      if (!key.endsWith("_24")) continue;
      const id = parseInt(key, 10);
      const url = urlById[id];
      if (url) uptimeByUrl[url] = ratio;
    }
    for (const [idStr, beats] of Object.entries(heartbeat.heartbeatList ?? {})) {
      const url = urlById[parseInt(idStr, 10)];
      if (!url || !Array.isArray(beats)) continue;
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      beatsByUrl[url] = beats.filter(b => b.time && new Date(b.time).getTime() >= cutoff);
    }

    tiles.forEach(tile => {
      const tileUrl = tile.dataset.statusUrl || tile.dataset.svcUrl;
      if (!tileUrl) return;
      let pct, beats;

      if (tileUrl in uptimeByUrl) {
        pct = uptimeByUrl[tileUrl];
        beats = beatsByUrl[tileUrl];
      } else {
        let tileHost;
        try { tileHost = new URL(tileUrl).host; } catch { return; }
        for (const [monUrl, val] of Object.entries(uptimeByUrl)) {
          try {
            if (new URL(monUrl).host === tileHost) {
              pct = val;
              beats = beatsByUrl[monUrl];
              break;
            }
          } catch {}
        }
      }
      if (pct === undefined) return;

      const iconEl = tile.querySelector(".litruv-launcher-tile-icon");
      if (!iconEl) return;

      let badge = iconEl.querySelector(".litruv-uptime-badge");
      if (!badge) {
        badge = document.createElement("span");
        iconEl.appendChild(badge);
      }
      const state = pct === 1 ? "green" : pct >= 0.95 ? "yellow" : "red";
      badge.className = "litruv-uptime-badge litruv-uptime-badge--" + state;
      const latestBeat = beats?.[beats.length - 1];
      const currentlyUp = !latestBeat || latestBeat.status === 1 || latestBeat.status === 3;
      const symbol = currentlyUp ? "✓" : "✗";
      badge.textContent = pct === 1 ? symbol : Math.floor(pct * 100) + "% " + symbol;

      if (beats?.length) {
        let popup = badge.querySelector(".litruv-uptime-popup");
        if (!popup) {
          popup = document.createElement("div");
          badge.appendChild(popup);
        }
        popup.className = "litruv-uptime-popup";
        popup.innerHTML = "";
        for (const beat of beats) {
          const pill = document.createElement("span");
          const cls = beat.status === 1 ? "up" : beat.status === 0 ? "down" : beat.status === 3 ? "maint" : "pending";
          pill.className = "litruv-uptime-pill litruv-uptime-pill--" + cls;
          if (beat.time) pill.title = beat.time + (beat.ping ? " · " + beat.ping + "ms" : "");
          popup.appendChild(pill);
        }
      }
    });
  }

  /**
   * Groups all launcher tiles by their effective uptime source and fetches badges for each group.
   * Tiles with data-uptime-url use their own Uptime Kuma instance; others use the global one.
   * @param {string} globalUrl
   * @param {string} globalSlug
   */
  async function applyUptimeBadges(globalUrl, globalSlug) {
    const allTiles = Array.from(document.querySelectorAll(".litruv-launcher-tile"));

    /** @type {Map<string, { url: string, slug: string, tiles: Element[] }>} */
    const groups = new Map();

    for (const tile of allTiles) {
      const url  = tile.dataset.uptimeUrl  || globalUrl;
      const slug = tile.dataset.uptimeSlug || globalSlug;
      if (!url || !slug) continue;
      const key = url + "||" + slug;
      if (!groups.has(key)) groups.set(key, { url, slug, tiles: [] });
      groups.get(key).tiles.push(tile);
    }

    await Promise.all(
      Array.from(groups.values()).map(g => applyUptimeBadgesForGroup(g.url, g.slug, g.tiles))
    );
  }

  /**
   * @param {Array<{label: string, url: string}>} QUICK_LINKS
   * @param {Array<object>} LAUNCHER_SERVICES
   * @param {string} uptimeUrl
   * @param {string} uptimeSlug
   */
  function buildBar(QUICK_LINKS, LAUNCHER_SERVICES, uptimeUrl, uptimeSlug) {
    const bar = document.createElement("div");
    bar.id = "litruv-navbar";

    // Quick links
    const links = document.createElement("div");
    links.className = "litruv-navbar-links";
    for (const svc of QUICK_LINKS) {
      const a = document.createElement("a");
      a.href = svc.url;
      a.className = "litruv-navbar-link";
      a.textContent = svc.label;
      links.appendChild(a);
    }

    // Grid launcher button
    const btn = document.createElement("button");
    btn.className = "litruv-launcher-btn";
    btn.setAttribute("aria-label", "Services");
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">'
      + '<rect x="0" y="0" width="4" height="4" rx="0.75"/>'
      + '<rect x="6" y="0" width="4" height="4" rx="0.75"/>'
      + '<rect x="12" y="0" width="4" height="4" rx="0.75"/>'
      + '<rect x="0" y="6" width="4" height="4" rx="0.75"/>'
      + '<rect x="6" y="6" width="4" height="4" rx="0.75"/>'
      + '<rect x="12" y="6" width="4" height="4" rx="0.75"/>'
      + '<rect x="0" y="12" width="4" height="4" rx="0.75"/>'
      + '<rect x="6" y="12" width="4" height="4" rx="0.75"/>'
      + '<rect x="12" y="12" width="4" height="4" rx="0.75"/>'
      + '</svg>';

    // Popup panel
    const popup = document.createElement("div");
    popup.id = "litruv-launcher-popup";
    popup.className = "litruv-launcher-popup";

    // Group flat array into sections split by heading entries
    const sections = [];
    let cur = { heading: null, items: [] };
    for (const svc of LAUNCHER_SERVICES) {
      if ("heading" in svc) {
        if (cur.items.length) sections.push(cur);
        cur = { heading: svc.heading, items: [] };
      } else {
        cur.items.push(svc);
      }
    }
    if (cur.items.length) sections.push(cur);

    for (const section of sections) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "litruv-launcher-section";
      if (section.heading) {
        const title = document.createElement("div");
        title.className = "litruv-launcher-section-title";
        title.textContent = section.heading;
        sectionEl.appendChild(title);
      }
      const grid = document.createElement("div");
      grid.className = "litruv-launcher-section-grid";
      for (const item of section.items) {
        const tile = document.createElement(item.url ? "a" : "div");
        if (item.url) tile.href = item.url;
        tile.className = "litruv-launcher-tile" + (item.url ? "" : " litruv-launcher-tile--static");
        tile.dataset.svcUrl = item.statusUrl || item.url || "";
        if (item.statusUrl)  tile.dataset.statusUrl  = item.statusUrl;
        const iconEl = document.createElement("span");
        iconEl.className = "litruv-launcher-tile-icon";
        const resolvedIcon = resolveIcon(item.icon ?? "");
        if (resolvedIcon) {
          const img = document.createElement("img");
          img.src = resolvedIcon;
          img.alt = item.label;
          img.className = "litruv-launcher-tile-icon-img";
          iconEl.appendChild(img);
        } else {
          iconEl.textContent = "◻";
        }
        const labelEl = document.createElement("span");
        labelEl.className = "litruv-launcher-tile-label";
        labelEl.textContent = item.label;
        tile.appendChild(iconEl);
        tile.appendChild(labelEl);
        grid.appendChild(tile);
      }
      sectionEl.appendChild(grid);
      popup.appendChild(sectionEl);
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = popup.classList.toggle("litruv-launcher-popup--open");
      btn.classList.toggle("litruv-launcher-btn--active", open);
      if (open && !_uptimeFetchPromise) {
        _uptimeFetchPromise = applyUptimeBadges(uptimeUrl, uptimeSlug);
      }
    });

    document.addEventListener("click", () => {
      popup.classList.remove("litruv-launcher-popup--open");
      btn.classList.remove("litruv-launcher-btn--active");
    });

    bar.appendChild(links);
    bar.appendChild(btn);
    document.body.appendChild(popup);
    return bar;
  }

  function injectIntoHeader(bar) {
    const headerRight = document.querySelector(".header-right");
    if (!headerRight) return false;
    if (headerRight.querySelector("#litruv-navbar")) return true;
    const settingsBtn = headerRight.querySelector("#nav-settings-top");
    headerRight.insertBefore(bar, settingsBtn ?? null);
    return true;
  }

  function replaceLogo() {
    const h1 = document.querySelector(".logo-container .logo");
    if (!h1) return;
    const img = document.createElement("img");
    img.src = "/plugins/litruv-navbar/logowhite_textonly.png";
    img.alt = "logo";
    img.className = "litruv-logo";
    h1.parentNode.insertBefore(img, h1);
  }

  function replaceResultsLogo() {
    const anchor = document.querySelector("a.results-logo");
    if (!anchor || anchor.querySelector(".litruv-results-logo")) return;
    const img = document.createElement("img");
    img.src = "/plugins/litruv-navbar/logowhite_textonly.png";
    img.alt = "logo";
    img.className = "litruv-results-logo";
    anchor.replaceChildren(img);
  }

  function watchNoResults() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll(".no-results").forEach((el) => {
        if (el.querySelector(".litruv-no-results-gif")) return;
        const img = document.createElement("img");
        img.src = "/plugins/litruv-navbar/images/what-huh.gif";
        img.alt = "";
        img.className = "litruv-no-results-gif";
        el.appendChild(img);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applyBranding() {
    document.title = "Litruv";
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = "/plugins/litruv-navbar/images/16px.png";
    link.type = "image/png";
  }

  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_URL);
      if (!res.ok) return { quickLinks: [], services: [] };
      return await res.json();
    } catch { return { quickLinks: [], services: [] }; }
  }

  async function inject() {
    applyBranding();
    replaceResultsLogo();
    watchNoResults();

    if (document.querySelector("#litruv-navbar")) return;

    const cfg = await loadConfig();
    const bar = buildBar(cfg.quickLinks ?? [], cfg.services ?? [], cfg.uptimeUrl ?? "", cfg.uptimeSlug ?? "");

    if (!injectIntoHeader(bar)) {
      // fallback: watch for header-right to appear (e.g. on SPA nav)
      const waitObs = new MutationObserver(() => {
        if (injectIntoHeader(bar)) waitObs.disconnect();
      });
      waitObs.observe(document.body, { childList: true, subtree: true });
    }

    if (window.location.pathname === "/") {
      replaceLogo();
      document.documentElement.classList.add("litruv-navbar-active");
    }
  }

  // ── Visual editor (/!navbar command) ────────────────────────────────────

  /**
   * @param {HTMLElement} root
   */
  function initEditor(root) {
    if (root.dataset.editorInit) return;

    // Verify key child elements are in the DOM before proceeding.
    // If the root was added before its children, the observer will retry on the next mutation.
    const saveBtn      = document.getElementById("litruv-save-btn");
    const addQlBtn     = document.getElementById("litruv-add-ql");
    const statusEl     = document.getElementById("litruv-status");
    if (!saveBtn || !addQlBtn) return;

    root.dataset.editorInit = "1";

    // Make card headers square-cornered when stuck to top of viewport
    const _stickyCards = /** @type {Array<{card: Element, header: Element}>} */ ([]);
    root.querySelectorAll(".litruv-editor-card").forEach(card => {
      const header = card.querySelector(".litruv-editor-card-header");
      if (header) _stickyCards.push({ card, header });
    });
    const _updateStuck = () => {
      for (const { card, header } of _stickyCards) {
        header.classList.toggle("litruv-editor-card-header--stuck", card.getBoundingClientRect().top < 0);
      }
    };
    window.addEventListener("scroll", _updateStuck, { passive: true });
    _updateStuck();

    const API        = root.dataset.api || `/api/plugin/${_PLUGIN_ID}`;

    /** @type {Array<{label: string, url: string}>} */
    let qlData = [];
    /** @type {Array<object>} */
    let svcData = [];

    /**
     * @param {string} s
     * @returns {string}
     */
    function escAttr(s) {
      return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    }

    /**
     * Creates an icon preview <img> that updates when _update(val) is called.
     * @param {string} iconVal
     * @returns {HTMLImageElement & { _update: (v: string) => void }}
     */
    function makeIconPreview(iconVal) {
      const img = /** @type {any} */ (document.createElement("img"));
      img.className = "litruv-icon-preview";
      img.alt = "";
      function updateSrc(val) {
        const src = resolveIcon(val);
        if (!src) { img.style.visibility = "hidden"; return; }
        img.style.visibility = "";
        img.src = src;
      }
      img.onerror = () => { img.style.visibility = "hidden"; };
      img._update = updateSrc;
      updateSrc(iconVal);
      return img;
    }

    /**
     * Creates up/down reorder buttons for an item at index i.
     * @param {number} i
     * @param {Array<object>} arr
     * @param {function(): void} renderFn
     * @returns {HTMLDivElement}
     */
    function makeReorderBtns(i, arr, renderFn) {
      const wrap = document.createElement("div");
      wrap.className = "litruv-reorder-btns";
      const up = document.createElement("button");
      up.className = "litruv-btn litruv-btn--icon";
      up.title = "Move up";
      up.textContent = "↑";
      up.onclick = () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; renderFn(); } };
      const dn = document.createElement("button");
      dn.className = "litruv-btn litruv-btn--icon";
      dn.title = "Move down";
      dn.textContent = "↓";
      dn.onclick = () => { if (i < arr.length - 1) { [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; renderFn(); } };
      wrap.appendChild(up);
      wrap.appendChild(dn);
      return wrap;
    }

    function renderQuickLinks() {
      const list = document.getElementById("litruv-ql-list");
      if (!list) return;
      list.innerHTML = "";
      if (!qlData.length) {
        const empty = document.createElement("div");
        empty.className = "litruv-editor-empty";
        empty.textContent = "No quick links yet.";
        list.appendChild(empty);
        return;
      }
      qlData.forEach((link, i) => {
        const row = document.createElement("div");
        row.className = "litruv-editor-row litruv-ql-row";

        const labelInput = document.createElement("input");
        labelInput.className = "litruv-input";
        labelInput.placeholder = "Label";
        labelInput.value = link.label ?? "";
        labelInput.oninput = e => { qlData[i].label = /** @type {HTMLInputElement} */ (e.target).value; };

        const urlInput = document.createElement("input");
        urlInput.className = "litruv-input";
        urlInput.type = "url";
        urlInput.placeholder = "https://…";
        urlInput.value = link.url ?? "";
        urlInput.oninput = e => { qlData[i].url = /** @type {HTMLInputElement} */ (e.target).value; };

        const delBtn = document.createElement("button");
        delBtn.className = "litruv-btn litruv-btn--icon litruv-btn--del";
        delBtn.title = "Delete";
        delBtn.textContent = "✕";
        delBtn.onclick = () => { qlData.splice(i, 1); renderQuickLinks(); };

        row.appendChild(labelInput);
        row.appendChild(urlInput);
        row.appendChild(makeReorderBtns(i, qlData, renderQuickLinks));
        row.appendChild(delBtn);
        list.appendChild(row);
      });
    }

    function renderServices() {
      const list = document.getElementById("litruv-svc-list");
      if (!list) return;
      list.innerHTML = "";
      if (!svcData.length) {
        const empty = document.createElement("div");
        empty.className = "litruv-editor-empty";
        empty.textContent = "No services yet.";
        list.appendChild(empty);
        return;
      }
      svcData.forEach((svc, i) => {
        const row = document.createElement("div");

        if ("heading" in svc) {
          row.className = "litruv-editor-row litruv-svc-heading-row";

          const badge = document.createElement("span");
          badge.className = "litruv-heading-badge";
          badge.textContent = "§";

          const input = document.createElement("input");
          input.className = "litruv-input litruv-input--heading";
          input.placeholder = "Section heading";
          input.value = svc.heading ?? "";
          input.oninput = e => { svcData[i].heading = /** @type {HTMLInputElement} */ (e.target).value; };

          const delBtn = document.createElement("button");
          delBtn.className = "litruv-btn litruv-btn--icon litruv-btn--del";
          delBtn.title = "Delete";
          delBtn.textContent = "✕";
          delBtn.onclick = () => { svcData.splice(i, 1); renderServices(); };

          row.appendChild(badge);
          row.appendChild(input);
          row.appendChild(makeReorderBtns(i, svcData, renderServices));
          row.appendChild(delBtn);
        } else {
          row.className = "litruv-editor-row litruv-svc-row";

          const iconWrap = document.createElement("div");
          iconWrap.className = "litruv-svc-icon-wrap";
          const preview = makeIconPreview(svc.icon ?? "");

          // Wrap _update to keep the --empty class in sync
          const _origUpdate = preview._update.bind(preview);
          preview._update = (val) => {
            _origUpdate(val);
            iconWrap.classList.toggle("litruv-svc-icon-wrap--empty", preview.style.visibility === "hidden");
          };
          // Set initial state
          iconWrap.classList.toggle("litruv-svc-icon-wrap--empty", preview.style.visibility === "hidden");

          // Hidden file input for icon upload
          const fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.accept = "image/png,image/jpeg,image/svg+xml,image/webp,image/gif";
          fileInput.style.display = "none";
          fileInput.onchange = async () => {
            const f = fileInput.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append("icon", f);
            try {
              const res = await fetch(`${API}/upload-icon`, { method: "POST", body: fd });
              const data = await res.json();
              if (data.ok) {
                // Store as absolute path so resolveIcon treats it as a direct URL
                const path = `/plugins/${_PLUGIN_ID}/images/${data.filename}`;
                svcData[i].icon = path;
                preview._update(path);
                if (iconNameInput) iconNameInput.value = path;
              }
            } catch {}
          };

          const uploadBtn = document.createElement("button");
          uploadBtn.className = "litruv-btn litruv-btn--upload-icon";
          uploadBtn.title = "Upload icon";
          uploadBtn.textContent = "⬆";
          uploadBtn.onclick = () => fileInput.click();

          iconWrap.appendChild(preview);
          iconWrap.appendChild(fileInput);
          iconWrap.appendChild(uploadBtn);

          const fields = document.createElement("div");
          fields.className = "litruv-svc-fields";

          const fieldsRow1 = document.createElement("div");
          fieldsRow1.className = "litruv-svc-fields-row";

          /** @type {HTMLInputElement | undefined} */
          let iconNameInput;

          const labelInput = document.createElement("input");
          labelInput.className = "litruv-input";
          labelInput.placeholder = "Label";
          labelInput.value = svc.label ?? "";
          labelInput.oninput = e => { svcData[i].label = /** @type {HTMLInputElement} */ (e.target).value; };

          const urlInput = document.createElement("input");
          urlInput.className = "litruv-input";
          urlInput.type = "url";
          urlInput.placeholder = "URL";
          urlInput.value = svc.url ?? "";
          urlInput.oninput = e => { svcData[i].url = /** @type {HTMLInputElement} */ (e.target).value; };
          urlInput.addEventListener("blur", async () => {
            const url = svcData[i].url;
            if (!url) return;
            try {
              const res = await fetch(`${API}/detect-icon?url=${encodeURIComponent(url)}`);
              if (!res.ok) return;
              const { slug } = await res.json();
              if (slug) {
                svcData[i].icon = slug;
                preview._update(slug);
                if (iconNameInput) iconNameInput.value = slug;
              }
            } catch { /* ignore */ }
          });

          fieldsRow1.appendChild(labelInput);
          fieldsRow1.appendChild(urlInput);

          const fieldsRow2 = document.createElement("div");
          fieldsRow2.className = "litruv-svc-fields-row litruv-svc-fields-row--secondary";

          const statusInput = document.createElement("input");
          statusInput.className = "litruv-input litruv-input--small";
          statusInput.type = "url";
          statusInput.placeholder = "Status URL (optional)";
          statusInput.value = svc.statusUrl ?? "";
          statusInput.oninput = e => {
            const val = /** @type {HTMLInputElement} */ (e.target).value;
            if (val) svcData[i].statusUrl = val; else delete svcData[i].statusUrl;
          };

          iconNameInput = document.createElement("input");
          iconNameInput.className = "litruv-input litruv-input--small";
          iconNameInput.type = "text";
          iconNameInput.placeholder = "Icon (plex, sh-immich, URL…)";
          iconNameInput.value = svc.icon ?? "";
          iconNameInput.oninput = e => {
            const val = /** @type {HTMLInputElement} */ (e.target).value;
            svcData[i].icon = val;
            preview._update(val);
          };

          fieldsRow2.appendChild(statusInput);
          fieldsRow2.appendChild(iconNameInput);

          fields.appendChild(fieldsRow1);
          fields.appendChild(fieldsRow2);

          const actions = document.createElement("div");
          actions.className = "litruv-svc-actions";
          const delBtn = document.createElement("button");
          delBtn.className = "litruv-btn litruv-btn--icon litruv-btn--del";
          delBtn.title = "Delete";
          delBtn.textContent = "✕";
          delBtn.onclick = () => { svcData.splice(i, 1); renderServices(); };
          actions.appendChild(makeReorderBtns(i, svcData, renderServices));
          actions.appendChild(delBtn);

          row.appendChild(iconWrap);
          row.appendChild(fields);
          row.appendChild(actions);
        }
        list.appendChild(row);
      });
    }

    // Load config from API
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(data => {
        qlData  = data.quickLinks ?? [];
        svcData = data.services   ?? [];
        const urlEl  = document.getElementById("litruv-uptime-url");
        const slugEl = document.getElementById("litruv-uptime-slug");
        if (urlEl  instanceof HTMLInputElement) urlEl.value  = data.uptimeUrl  ?? "";
        if (slugEl instanceof HTMLInputElement) slugEl.value = data.uptimeSlug ?? "";
        renderQuickLinks();
        renderServices();
      })
      .catch(() => {});

    if (addQlBtn) addQlBtn.onclick = () => { qlData.push({ label: "", url: "" }); renderQuickLinks(); };

    const addHeadingBtn = document.getElementById("litruv-add-heading");
    if (addHeadingBtn) addHeadingBtn.onclick = () => { svcData.push({ heading: "New Section" }); renderServices(); };

    const addSvcBtn = document.getElementById("litruv-add-svc");
    if (addSvcBtn) addSvcBtn.onclick = () => { svcData.push({ label: "", url: "", icon: "" }); renderServices(); };

    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.setAttribute("disabled", "");
        if (statusEl) { statusEl.textContent = "Saving…"; statusEl.className = "litruv-editor-status"; }
        try {
          const urlInput  = document.getElementById("litruv-uptime-url");
          const slugInput = document.getElementById("litruv-uptime-slug");
          const body = {
            quickLinks: qlData.map(l => ({ label: l.label ?? "", url: l.url ?? "" })),
            services: svcData.map(s => {
              if ("heading" in s) return { heading: s.heading ?? "" };
              /** @type {Record<string, string>} */
              const o = { label: s.label ?? "", url: s.url ?? "", icon: s.icon ?? "" };
              if (s.statusUrl)  o.statusUrl  = s.statusUrl;
              return o;
            }),
            uptimeUrl:  urlInput  instanceof HTMLInputElement ? urlInput.value  : "",
            uptimeSlug: slugInput instanceof HTMLInputElement ? slugInput.value : "",
          };
          const res = await fetch(`${API}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (statusEl) { statusEl.textContent = "Saved!"; statusEl.className = "litruv-editor-status litruv-editor-status--ok"; }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = `Error: ${/** @type {Error} */ (err).message}`;
            statusEl.className = "litruv-editor-status litruv-editor-status--err";
          }
        } finally {
          saveBtn.removeAttribute("disabled");
          setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
        }
      };
    }
  }

  // Activate editor whenever #litruv-editor-root appears in the DOM.
  // setTimeout(0) defers the check to the next event-loop tick, ensuring all
  // child elements degoog injects synchronously are present before initEditor runs.
  function _tryInitEditor() {
    const root = document.getElementById("litruv-editor-root");
    if (root && !root.dataset.editorInit) initEditor(root);
  }

  const _editorObs = new MutationObserver(() => setTimeout(_tryInitEditor, 0));
  if (document.body) {
    _editorObs.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () =>
      _editorObs.observe(document.body, { childList: true, subtree: true })
    );
  }
  _tryInitEditor();

  // ── End visual editor ────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
