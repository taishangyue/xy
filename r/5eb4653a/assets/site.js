(function () {
  "use strict";
  let config = XiyouConfig.normalize(window.XIYOU_CONFIG);
  let groupAction = config.community.defaultAction;
  let activeVersion = null;
  let dialogMode = "downloads";
  let returnFocus = null;
  let toastTimer;
  let downloadStatus = "unavailable";
  let downloadEpoch = 0;
  let offlineEpoch = 0;
  let downloadController = null;
  let localPreview = false;
  let releaseRetired = false;
  const releaseId = document.querySelector('meta[name="xiyou-release"]').content;
  const nudges = XiyouNudges.create(config.versions.map(version => version.id));
  const grid = document.querySelector("#version-grid");
  const dialog = document.querySelector("#resource-dialog");
  const content = document.querySelector("#dialog-content");
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const illustratedVersions = new Set(["xiaoyao", "shie", "taishang", "zaixu", "huodong", "original", "mogai"]);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[ch]));
  const role = version => version.ownership === "self" ? {support:"支持一下", icon:"heart", message:"喜欢这段西行，欢迎支持一下，帮助后续制作。"} : version.ownership === "collected" ? {support:"支持整理者", icon:"gift", message:"喜欢这份分享，欢迎支持整理者，帮助后续整理。"} : {support:"自愿赞赏", icon:"heart", message:"愿这一卷能带给你快乐。感谢支持这处西游资源小站。"};
  // Never trust a download address restored from the HTTP cache or back/forward cache.
  // The public configuration is fetched from the site again, without eval or local storage.
  function clearDownloads(state = "unavailable") {
    downloadEpoch++;
    downloadController?.abort();
    downloadController = null;
    downloadStatus = state;
    document.documentElement.dataset.downloadState = state;
    for (const v of config.versions) v.downloads = [];
    for (const v of window.XIYOU_CONFIG?.versions || []) v.downloads = [];
    if (activeVersion) activeVersion.downloads = [];
    clearTimeout(toastTimer);
    const toast = document.querySelector("#toast");
    toast.textContent = "";
    toast.classList.remove("is-visible");
    if (dialog.open && dialogMode === "downloads") renderDialog();
  }
  async function fetchOnlineConfig(signal) {
    const generation = offlineEpoch;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, {once:true});
    const timer = setTimeout(cancel, 12000);
    try {
      if (signal?.aborted || navigator.onLine === false) throw new Error("offline or cancelled");
      // Verify the current release only when the visitor requests download links.
      const releasedPath = /\/r\/[a-f0-9]{8}\/$/.test(new URL(".", document.baseURI).pathname);
      const manifestUrl = new URL(releasedPath ? "../../entry.json" : "entry.json", document.baseURI);
      manifestUrl.searchParams.set("online", Date.now() + "-" + Math.random().toString(36).slice(2));
      const manifestResponse = await fetch(manifestUrl, {cache:"no-store", credentials:"omit", mode:"same-origin", redirect:"error", signal:controller.signal});
      if (!manifestResponse.ok) throw new Error("entry unavailable");
      const manifest = await manifestResponse.json();
      if (manifest.schemaVersion !== 1 || !/^\d{8}-[a-f0-9]{8}$/.test(manifest.releaseId) || manifest.path !== "r/" + manifest.releaseId.slice(-8) + "/") throw new Error("invalid entry");
      releaseRetired = manifest.releaseId !== releaseId;
      if (releaseRetired) throw new Error("retired entry");
      const url = new URL("site-config.js", document.baseURI);
      url.searchParams.set("online", Date.now() + "-" + Math.random().toString(36).slice(2));
      const response = await fetch(url, {cache:"no-store", credentials:"omit", mode:"same-origin", redirect:"error", signal:controller.signal});
      if (!response.ok) throw new Error("site unavailable");
      let source = (await response.text()).replace(/^\uFEFF/, "").trim();
      if (source.startsWith('{') && JSON.parse(source).xiyouEncrypted === 1) {
        if (!window.XIYOU_ACCESS_CONTEXT) throw new Error("password required");
        source = (await window.XIYOU_ACCESS_CONTEXT.decryptConfig(source)).trim();
      }
      while (source.startsWith("/*")) {
        const end = source.indexOf("*/");
        if (end < 0) throw new Error("invalid configuration");
        source = source.slice(end + 2).trim();
      }
      if (!/^window\.XIYOU_CONFIG\s*=/.test(source)) throw new Error("invalid configuration");
      source = source.replace(/^window\.XIYOU_CONFIG\s*=\s*/, "").replace(/;\s*$/, "");
      const data = JSON.parse(source);
      if (XiyouConfig.validate(data).length || generation !== offlineEpoch || signal?.aborted || navigator.onLine === false) throw new Error("unverified configuration");
      return XiyouConfig.normalize(data);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function refreshDownloads() {
    if (navigator.onLine === false) { clearDownloads("unavailable"); return false; }
    if (localPreview) return true;
    clearDownloads("checking");
    const epoch = downloadEpoch;
    const controller = new AbortController();
    downloadController = controller;
    try {
      const fresh = await fetchOnlineConfig(controller.signal);
      if (epoch !== downloadEpoch) return false;
      const versions = new Map(fresh.versions.filter(v => v.enabled).map(v => [v.id, v]));
      for (const v of config.versions) v.downloads = versions.get(v.id)?.downloads || [];
      window.XIYOU_CONFIG = structuredClone(config);
      downloadStatus = "ready";
      document.documentElement.dataset.downloadState = "ready";
      if (dialog.open && dialogMode === "downloads") renderDialog();
      return true;
    } catch {
      if (epoch === downloadEpoch) clearDownloads("unavailable");
      return false;
    } finally {
      if (downloadController === controller) downloadController = null;
    }
  }
  clearDownloads("unavailable");
  function nudgeCount(versionId) {
    return nudges.snapshot().counts[versionId] ?? 0;
  }
  function paintNudges() {
    const state = nudges.snapshot();
    document.querySelectorAll("[data-nudge-total]").forEach(el => { el.textContent = String(state.counts[el.dataset.nudgeTotal] ?? 0); });
    const button = content.querySelector("[data-update-request]");
    if (!button || dialogMode !== "downloads" || !activeVersion) return;
    button.querySelector(".nudge-label").textContent = "催更";
    button.querySelector(".nudge-count").textContent = String(state.counts[activeVersion.id] ?? 0);
    button.disabled = false;
    button.setAttribute("aria-label", `${activeVersion.name}：催更 ${state.counts[activeVersion.id] ?? 0}`);
  }
  function render() {
    document.title = config.site.title;
    document.querySelectorAll("[data-site-name]").forEach(el => { el.textContent = config.site.name; });
    document.querySelectorAll("[data-site-subtitle]").forEach(el => { el.textContent = config.site.subtitle; });
    document.querySelector("#hero-title").innerHTML = config.site.heroTitleLines.map((line, i) => `<span class="${i ? "gold-text" : ""}">${escape(line)}${i === 1 ? '<span class="title-dot">。</span>' : ""}</span>`).join("");
    document.querySelector("[data-hero-description]").textContent = config.site.heroDescription;
    const all = config.versions.filter(v => v.enabled);
    document.querySelectorAll("[data-version-count]").forEach(el => { el.textContent = all.length; });
    const visible = all;
    const featured = visible.find(v => v.id === config.site.featuredId);
    grid.innerHTML = visible.map(v => {
      const owner = role(v);
      const isFeatured = v === featured;
      const index = all.indexOf(v) + 1;
      const art = illustratedVersions.has(v.id)
        ? `<img class="version-cover" src="assets/version-${escape(v.id)}.svg?v=20261013-brush" alt="" width="720" height="300" loading="${index <= 3 ? "eager" : "lazy"}" decoding="async">`
        : `<span class="art-ring"></span><svg class="motif-icon"><use href="#icon-${v.motif}"></use></svg><span class="art-character">${escape(v.name.replace(/版$/, "").slice(0,2))}</span><span class="art-cloud cloud-one"></span><span class="art-cloud cloud-two"></span><span class="art-corner">${String(index).padStart(2,"0")}</span>`;
      return `<article class="version-card accent-${v.accent}${isFeatured ? " featured-card" : ""}" data-version="${escape(v.id)}">
        <div class="card-art motif-${v.motif}" aria-hidden="true">${art}</div>
        <div class="card-body"><div class="card-meta"><span class="card-index">卷 ${String(index).padStart(2,"0")}</span><span class="card-nudge" title="催更">催更 <b data-nudge-total="${escape(v.id)}">${nudgeCount(v.id)}</b></span><span class="card-free">免费下载</span></div>
          <h3><button type="button" data-action="download" data-id="${escape(v.id)}">${escape(v.name)}<span class="sr-only">：查看下载入口</span></button>${isFeatured ? '<span class="featured-label">精选藏卷</span>' : ""}</h3>
          <p class="card-description">${escape(v.summary)}</p>
          <div class="card-actions"><button class="button button-ink" type="button" data-action="download" data-id="${escape(v.id)}">查看下载 ${icon("arrow")}</button>${owner.support ? `<button class="support-button" type="button" data-action="support" data-id="${escape(v.id)}">${icon(owner.icon)} ${owner.support}</button>` : '<span class="card-open-note">免费下载</span>'}</div>
        </div></article>`;
    }).join("");
    document.querySelector("#empty-state").hidden = visible.length !== 0;
  }
  function donationFor(version) { return version.donation || config.donation; }
  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }
  function renderDialog() {
    clearTimeout(toastTimer);
    document.querySelector("#toast").classList.remove("is-visible");
    if (dialogMode === "community") {renderCommunity();return;}
    const v = activeVersion;
    const owner = role(v);
    const donate = donationFor(v);
    if (dialogMode === "downloads") {
      content.innerHTML = `<p class="eyebrow eyebrow-ink">取卷 · DOWNLOAD</p><h2 id="dialog-title">${escape(v.name)}</h2><p class="dialog-intro">${escape(v.summary)}</p>
        ${v.editions.length ? `<ul class="edition-list" aria-label="当前安装包">${v.editions.map(edition => `<li><strong>${escape(edition.name)}</strong><span>${escape(edition.type)}</span></li>`).join("")}</ul>` : ""}
        <div class="voluntary-note">${icon(owner.icon || "check")}<div><p>${escape(owner.message)}</p></div></div>
        <div class="download-list">${downloadStatus === "ready" ? v.downloads.map((link,i) => `<div class="download-row"><div class="download-label">${icon("folder")}<strong>${escape(link.label)}</strong></div>${link.code ? `<button type="button" class="copy-code" data-code-index="${i}" aria-label="复制${escape(link.label)}提取码 ${escape(link.code)}"><span>提取码 <b>${escape(link.code)}</b></span>${icon("copy")}</button>` : '<span class="no-code">无需提取码</span>'}<a class="button button-ink download-link" data-download-index="${i}" href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">打开${escape(link.label)} ${icon("external")}</a></div>`).join("") || '<p class="unconfigured">此版本暂未配置有效下载入口，请稍后再来。</p>' : `<div class="unconfigured" role="status"><p>${downloadStatus === "checking" ? "正在连接网站，请稍候…" : "当前无法连接网站。请联网后重试。"}</p>${downloadStatus === "checking" ? "" : '<button class="button button-outline" type="button" data-download-retry>重新连接</button>'}</div>`}</div>
        <p class="download-hint">选择下载渠道，获取本分类的正式包或存档版。</p>
        <div class="dialog-bottom"><span>愿你此行，满载欢喜。</span><div class="dialog-actions">${owner.support ? `<button class="support-button" type="button" data-dialog-action="support">${icon(owner.icon)} ${owner.support}</button>` : ""}<button class="nudge-button" type="button" data-update-request>${icon("bell")}<span class="nudge-label">催更</span><b class="nudge-count" aria-live="polite" aria-atomic="true">${nudgeCount(v.id)}</b></button></div></div>`;
      paintNudges();
    } else {
      content.innerHTML = `<p class="eyebrow eyebrow-ink">心意 · THANK YOU</p><h2 id="dialog-title">${escape(owner.support || "自愿赞赏")}</h2><p class="dialog-intro">${escape(v.name)} · ${escape(owner.message)}</p>
        ${donate.wechatImage ? `<div class="qr-panel"><img class="donation-image" src="${escape(donate.wechatImage)}" alt="${escape(owner.support)}的微信赞赏码原图"><p>微信赞赏码 · 请使用微信识别</p></div>` : ""}
        ${donate.afdianUrl ? `<a class="button button-ink afdian-link" href="${escape(donate.afdianUrl)}" target="_blank" rel="noopener noreferrer">前往爱发电 ${icon("external")}</a>` : ""}
        ${!donate.wechatImage && !donate.afdianUrl ? `<div class="unconfigured donation-empty">${icon(owner.icon || "heart")}<strong>赞赏入口尚未设置</strong><p>赞赏方式稍后补充。<br>你可以继续查看下载入口。</p></div>` : ""}
        <p class="donation-note">${escape(donate.note)}</p><p class="hosting-note">赞赏支持网站维护与后续更新。若长期缺少赞赏支持，后续维护可能难以持续，网站入口也可能失效。</p><button class="button button-outline return-download" type="button" data-dialog-action="downloads">查看免费下载入口 ${icon("arrow")}</button>`;
      const img = content.querySelector(".donation-image");
      if (img) img.addEventListener("error", () => {
        img.closest(".qr-panel").innerHTML = '<p class="unconfigured">赞赏码暂时无法加载，请稍后再试。<br>下载不受影响。</p>';
      }, {once:true});
    }
  }
  function openDialog(version, mode, opener) {
    activeVersion = version;
    dialogMode = mode;
    returnFocus = opener;
    if (mode === "downloads" && !localPreview) clearDownloads("checking");
    renderDialog();
    if (typeof dialog.showModal !== "function") {
      showToast("请更新浏览器后查看下载入口。");
      return;
    }
    dialog.showModal();
    document.body.classList.add("dialog-open");
    dialog.querySelector(".dialog-close").focus();
    if (mode === "downloads") void refreshDownloads();
    if (mode === "downloads") void nudges.refresh();
  }
  function groupUrl(group) {
    return group.joinUrl || "mqqapi://card/show_pslcard?src_type=internal&version=1&uin=" + encodeURIComponent(group.number) + "&card_type=group&source=qrcode";
  }
  function renderCommunity() {
    content.innerHTML = `<p class="eyebrow eyebrow-ink">同行 · COMMUNITY</p><h2 id="dialog-title">西游交流群</h2><p class="dialog-intro">同行有伴，西行不孤。选择一个群，聊版本，也聊西游。</p>
      <div class="group-switch-row"><span>点击群入口：<b>${groupAction === "copy" ? "复制群号" : "打开 QQ"}</b></span><label class="group-switch"><input type="checkbox" id="group-copy-switch" role="switch" aria-label="切换为复制群号"${groupAction === "copy" ? " checked" : ""}>复制模式</label></div>
      <div class="group-list">${config.community.groups.map((group,i) => `<div class="group-row"><div><strong>${escape(group.name)}</strong><p>${escape(group.number)}</p></div>${groupAction === "copy" ? `<button class="button button-ink group-action" type="button" data-group-copy="${i}" aria-label="复制${escape(group.name)}群号">复制群号 ${icon("copy")}</button>` : `<a class="button button-ink group-action" href="${escape(groupUrl(group))}" data-group-open="${i}"${group.joinUrl ? ' target="_blank" rel="noopener noreferrer"' : ""} aria-label="打开QQ：${escape(group.name)}">打开 QQ ${icon("external")}</a>`}<button class="icon-button group-copy" type="button" data-group-copy="${i}" aria-label="单独复制${escape(group.name)}群号" title="复制群号">${icon("copy")}</button></div>`).join("")}</div><p class="group-footer-note">${escape(config.community.note)}<br>直接跳转需要已安装 QQ 且浏览器允许唤起。若未打开，可切换复制模式，或点击每行的复制图标，在 QQ 中搜索群号。</p><p id="group-status" class="group-status" role="status" hidden></p>`;
  }
  document.querySelectorAll("[data-open-community]").forEach(button => button.addEventListener("click",()=> {
    dialogMode = "community";returnFocus = button;renderDialog();
    dialog.showModal();document.body.classList.add("dialog-open");dialog.querySelector(".dialog-close").focus();
  }));
  content.addEventListener("change",event=> {
    if (event.target.id !== "group-copy-switch") return;
    groupAction = event.target.checked ? "copy" : "open";
    renderCommunity();content.querySelector("#group-copy-switch").focus();
  });
  async function copyText(value,successMessage,button) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const temp = document.createElement("textarea");temp.value=value;temp.style.cssText="position:fixed;opacity:0;pointer-events:none";
        content.appendChild(temp);temp.select();const copied=document.execCommand("copy");temp.remove();button?.focus();if (!copied) throw new Error("copy failed");
      }
      showToast(successMessage + value);
    } catch {showToast("请手动复制：" + value);}
  }
  grid.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const version = config.versions.find(v => v.enabled && v.id === button.dataset.id);
    if (version) openDialog(version, button.dataset.action === "support" ? "support" : "downloads", button);
  });
  content.addEventListener("click", async event => {
    if (event.target.closest("[data-download-retry]")) { void refreshDownloads(); return; }
    const downloadLink = event.target.closest("[data-download-index]");
    if (downloadLink) {
      if (navigator.onLine === false || downloadStatus !== "ready" || !activeVersion) {
        event.preventDefault();
        if (navigator.onLine === false) offlineEpoch++;
        clearDownloads("unavailable");
      }
      // The address was verified when this download dialog opened. Let the
      // browser follow the real HTTPS anchor within the original click gesture.
      return;
    }
    const nudgeButton = event.target.closest("[data-update-request]");
    if (nudgeButton && dialogMode === "downloads" && activeVersion) {
      nudges.vote(activeVersion.id);
      return;
    }
    const groupCopy = event.target.closest("[data-group-copy]");
    if (groupCopy) {
      const group = config.community.groups[Number(groupCopy.dataset.groupCopy)];
      if (group) await copyText(group.number,"群号已复制：",groupCopy);
      return;
    }
    if (event.target.closest("[data-group-open]")) {
      const status = content.querySelector("#group-status");status.hidden=false;
      status.textContent="已尝试唤起 QQ。若未打开，请切换复制模式，在 QQ 中搜索群号。";
      return;
    }
    const codeButton = event.target.closest("[data-code-index]");
    if (codeButton) {
      const id = activeVersion?.id, index = Number(codeButton.dataset.codeIndex);
      if (!await refreshDownloads() || activeVersion?.id !== id || dialogMode !== "downloads") return;
      const code = activeVersion.downloads[index]?.code;
      if (!code) return;
      await copyText(code,"提取码已复制：",content.querySelector(`[data-code-index="${index}"]`));
    }
    const button = event.target.closest("[data-dialog-action]");
    if (button) {
      dialogMode = button.dataset.dialogAction === "support" ? "support" : "downloads";
      if (dialogMode === "downloads" && !localPreview) clearDownloads("checking");
      renderDialog();
      dialog.querySelector(".dialog-close").focus();
      dialog.scrollTop = 0;
      if (dialogMode === "downloads") void refreshDownloads();
    }
  });
  content.addEventListener("auxclick", event => {
    if (event.target.closest("[data-download-index]") && (navigator.onLine === false || downloadStatus !== "ready")) {
      event.preventDefault();
      clearDownloads("unavailable");
    }
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  let pointerStartedOutside = false;
  dialog.addEventListener("pointerdown", event => { pointerStartedOutside = event.target === dialog; });
  dialog.addEventListener("click", event => { if (event.target === dialog && pointerStartedOutside) dialog.close(); });
  dialog.addEventListener("close", () => {document.body.classList.remove("dialog-open"); if (returnFocus?.isConnected) returnFocus.focus();});
  // Local editor preview only. Nothing is saved to a server or accepted from unrelated windows.
  window.addEventListener("message", event => {
    if (window.parent === window || event.source !== window.parent) return;
    if (event.origin !== window.location.origin && !(location.protocol === "file:" && event.origin === "null")) return;
    if (event.data?.type !== "xiyou-config-preview" || XiyouConfig.validate(event.data.config).length) return;
    if (!["127.0.0.1", "localhost"].includes(location.hostname) && location.protocol !== "file:") return;
    localPreview = true;
    downloadEpoch++;
    downloadController?.abort();
    downloadStatus = "ready";
    document.documentElement.dataset.downloadState = "ready";
    if (dialog.open) dialog.close();
    config = XiyouConfig.normalize(event.data.config);
    groupAction = config.community.defaultAction;
    window.XIYOU_CONFIG = config;
    render();
    if (navigator.onLine === false) clearDownloads("unavailable");
  });
  render();
  nudges.subscribe(paintNudges);
  void nudges.refresh();
  window.addEventListener("offline", () => { offlineEpoch++; clearDownloads("unavailable"); });
  window.addEventListener("pagehide", () => { offlineEpoch++; clearDownloads("unavailable"); });
  window.addEventListener("pageshow", event => { if (event.persisted) clearDownloads("unavailable"); });
  if (window.parent === window) window.requestAnimationFrame(() => {
    const destination = ["#top", "#versions", "#guide"].includes(location.hash) ? location.hash : "#versions";
    document.querySelector(destination)?.scrollIntoView({behavior:"instant", block:"start"});
  });
})();
