// ==UserScript==
// @name         LinkedIn — Export message transcript
// @namespace    https://github.com/MarkDev/userscripts
// @version      1.0.3
// @description  Copies the open conversation as plain text after scrolling to load the full thread
// @match        https://www.linkedin.com/messaging*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BTN_ID = "li-transcript-export-btn";

  /** LinkedIn messaging thread DOM selectors */
  const SELECTORS = {
    scrollWithinWrapper: ".msg-convo-wrapper .msg-s-message-list.scrollable",
    scrollFallback: ".msg-s-message-list.scrollable",
    messageListLoader: ".msg-s-message-list__loader",
    messageEventRow: "li.msg-s-message-list__event",
    messageBubbleWithUrn: ".msg-s-event-listitem[data-event-urn]",
    dateHeadingInEventRow: ":scope > time.msg-s-message-list__time-heading",
    conversationTitle:
      ".msg-title-bar .msg-entity-lockup__entity-title, .msg-entity-lockup__entity-title",
    conversationHeadline: ".msg-title-bar .msg-entity-lockup__entity-info",
    headlineStrip: ".visually-hidden, .msg-entity-lockup__presence-indicator",
    messageGroupName: ".msg-s-message-group__name",
    messageTimestamp: "time.msg-s-message-group__timestamp",
    messageSubject: ".msg-s-event-listitem__subject",
    messageBody: ".msg-s-event-listitem__body",
    eventContentFallback: ".msg-s-event__content",
    tagBr: "br",
    tagLi: "li",
  };

  const CLASS_NAMES = {
    bubbleSelf: "msg-s-event-listitem--self",
  };

  const ATTR = {
    messageUrn: "data-event-urn",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findScrollRoot() {
    const inThread = document.querySelector(SELECTORS.scrollWithinWrapper);
    if (inThread) return inThread;
    return document.querySelector(SELECTORS.scrollFallback);
  }

  function collectMessageUrns(root = document) {
    const set = new Set();
    root.querySelectorAll(SELECTORS.messageBubbleWithUrn).forEach((el) => {
      const urn = el.getAttribute(ATTR.messageUrn);
      if (urn) set.add(urn);
    });
    return set;
  }

  async function waitForLoaderHidden(scrollRoot, maxMs = 15000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const loader = scrollRoot.querySelector(SELECTORS.messageListLoader);
      if (!loader || loader.classList.contains("hidden")) {
        await sleep(80);
        const again = scrollRoot.querySelector(SELECTORS.messageListLoader);
        if (!again || again.classList.contains("hidden")) return;
      }
      await sleep(120);
    }
  }

  async function loadFullTranscript(scrollRoot, options = {}) {
    const maxPasses = options.maxPasses ?? 80;
    const settleNeed = options.settleNeed ?? 5;
    const pauseMs = options.pauseMs ?? 400;

    let best = collectMessageUrns();
    let settle = 0;

    for (let pass = 0; pass < maxPasses && settle < settleNeed; pass++) {
      const before = best.size;

      scrollRoot.scrollTop = 0;
      await sleep(pauseMs);
      await waitForLoaderHidden(scrollRoot);

      scrollRoot.scrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
      await sleep(pauseMs);
      await waitForLoaderHidden(scrollRoot);

      scrollRoot.scrollTop = Math.max(
        0,
        Math.floor((scrollRoot.scrollHeight - scrollRoot.clientHeight) / 2)
      );
      await sleep(150);

      const now = collectMessageUrns();
      if (now.size > best.size) {
        best = now;
        settle = 0;
      } else if (now.size === before) {
        settle++;
      } else {
        settle = 0;
      }
    }

    scrollRoot.scrollTop = 0;
    await sleep(pauseMs);
    await waitForLoaderHidden(scrollRoot);
  }

  function normalizeWs(s) {
    return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Rich message HTML uses <br> and lists; textContent squashes those. Clone, turn <br> into
   * newlines and prefix list items so structure survives in plain text.
   */
  function htmlElementToPlainText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("script, style").forEach((n) => n.remove());
    clone.querySelectorAll(SELECTORS.tagBr).forEach((br) => {
      br.replaceWith(document.createTextNode("\n"));
    });
    clone.querySelectorAll(SELECTORS.tagLi).forEach((li) => {
      li.prepend("• ");
      li.append("\n");
    });
    let t = clone.textContent || "";
    t = t.replace(/\r\n/g, "\n");
    t = t.replace(/[ \t]+\n/g, "\n");
    t = t.replace(/\n[ \t]+/g, "\n");
    t = t.replace(/\n{3,}/g, "\n\n");
    return t.trim();
  }

  function conversationTitle() {
    const h2 = document.querySelector(SELECTORS.conversationTitle);
    if (h2 && h2.textContent) return normalizeWs(h2.textContent);
    const t = document.title || "";
    return t.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || "LinkedIn conversation";
  }

  /** Headline / title under the name in the thread header (e.g. job title and company). */
  function conversationHeadline() {
    const dd = document.querySelector(SELECTORS.conversationHeadline);
    if (!dd) return "";
    const clone = dd.cloneNode(true);
    clone.querySelectorAll(SELECTORS.headlineStrip).forEach((el) => {
      el.remove();
    });
    return normalizeWs(clone.textContent);
  }

  function buildTranscriptText() {
    const url = window.location.href.split("?")[0];
    const title = conversationTitle();
    const headline = conversationHeadline();
    const lines = [];

    const headerLines = [
      "LinkedIn — message export",
      "═".repeat(44),
      `Conversation: ${title}`,
    ];
    if (headline) headerLines.push(`Title: ${headline}`);
    headerLines.push(
      `URL: ${url}`,
      `Exported: ${new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}`,
      "",
      "─".repeat(44)
    );
    const header = headerLines.join("\n");
    lines.push(header);

    const seen = new Set();
    let currentDate = "";

    document.querySelectorAll(SELECTORS.messageEventRow).forEach((li) => {
      const dateEl = li.querySelector(SELECTORS.dateHeadingInEventRow);
      if (dateEl) {
        const d = normalizeWs(dateEl.textContent);
        if (d && d !== currentDate) {
          currentDate = d;
          lines.push("", `[ ${d} ]`, "");
        }
      }

      const item = li.querySelector(SELECTORS.messageBubbleWithUrn);
      if (!item) return;

      const urn = item.getAttribute(ATTR.messageUrn);
      if (!urn || seen.has(urn)) return;
      seen.add(urn);

      const isSelf = item.classList.contains(CLASS_NAMES.bubbleSelf);
      const nameEl = item.querySelector(SELECTORS.messageGroupName);
      const sender = isSelf
        ? "You"
        : nameEl
          ? normalizeWs(nameEl.textContent)
          : "Unknown";

      const timeEl = item.querySelector(SELECTORS.messageTimestamp);
      const timeStr = timeEl ? normalizeWs(timeEl.textContent) : "";

      const subjectEl = item.querySelector(SELECTORS.messageSubject);
      const subjectText = subjectEl ? normalizeWs(subjectEl.textContent) : "";

      const bodyParts = [];
      item.querySelectorAll(SELECTORS.messageBody).forEach((p) => {
        const t = htmlElementToPlainText(p);
        if (t) bodyParts.push(t);
      });
      if (bodyParts.length === 0) {
        const alt = item.querySelector(SELECTORS.eventContentFallback);
        if (alt) {
          const t = htmlElementToPlainText(alt);
          if (t) bodyParts.push(t);
        }
      }
      const bodyOnly = bodyParts.join("\n\n");
      const body = [subjectText, bodyOnly].filter(Boolean).join(subjectText && bodyOnly ? "\n\n" : "");

      const meta = timeStr ? `${sender} — ${timeStr}` : sender;
      lines.push(meta);
      lines.push(body);
      lines.push("");
    });

    return normalizeWs(lines.join("\n"));
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  async function runExport(button) {
    const scrollRoot = findScrollRoot();
    if (!scrollRoot) {
      alert("Open a conversation thread first (linkedin.com/messaging).");
      return;
    }

    const prev = button.textContent;
    button.disabled = true;
    button.textContent = "Exporting…";

    try {
      await loadFullTranscript(scrollRoot);
      const text = buildTranscriptText();
      await copyToClipboard(text);
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = prev;
        button.disabled = false;
      }, 2000);
    } catch (e) {
      console.error("[li-export]", e);
      button.textContent = "Failed";
      setTimeout(() => {
        button.textContent = prev;
        button.disabled = false;
      }, 2500);
    }
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Export transcript";
    btn.setAttribute("aria-label", "Export conversation transcript to clipboard");
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "10000",
      padding: "10px 14px",
      fontSize: "13px",
      fontWeight: "600",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      color: "#fff",
      background: "#0a66c2",
      border: "none",
      borderRadius: "24px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      cursor: "pointer",
    });
    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.background = "#004182";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#0a66c2";
    });
    btn.addEventListener("click", () => runExport(btn));

    document.body.appendChild(btn);
  }

  ensureButton();
  new MutationObserver(() => {
    if (!document.getElementById(BTN_ID)) ensureButton();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
