import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";

const DATADIR = join(process.cwd(), "data", "custom-logo");
const LOGOPATH = join(DATADIR, "logo.dat");
const STOREPATH = join(DATADIR, "logos.json");
const DIMSPATH = join(DATADIR, "dimensions.json");

const DEFAULTDIMS = {
  homeMaxHeight: 300,
  homeMaxWidth: 500,
  searchMaxHeight: 100,
  searchMaxWidth: 300,
};

const DEFAULTSTORE = {
  images: [],
  rotationMode: "reload",
  intervalSec: 60,
  randomize: true,
  lastIndex: -1,
};

let hideLogoManagement = false;
let logoIntro = "none";
let settingsLoaded = false;

const validRotationModes = ["reload", "interval"];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function loadLegacySingle() {
  try {
    const data = await readFile(LOGOPATH, "utf-8");
    if (typeof data === "string" && data.startsWith("data:image")) {
      return {
        id: uid(),
        name: "legacy-logo",
        dataUrl: data,
      };
    }
  } catch {}
  return null;
}

async function loadStore() {
  try {
    const raw = await readFile(STOREPATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTSTORE,
      ...parsed,
      images: Array.isArray(parsed?.images)
        ? parsed.images.filter((img) => typeof img?.dataUrl === "string" && img.dataUrl.startsWith("data:image")).map((img) => ({
            id: typeof img.id === "string" && img.id ? img.id : uid(),
            name: typeof img.name === "string" && img.name ? img.name : "image",
            dataUrl: img.dataUrl,
          }))
        : [],
      rotationMode: validRotationModes.includes(parsed?.rotationMode) ? parsed.rotationMode : DEFAULTSTORE.rotationMode,
      intervalSec: Number.isFinite(Number(parsed?.intervalSec)) && Number(parsed.intervalSec) > 0 ? Number(parsed.intervalSec) : DEFAULTSTORE.intervalSec,
      randomize: parsed?.randomize !== false,
      lastIndex: Number.isInteger(parsed?.lastIndex) ? parsed.lastIndex : -1,
    };
  } catch {
    const legacy = await loadLegacySingle();
    if (legacy) {
      return { ...DEFAULTSTORE, images: [legacy] };
    }
    return { ...DEFAULTSTORE };
  }
}

async function saveStore(store) {
  await mkdir(DATADIR, { recursive: true });
  await writeFile(STOREPATH, JSON.stringify(store), "utf-8");
  try { await unlink(LOGOPATH); } catch {}
}

async function loadDimensions() {
  try {
    const raw = await readFile(DIMSPATH, "utf-8");
    return { ...DEFAULTDIMS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTDIMS };
  }
}

async function saveDimensions(dims) {
  await mkdir(DATADIR, { recursive: true });
  await writeFile(DIMSPATH, JSON.stringify(dims), "utf-8");
}

const pickNextImage = (store) => {
  const imgs = store.images || [];
  if (!imgs.length) return { dataUrl: null, nextStore: store };
  if (imgs.length === 1) return { dataUrl: imgs[0].dataUrl, nextStore: { ...store, lastIndex: 0 } };

  let index = 0;
  if (store.randomize) {
    const candidates = imgs.map((_, i) => i).filter((i) => i !== store.lastIndex);
    index = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    index = (store.lastIndex + 1 + imgs.length) % imgs.length;
  }

  return {
    dataUrl: imgs[index].dataUrl,
    nextStore: { ...store, lastIndex: index },
  };
};

const loadSettings = async () => {
  if (settingsLoaded) return;
  settingsLoaded = true;
  try {
    const settingsPath = join(process.cwd(), "data", "plugin-settings.json");
    const raw = await readFile(settingsPath, "utf-8");
    const allSettings = JSON.parse(raw);
    const pluginSettings = allSettings?.["plugin-custom-logo"];
    if (pluginSettings) {
      const val = pluginSettings.hideLogoManagement;
      hideLogoManagement = val === true || val === "true";
      const validIntros = ["none", "fade", "matrix"];
      logoIntro = validIntros.includes(pluginSettings.logoIntro) ? pluginSettings.logoIntro : "none";
    }
  } catch {}
};

loadSettings().catch(() => {});

