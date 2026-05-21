/** @type {Array<{label: string, url: string}>} */
let _quickLinks = [];

/** @type {Array<object>} */
let _services = [];

/** @type {Array<{label: string, url: string, icon?: string}>} */
let _shortcuts = [];

/** @type {string} */
let _uptimeUrl = "";

/** @type {string} */
let _uptimeSlug = "";

/** @type {string} */
let _pluginDir = "";

/** @type {string} */
let _pluginId = "";

/** @type {typeof fetch} */
let _fetch = fetch;

/**
 * Persists the current in-memory state back to config.json.
 * @returns {Promise<void>}
 */
async function saveDataFile() {
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      _pluginDir + "/config.json",
      JSON.stringify({ quickLinks: _quickLinks, services: _services, shortcuts: _shortcuts, uptimeUrl: _uptimeUrl, uptimeSlug: _uptimeSlug }, null, 2),
    );
  } catch (e) {
    console.error("[litruv-navbar] Failed to save config.json:", e);
  }
}

/** @type {boolean} */
let _editorEnabled = true;
let _editorSettingsLoaded = false;

/**
 * Reads editorEnabled directly from plugin-settings.json as a fallback
 * for when configure() hasn't been called yet.
 * @returns {Promise<void>}
 */
async function _loadEditorSettings() {
  if (_editorSettingsLoaded) return;
  _editorSettingsLoaded = true;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(_pluginDir + "/../plugin-settings.json", "utf-8");
    const all = JSON.parse(raw);
    const s = all?.["plugin-litruv-navbar"];
    if (s) {
      const val = s.editorEnabled;
      _editorEnabled = val !== false && val !== "false";
    }
  } catch { /* use default */ }
}

_loadEditorSettings().catch(() => {});

