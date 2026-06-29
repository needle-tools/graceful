import { apiInitializer } from "discourse/lib/api";

// `settings` is injected by the Discourse theme system (values from settings.yml).
/* global settings */

const SLOT_SELECTOR = "[data-needle-whats-new-slot]";
const HOVER_DWELL_MS = 500; // docs: count only sustained hover, not scroll-by
const FADE_MS = 400;

export default apiInitializer("1.8.0", (api) => {
  const FEED_URL = settings.feed_url;
  const TRACKER_URL = settings.tracker_url;
  const SURFACE = settings.surface;
  const LICENSE = settings.license_state;
  const EXTRA_TAGS = (settings.extra_tags || "").toString().trim();
  const ROTATE = settings.rotate;
  const ROTATE_MS = Math.max(4, settings.rotate_interval_seconds || 10) * 1000;

  const REDUCE_MOTION =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Load the engagement tracker once (mode B: we call impression/hover/dismiss ourselves;
  // clicks are counted by the item.url /r/ redirect, so we never call click()).
  function ensureTracker() {
    if (document.querySelector("script[data-needle-whatsnew-loader]")) {
      return;
    }
    const s = document.createElement("script");
    s.defer = true;
    s.src = TRACKER_URL;
    s.dataset.surface = SURFACE;
    s.setAttribute("data-needle-whatsnew-loader", "1");
    document.head.appendChild(s);
  }

  function track(method, id) {
    try {
      window.needleWhatsNew?.[method]?.(id, { surface: SURFACE });
    } catch (e) {
      // Surface, never swallow — tracking must not break rendering.
      // eslint-disable-next-line no-console
      console.warn("[needle-whats-new] tracking failed:", method, id, e);
    }
  }

  // Priority-weighted random pick (docs: weight = priority + 1).
  function weightedPick(items, avoidId) {
    let pool = items;
    if (avoidId && items.length > 1) {
      pool = items.filter((it) => it.id !== avoidId);
    }
    const weight = (it) => (it.priority || 0) + 1;
    const total = pool.reduce((sum, it) => sum + weight(it), 0);
    let r = Math.random() * total;
    return pool.find((it) => (r -= weight(it)) < 0) ?? pool[0];
  }

  // Simplified readable-foreground from a hex background.
  // NOTE: the feed docs recommend full oklch derivation; this is a pragmatic
  // WCAG-luminance approximation. Good enough for CTA text contrast; revisit if
  // we need tints/shades/borders derived per the docs' oklch guidance.
  function readableText(hex) {
    if (!hex) {
      return null;
    }
    const raw = hex.replace("#", "");
    const v =
      raw.length === 3
        ? raw
            .split("")
            .map((c) => c + c)
            .join("")
        : raw;
    if (v.length < 6) {
      return null;
    }
    const channel = (i) => parseInt(v.slice(i, i + 2), 16) / 255;
    const lin = (c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const L =
      0.2126 * lin(channel(0)) +
      0.7152 * lin(channel(2)) +
      0.0722 * lin(channel(4));
    return L > 0.5 ? "#1a1a1a" : "#fafafa";
  }

  function buildCard(item) {
    const colors = Array.isArray(item.colors) ? item.colors : [];
    // Soft single-colour CTA — Needle Green by default; feed `colors` override.
    const ctaBg = colors[0] || "#99CC33";

    const card = document.createElement("div");
    card.className = "needle-wn__card needle-wn__card--enter";
    card.dataset.itemId = item.id;
    card.style.setProperty("--nwn-cta-bg", ctaBg);
    // Needle Green is light → dark text reads well on the CTA.
    card.style.setProperty("--nwn-cta-fg", readableText(ctaBg) || "#1a1a1a");

    const banner = item.banner || {};
    const title = banner.title || item.short?.title || "";
    const subtitle = banner.subtitle || item.card?.text || "";
    const ctaText = banner.cta || "Learn more";

    // Left content column (eyebrow + title + text); CTA sits to the right.
    const body = document.createElement("div");
    body.className = "needle-wn__body";

    // Eyebrow / kicker: optional logo + a small brand label ("New at Needle").
    const label = (settings.eyebrow_label || "").toString().trim();
    const logoUrl = (settings.logo_url || "").toString().trim();
    if (label || logoUrl) {
      const eyebrow = document.createElement("div");
      eyebrow.className = "needle-wn__eyebrow";
      if (logoUrl) {
        const logo = document.createElement("img");
        logo.className = "needle-wn__logo";
        logo.src = logoUrl;
        logo.alt = "";
        logo.setAttribute("aria-hidden", "true");
        eyebrow.appendChild(logo);
      }
      if (label) {
        const labelEl = document.createElement("span");
        labelEl.textContent = label;
        eyebrow.appendChild(labelEl);
      }
      body.appendChild(eyebrow);
    }

    const titleEl = document.createElement("div");
    titleEl.className = "needle-wn__title";
    titleEl.textContent = title;
    body.appendChild(titleEl);

    // Text is length-capped upstream (≤240) — let it wrap, never clamp/ellipsis.
    const textEl = document.createElement("p");
    textEl.className = "needle-wn__text";
    textEl.textContent = subtitle;
    body.appendChild(textEl);

    const cta = document.createElement("a");
    cta.className = "needle-wn__cta";
    cta.textContent = ctaText;
    cta.rel = "noopener";
    cta.target = "_blank";
    // Preferred: item.url is the /r/ redirect — using it as the href counts the
    // click server-side, so we must NOT also call needleWhatsNew.click().
    cta.href = item.url || item.targetUrl || "#";

    card.append(body, cta);
    return { card, cta };
  }

  async function fetchItems() {
    const params = new URLSearchParams();
    if (SURFACE) {
      params.set("surface", SURFACE);
    }
    if (LICENSE) {
      params.set("license", LICENSE);
    }
    if (EXTRA_TAGS) {
      params.set("tags", EXTRA_TAGS);
    }
    const res = await fetch(`${FEED_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`feed responded ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  }

  async function render(slot) {
    if (slot.dataset.nwnInit) {
      return;
    }
    slot.dataset.nwnInit = "1";

    let items = [];
    try {
      items = await fetchItems();
    } catch (e) {
      // Surface, never swallow. Leave the slot empty (reserved height, no shift).
      // eslint-disable-next-line no-console
      console.warn("[needle-whats-new] feed fetch failed:", e);
      return;
    }
    if (!items.length) {
      return;
    }

    ensureTracker();

    const wrapper = document.createElement("div");
    wrapper.className = "needle-wn";
    if (REDUCE_MOTION) {
      wrapper.classList.add("needle-wn--no-motion");
    }
    slot.replaceChildren(wrapper);

    let current = null;
    let currentId = null;
    let rotationTimer = null;

    function stopRotation() {
      if (rotationTimer) {
        window.clearInterval(rotationTimer);
        rotationTimer = null;
      }
    }

    function show(item) {
      const { card, cta } = buildCard(item);

      let hoverTimer = null;
      card.addEventListener("pointerenter", () => {
        hoverTimer = window.setTimeout(
          () => track("hover", item.id),
          HOVER_DWELL_MS
        );
      });
      card.addEventListener("pointerleave", () => {
        if (hoverTimer) {
          window.clearTimeout(hoverTimer);
          hoverTimer = null;
        }
      });
      cta.addEventListener("focus", () => track("hover", item.id), {
        once: true,
      });

      const previous = current;
      wrapper.appendChild(card);
      // Next frame: fade the new card in; fade the old one out, then remove it.
      requestAnimationFrame(() =>
        card.classList.remove("needle-wn__card--enter")
      );
      if (previous) {
        previous.classList.add("needle-wn__card--leave");
        window.setTimeout(
          () => previous.remove(),
          REDUCE_MOTION ? 0 : FADE_MS
        );
      }
      current = card;
      currentId = item.id;

      track("impression", item.id); // tracker dedups one impression per id per session
    }

    show(weightedPick(items));

    if (ROTATE && items.length > 1 && !REDUCE_MOTION) {
      rotationTimer = window.setInterval(() => {
        if (!document.body.contains(wrapper)) {
          stopRotation(); // navigated away — stop the stale timer
          return;
        }
        show(weightedPick(items, currentId));
      }, ROTATE_MS);
    }
  }

  let observer = null;

  function tryRender() {
    const slot = document.querySelector(SLOT_SELECTOR);
    if (slot) {
      render(slot);
      return true;
    }
    return false;
  }

  // The connector's slot lives at the bottom of the topic (above Suggested Topics).
  // In long, lazy-loaded threads that DOM node doesn't exist on initial page load —
  // it mounts only once the reader scrolls to the end. A single check on page change
  // therefore misses it, so we also watch for the slot to appear and render it then.
  api.onPageChange(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (tryRender()) {
      return; // slot already present (short threads)
    }
    const root = document.querySelector("#main-outlet") || document.body;
    observer = new MutationObserver(() => {
      if (tryRender()) {
        observer.disconnect();
        observer = null;
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  });
});