const cardHtml = async () => {
  const [store, dims] = await Promise.all([loadStore(), loadDimensions()]);
  const current = store.images?.[0]?.dataUrl ?? null;
  const { homeMaxHeight, homeMaxWidth, searchMaxHeight, searchMaxWidth } = dims;
  const previewHtml = current
    ? `<img id="custom-logo-preview" src="${current}" alt="Current logo" style="max-height:80px;max-width:220px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);" />`
    : `<p id="custom-logo-nologo" style="font-size:0.82rem;color:var(--text-secondary);font-style:italic;margin:0;">No custom logo set.</p>`;
  const homePreviewImg = current
    ? `<img id="custom-logo-home-preview-img" src="${current}" alt="Home logo preview" style="max-height:${homeMaxHeight}px;max-width:${homeMaxWidth}px;object-fit:contain;display:block;" />`
    : `<img id="custom-logo-home-preview-img" src="" alt="Home logo preview" style="max-height:${homeMaxHeight}px;max-width:${homeMaxWidth}px;object-fit:contain;display:none;" />`;
  const gallery = (store.images || []).length
    ? store.images.map((img) => `
      <div class="custom-logo-gallery-item" data-logo-id="${img.id}">
        <img src="${img.dataUrl}" alt="${img.name}" class="custom-logo-gallery-thumb" />
        <div class="custom-logo-gallery-meta">
          <span class="custom-logo-gallery-name">${img.name}</span>
          <button type="button" class="custom-logo-btn custom-logo-btn--remove custom-logo-remove-item" data-logo-id="${img.id}">Remove</button>
        </div>
      </div>`).join("")
    : `<p class="custom-logo-none" id="custom-logo-gallery-empty">No images added yet.</p>`;

  const checkedReload = store.rotationMode === "reload" ? "checked" : "";
  const checkedInterval = store.rotationMode === "interval" ? "checked" : "";
  const checkedRandom = store.randomize ? "checked" : "";
  const checkedSequential = !store.randomize ? "checked" : "";

  const sliderRow = (id, label, min, max, value) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:0.78rem;color:var(--text-secondary);min-width:110px;">${label}</span>
      <input id="${id}" type="range" min="${min}" max="${max}" value="${value}" style="flex:1;accent-color:var(--accent,#cba6f7);" />
      <span id="${id}-val" style="font-size:0.78rem;min-width:44px;text-align:right;">${value}px</span>
    </div>`;

  return {
    title: "Custom Logo",
    html: `
      <div id="custom-logo-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;">
        <div style="background:rgba(0,0,0,0.15);border-radius:8px;padding:20px 16px 24px;display:flex;flex-direction:column;align-items:center;gap:18px;">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);align-self:flex-start;">Home page preview</span>
          ${homePreviewImg}
          <div style="width:100%;max-width:584px;display:flex;flex-direction:column;align-items:stretch;gap:18px;">
            <div style="display:flex;align-items:center;width:100%;border-radius:24px;border:1px solid rgba(255,255,255,0.15);background:var(--bg-secondary,#1e1e2e);padding:10px 16px;gap:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;flex-shrink:0;"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
              <span style="flex:1;font-size:0.95rem;color:var(--text-secondary);user-select:none;"></span>
            </div>
            <div style="display:flex;gap:11px;justify-content:center;">
              <span style="padding:10px 20px;border-radius:4px;font-size:0.875rem;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid rgba(255,255,255,0.1);user-select:none;font-weight:500;">degoog Search</span>
              <span style="padding:10px 20px;border-radius:4px;font-size:0.875rem;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid rgba(255,255,255,0.1);user-select:none;font-weight:500;">I'm Feeling Lucky</span>
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:10px;">${previewHtml}</div>

        <div class="custom-logo-upload-ui">
          <div class="custom-logo-actions">
            <label class="custom-logo-btn">Add image(s)
              <input id="custom-logo-file" type="file" accept="image/*" multiple style="display:none;" />
            </label>
            <button id="custom-logo-remove-all" type="button" class="custom-logo-btn custom-logo-btn--remove">Remove all</button>
          </div>
          <div id="custom-logo-gallery" class="custom-logo-gallery">${gallery}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Rotation</span>
          <label><input type="radio" name="cl-rotation-mode" value="reload" ${checkedReload}> Change on page reload</label>
          <label><input type="radio" name="cl-rotation-mode" value="interval" ${checkedInterval}> Change every interval</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.78rem;color:var(--text-secondary);min-width:110px;">Interval (sec)</span>
            <input id="cl-interval-sec" type="number" min="1" step="1" value="${store.intervalSec}" style="width:100px;background:var(--search-bar-bg);color:var(--text-primary,#cdd6f4);border:1px solid var(--border-light, rgba(255,255,255,0.15));border-radius:6px;padding:6px 8px;" />
          </div>
          <label><input type="radio" name="cl-random-mode" value="random" ${checkedRandom}> Random</label>
          <label><input type="radio" name="cl-random-mode" value="sequential" ${checkedSequential}> Sequential</label>
          <button id="custom-logo-save-rotation" type="button" class="custom-logo-btn" style="align-self:flex-start;">Save rotation</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Dimensions</span>
          ${sliderRow("cl-home-h", "Home height", 20, 600, homeMaxHeight)}
          ${sliderRow("cl-home-w", "Home width", 50, 1200, homeMaxWidth)}
          ${sliderRow("cl-search-h", "Search height", 20, 300, searchMaxHeight)}
          ${sliderRow("cl-search-w", "Search width", 50, 600, searchMaxWidth)}
          <button id="custom-logo-save-dims" style="align-self:flex-start;margin-top:2px;padding:5px 14px;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:var(--bg-secondary,#1e1e2e);color:var(--text-primary,#cdd6f4);">Save dimensions</button>
        </div>

        <p id="custom-logo-status" style="font-size:0.78rem;color:var(--text-secondary);margin:0;"></p>
      </div>`,
  };
};

export default {
  name: "Custom Logo",
  description: "Replace the degoog logo with your own image(s). Use !logo in the search bar to manage them.",
  trigger: "logo",
  isClientExposed: false,
  settingsSchema: [
    {
      key: "hideLogoManagement",
      label: "Hide logo management",
      type: "toggle",
      default: false,
      description: "Prevent users from uploading or changing the logo (useful for public instances).",
    },
    {
      key: "logoIntro",
      label: "Logo intro animation",
      type: "select",
      options: ["none", "fade", "matrix"],
      default: "none",
      description: "Canvas animation played when the custom logo first appears on the page.",
    },
  ],
  configure(settings) {
    const val = settings?.hideLogoManagement;
    hideLogoManagement = val === true || val === "true";
    const validIntros = ["none", "fade", "matrix"];
    logoIntro = validIntros.includes(settings?.logoIntro) ? settings.logoIntro : "none";
    settingsLoaded = true;
  },
  async execute() {
    await loadSettings();
    if (hideLogoManagement) {
      return {
        title: "Custom Logo",
        html: `<div id="custom-logo-card" style="padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><p style="font-size:0.9rem;color:var(--text-secondary);margin:0;text-align:center;">Logo management is disabled on this instance.</p></div>`,
      };
    }
    return await cardHtml();
  },
  routes: [
    {
      method: "get",
      path: "settings",
      handler: async () => {
        await loadSettings();
        return new Response(JSON.stringify({ hideLogoManagement, logoIntro }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "get",
      path: "logo",
      handler: async () => {
        const store = await loadStore();
        const { dataUrl, nextStore } = pickNextImage(store);
        if (nextStore.lastIndex !== store.lastIndex) await saveStore(nextStore);
        return new Response(JSON.stringify({ dataUrl, rotationMode: store.rotationMode, intervalSec: store.intervalSec, randomize: store.randomize }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "get",
      path: "logos",
      handler: async () => {
        const store = await loadStore();
        return new Response(JSON.stringify(store), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "post",
      path: "logos",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return new Response(JSON.stringify({ error: "Logo management is disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
        let body;
        try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
        const images = Array.isArray(body?.images) ? body.images : [];
        const valid = [];
        for (const img of images) {
          const dataUrl = img?.dataUrl;
          const name = typeof img?.name === "string" && img.name ? img.name : "image";
          if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) continue;
          if (dataUrl.length > 2 * 1024 * 1024 * 1.37) continue;
          valid.push({ id: uid(), name, dataUrl });
        }
        if (!valid.length) return new Response(JSON.stringify({ error: "No valid images provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
        const store = await loadStore();
        store.images = [...store.images, ...valid];
        await saveStore(store);
        return new Response(JSON.stringify({ ok: true, images: store.images }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "post",
      path: "logos/remove",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return new Response(JSON.stringify({ error: "Logo management is disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
        let body;
        try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
        const id = body?.id;
        if (typeof id !== "string" || !id) return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400, headers: { "Content-Type": "application/json" } });
        const store = await loadStore();
        store.images = store.images.filter((img) => img.id !== id);
        if (!store.images.length) store.lastIndex = -1;
        else if (store.lastIndex >= store.images.length) store.lastIndex = 0;
        await saveStore(store);
        return new Response(JSON.stringify({ ok: true, images: store.images }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "post",
      path: "logos/clear",
      handler: async () => {
        await loadSettings();
        if (hideLogoManagement) return new Response(JSON.stringify({ error: "Logo management is disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
        const store = await loadStore();
        store.images = [];
        store.lastIndex = -1;
        await saveStore(store);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "post",
      path: "rotation-settings",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return new Response(JSON.stringify({ error: "Logo management is disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
        let body;
        try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
        const store = await loadStore();
        store.rotationMode = validRotationModes.includes(body?.rotationMode) ? body.rotationMode : store.rotationMode;
        store.intervalSec = Number.isFinite(Number(body?.intervalSec)) && Number(body.intervalSec) > 0 ? Number(body.intervalSec) : store.intervalSec;
        store.randomize = body?.randomize !== false;
        await saveStore(store);
        return new Response(JSON.stringify({ ok: true, store }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "get",
      path: "dimensions",
      handler: async () => {
        const dims = await loadDimensions();
        return new Response(JSON.stringify(dims), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
    {
      method: "post",
      path: "dimensions",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return new Response(JSON.stringify({ error: "Dimension management is disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
        let body;
        try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
        const n = (v, fb) => {
          const x = parseInt(v, 10);
          return !isNaN(x) && x > 0 ? x : fb;
        };
        const dims = {
          homeMaxHeight: n(body?.homeMaxHeight, 300),
          homeMaxWidth: n(body?.homeMaxWidth, 500),
          searchMaxHeight: n(body?.searchMaxHeight, 100),
          searchMaxWidth: n(body?.searchMaxWidth, 300),
        };
        await saveDimensions(dims);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  ],
};