export default {
  name: "litruv Navbar",
  description: "Visual editor for the navbar config",
  trigger: "navbar",
  isClientExposed: false,

  settingsSchema: [
    {
      key: "editorEnabled",
      label: "Enable !navbar editor",
      type: "toggle",
      default: true,
      description: "Allow the !navbar bang command to open the visual config editor.",
    },
  ],

  /** @param {{ dir: string, readFile: (name: string) => Promise<string>, fetch: typeof fetch }} ctx */
  async init(ctx) {
    _pluginDir = ctx.dir;
    _pluginId  = ctx.dir.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || "litruv-navbar";
    if (ctx.fetch) _fetch = ctx.fetch;
    try {
      const raw  = await ctx.readFile("config.json");
      const data = JSON.parse(raw);
      if (Array.isArray(data.quickLinks)) _quickLinks = data.quickLinks;
      if (Array.isArray(data.services))   _services   = data.services;
      if (Array.isArray(data.shortcuts))  _shortcuts  = data.shortcuts;
      if (data.uptimeUrl)  _uptimeUrl  = data.uptimeUrl;
      if (data.uptimeSlug) _uptimeSlug = data.uptimeSlug;
    } catch { /* config.json missing or unparseable — settings will fill the gaps */ }
  },

  /**
   * @param {{ editorEnabled: boolean }} settings
   */
  configure(settings) {
    const val = settings?.editorEnabled;
    _editorEnabled = val !== false && val !== "false";
    _editorSettingsLoaded = true;
  },

  routes: [
    {
      method: "get",
      path: "/config",
      handler() {
        return Response.json({
          quickLinks: _quickLinks,
          services:   _services,
          shortcuts:  _shortcuts,
          uptimeUrl:  _uptimeUrl,
          uptimeSlug: _uptimeSlug,
        });
      },
    },
    {
      method: "post",
      path: "/upload-icon",
      async handler(req) {
        try {
          const form = await req.formData();
          const file = form.get("icon");
          if (!file || typeof file === "string") {
            return Response.json({ error: "No file provided" }, { status: 400 });
          }
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          if (!/\.(png|jpe?g|svg|webp|gif)$/i.test(safeName)) {
            return Response.json({ error: "Invalid file type" }, { status: 400 });
          }
          const { writeFile, mkdir } = await import("node:fs/promises");
          const imagesDir = _pluginDir + "/images";
          await mkdir(imagesDir, { recursive: true });
          await writeFile(imagesDir + "/" + safeName, Buffer.from(await file.arrayBuffer()));
          return Response.json({ ok: true, filename: safeName });
        } catch (e) {
          console.error("[litruv-navbar] Icon upload failed:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },
    {
      method: "get",
      path: "/icon",
      async handler(req) {
        const name = new URL(req.url).searchParams.get("name") ?? "";
        if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
          return new Response("Invalid name", { status: 400 });
        }
        const { readFile, writeFile, mkdir } = await import("node:fs/promises");
        const imagesDir = _pluginDir + "/images";
        const cacheFile = `cdn-${name.replace(/[^a-z0-9-]/gi, "-")}.png`;
        const cachePath = imagesDir + "/" + cacheFile;
        // Serve from cache if available
        try {
          const cached = await readFile(cachePath);
          return new Response(cached, {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
          });
        } catch { /* not cached yet */ }
        // Determine CDN source
        const cdnUrl = name.toLowerCase().startsWith("sh-")
          ? `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${encodeURIComponent(name.slice(3))}.png`
          : `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${encodeURIComponent(name)}.png`;
        try {
          const res = await fetch(cdnUrl);
          if (!res.ok) return new Response("Not found", { status: 404 });
          const buf = Buffer.from(await res.arrayBuffer());
          await mkdir(imagesDir, { recursive: true });
          await writeFile(cachePath, buf);
          return new Response(buf, {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
          });
        } catch (e) {
          console.error("[litruv-navbar] icon fetch failed:", e?.message ?? e);
          return new Response("Error fetching icon", { status: 502 });
        }
      },
    },
    {
      method: "get",
      path: "/detect-icon",
      async handler(req) {
        const rawUrl = new URL(req.url).searchParams.get("url") ?? "";
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
          return Response.json({ error: "Invalid URL" }, { status: 400 });
        }
        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 4000);
          const fetchOpts = {
            signal: ac.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; degoog-icon-resolver/1.0)" },
            redirect: "follow",
            // @ts-ignore — Bun-specific: allow self-signed / internal CA certs
            tls: { rejectUnauthorized: false },
          };
          let raw = "";
          try {
            // 1. Try HTML meta tags
            const res = await fetch(rawUrl, fetchOpts);
            const html = await res.text();
            const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
              ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
            const appName = html.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)?.[1]
              ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']application-name["']/i)?.[1];
            const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
            raw = (ogSite ?? appName ?? pageTitle ?? "").trim();

            // 2. Fall back to manifest.json if HTML gave nothing
            if (!raw) {
              const origin = new URL(res.url).origin;
              for (const path of ["/manifest.json", "/site.webmanifest"]) {
                try {
                  const mres = await fetch(origin + path, { ...fetchOpts, signal: ac.signal });
                  if (mres.ok) {
                    const mj = await mres.json();
                    raw = (mj?.short_name ?? mj?.name ?? "").trim();
                    if (raw) break;
                  }
                } catch { /* ignore */ }
              }
            }
          } finally {
            clearTimeout(timer);
          }

          // 3. Fall back to the first subdomain/hostname segment
          if (!raw) {
            const host = new URL(rawUrl).hostname; // e.g. photos.litruv.com
            raw = host.split(".")[0]; // → "photos"
          }

          // Strip common title suffixes and convert to kebab-case slug
          const stripped = raw.split(/\s*[-|–:]\s*/)[0].trim();
          const slug = stripped.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          return Response.json({ slug: slug || null });
        } catch (e) {
          console.error("[litruv-navbar] detect-icon fetch failed:", e?.message ?? e);
          return Response.json({ slug: null, error: String(e?.message ?? e) });
        }
      },
    },
    {
      method: "get",
      path: "/uptime-proxy",
      async handler() {
        if (!_uptimeUrl || !_uptimeSlug) {
          return Response.json({ error: "Uptime Kuma not configured" }, { status: 503 });
        }
        try {
          const [cfgRes, hbRes] = await Promise.all([
            _fetch(`${_uptimeUrl}/api/status-page/${encodeURIComponent(_uptimeSlug)}`),
            _fetch(`${_uptimeUrl}/api/status-page/heartbeat/${encodeURIComponent(_uptimeSlug)}`),
          ]);
          if (!cfgRes.ok || !hbRes.ok) {
            return Response.json({ error: "Uptime Kuma request failed" }, { status: 502 });
          }
          const [config, heartbeat] = await Promise.all([cfgRes.json(), hbRes.json()]);
          return Response.json({ config, heartbeat });
        } catch (e) {
          console.error("[litruv-navbar] uptime-proxy fetch failed:", e?.message ?? e);
          return Response.json({ error: String(e?.message ?? e) }, { status: 502 });
        }
      },
    },
    {
      method: "post",
      path: "/save",
      async handler(req) {
        /** @type {any} */
        let body;
        try {
          body = await req.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (Array.isArray(body.quickLinks))      _quickLinks = body.quickLinks;
        if (Array.isArray(body.services))         _services   = body.services;
        if (Array.isArray(body.shortcuts))        _shortcuts  = body.shortcuts;
        if (typeof body.uptimeUrl  === "string")  _uptimeUrl  = body.uptimeUrl;
        if (typeof body.uptimeSlug === "string")  _uptimeSlug = body.uptimeSlug;
        await saveDataFile();
        return Response.json({ ok: true });
      },
    },
  ],

  async execute() {
    await _loadEditorSettings();
    if (!_editorEnabled) {
      return { title: "Navbar Editor", html: "<p style=\"padding:1rem;opacity:0.6\">Editor is disabled. Enable it in the plugin settings.</p>" };
    }
    const apiBase = `/api/plugin/${_pluginId}`;
    return {
      title: "Navbar Editor",
      html: `<div class="litruv-editor" id="litruv-editor-root" data-api="${apiBase}">
  <div class="litruv-editor-toolbar">
    <span class="litruv-editor-title">Navbar Editor</span>
    <span id="litruv-status" class="litruv-editor-status"></span>
    <button class="litruv-btn litruv-btn--primary" id="litruv-save-btn">Save</button>
  </div>
  <div class="litruv-editor-body">
    <div class="litruv-editor-card">
      <div class="litruv-editor-card-header">
        <h3 class="litruv-editor-card-title">Quick Links</h3>
        <button class="litruv-btn litruv-btn--add" id="litruv-add-ql">+ Link</button>
      </div>
      <div id="litruv-ql-list" class="litruv-editor-list"></div>
    </div>
    <div class="litruv-editor-card">
      <div class="litruv-editor-card-header">
        <h3 class="litruv-editor-card-title">Shortcuts</h3>
        <button class="litruv-btn litruv-btn--add" id="litruv-add-sc">+ Shortcut</button>
      </div>
      <div id="litruv-sc-list" class="litruv-editor-list"></div>
    </div>
    <div class="litruv-editor-card">
      <div class="litruv-editor-card-header">
        <h3 class="litruv-editor-card-title">Services</h3>
        <div class="litruv-editor-card-btns">
          <button class="litruv-btn litruv-btn--add" id="litruv-add-heading">+ Heading</button>
          <button class="litruv-btn litruv-btn--add" id="litruv-add-svc">+ Service</button>
        </div>
      </div>
      <div id="litruv-svc-list" class="litruv-editor-list"></div>
    </div>
    <div class="litruv-editor-card litruv-editor-card--compact">
      <div class="litruv-editor-card-header">
        <h3 class="litruv-editor-card-title">Uptime Kuma</h3>
      </div>
      <div class="litruv-uptime-fields">
        <label class="litruv-field">
          <span class="litruv-field-label">URL</span>
          <input id="litruv-uptime-url" type="url" class="litruv-input" placeholder="https://uptime.example.com">
        </label>
        <label class="litruv-field">
          <span class="litruv-field-label">Status Page Slug</span>
          <input id="litruv-uptime-slug" type="text" class="litruv-input" placeholder="general">
        </label>
      </div>
    </div>
  </div>
</div>`,
    };
  },
};
