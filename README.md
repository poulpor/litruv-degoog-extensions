# Litruv degoog Plugins

A small pile of plugins for [degoog](https://github.com/degoog/degoog).
Built to make the search UI a bit more useful.

---

## Auto-Bang

<img src="https://github.com/user-attachments/assets/a205be81-2342-4213-9281-0b536ad42ebe" alt="Auto-Bang preview" width="900" />

Forget the exact bang command? Happens to the best of us, cunt.

**Auto-Bang** searches through your available bang commands and flavor text in real-time, so you can find what you meant without memorising every damn shortcut.

Thanks to [@kris701](https://github.com/kris701?utm_source=chatgpt.com) for the bugfix.

---

## Plex Search

<img src="https://github.com/user-attachments/assets/2358bad7-c7d5-4ab9-8478-eaac4d1691a4" alt="Plex Search preview" width="900" />

Adds Plex search integration directly into degoog.

Originally based on the Jellyfin extension by [fccview-degoog-extensions](https://github.com/fccview/fccview-degoog-extensions?utm_source=chatgpt.com), then hacked apart and rebuilt for Plex support.

---

## Link Target

Simple little plugin that sets the `target` attribute on links.

Useful if you're using plugins like a custom new tab page and want links opening where they bloody should.

---

## Litruv Nav Bar

<img src="https://github.com/user-attachments/assets/3656368a-724e-4145-bfea-e8e3313d5c2c" alt="Litruv Nav Bar preview 1" width="700" />

<img src="https://github.com/user-attachments/assets/ce30efb6-1cc8-4b02-a3d1-3898a767e5d2" alt="Litruv Nav Bar preview 2" width="900" />

Injects a persistent navigation bar directly into the degoog search interface.

Features include:

* Quick-access links
* Service launcher with icon support
* Uptime Kuma status badges
* Automatic icon fetching + caching
* Built-in visual editor via `!navbar`
* Drag/drop style service reordering
* Auto-detection of icons from live service URLs

Icons are fetched server-side from:

* [dashboard-icons](https://github.com/walkxcode/dashboard-icons?utm_source=chatgpt.com)
* [selfh.st](https://selfh.st/icons/?utm_source=chatgpt.com)

### Visual Editor

<img src="https://github.com/user-attachments/assets/c5d26d3d-50a2-48ef-a72d-d25de42430aa" alt="Litruv Nav Bar editor" width="1000" />

Manage services, reorder entries, edit links, and configure icons without touching config files.

---

## Uptime Kuma Setup

<img src="https://github.com/user-attachments/assets/d075babe-bc38-4319-882e-115703252ae8" alt="Uptime Kuma setup" width="800" />

Using [Uptime Kuma](https://github.com/louislam/uptime-kuma?utm_source=chatgpt.com) with the Nav Bar is pretty straightforward:

1. Create a status page
   (mine's called `general` because naming things is hard)

2. For each service on the status page:

   * make sure the service link is clickable

3. In degoog, run:

   ```txt
   !navbar
   ```

4. Set the **Status URL** field to the matching service URL from Uptime Kuma.
