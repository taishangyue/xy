/* Shared, dependency-free configuration validation. No eval, fetch or external library. */
(function (root) {
  "use strict";
  const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
  const isHttps = value => {
    if (typeof value !== "string" || !value.startsWith("https://")) return false;
    try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password; } catch { return false; }
  };
  const isImage = value => {
    if (!value) return false;
    return isHttps(value) || /^(?:assets\/)[\w\u3400-\u9fff .\/-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value) && !value.includes("..");
  };
  function donation(value) {
    const source = value && typeof value === "object" ? value : {};
    return {wechatImage: isImage(source.wechatImage) ? source.wechatImage : "", afdianUrl: isHttps(source.afdianUrl) ? source.afdianUrl : "", note: text(source.note, "感谢支持网站维护、资源整理与后续更新。")};
  }
  function normalize(source) {
    const data = source && typeof source === "object" ? source : {};
    const site = data.site && typeof data.site === "object" ? data.site : {};
    const ids = new Set();
    const versions = (Array.isArray(data.versions) ? data.versions : []).filter(item => item && typeof item === "object").map((item, index) => {
      let id = /^[a-z0-9_-]+$/i.test(item.id) ? item.id : "version-" + (index + 1);
      while (ids.has(id)) id += "-copy";
      ids.add(id);
      return {
        id, name: text(item.name, "未命名版本"), summary: text(item.summary),
        ownership: ["self", "collected", "unknown"].includes(item.ownership) ? item.ownership : "unknown",
        author: text(item.author), enabled: item.enabled !== false,
        motif: ["mountain", "sun", "fan", "scroll", "lotus"].includes(item.motif) ? item.motif : "mountain",
        accent: ["jade", "cinnabar", "gold", "blue", "purple"].includes(item.accent) ? item.accent : "jade",
        downloads: (Array.isArray(item.downloads) ? item.downloads : []).filter(link => link && isHttps(link.url)).map(link => ({label: text(link.label, "下载入口"), url: link.url, code: text(link.code)})),
        donation: item.donation && typeof item.donation === "object" ? donation(item.donation) : null
      };
    });
    return {
      schemaVersion: 1,
      site: {name: text(site.name, "开心西游"), subtitle: text(site.subtitle, "西行藏卷 · 改版资源"), title: text(site.title, "开心西游 · 西行藏卷"), heroTitleLines: Array.isArray(site.heroTitleLines) ? site.heroTitleLines.slice(0,2).map(line => text(line)) : ["西行未尽", "故事再续"], heroDescription: text(site.heroDescription), featuredId: text(site.featuredId, "xiaoyao")},
      donation: donation(data.donation),
      nudges: {endpoint: isHttps(data.nudges?.endpoint) ? data.nudges.endpoint.replace(/\/$/, "") : ""},
      community: {
        defaultAction: data.community?.defaultAction === "copy" ? "copy" : "open",
        note: text(data.community?.note, "建议加入多个群聊，防止单群失联。"),
        groups: (Array.isArray(data.community?.groups) ? data.community.groups : []).filter(group => group && /^\d{5,12}$/.test(group.number)).map(group => ({name: text(group.name,"西游交流群"), number: group.number, joinUrl: isHttps(group.joinUrl) ? group.joinUrl : ""}))
      }, versions
    };
  }
  function validate(data) {
    const errors = [];
    if (!data || !Array.isArray(data.versions)) return ["配置缺少 versions 数组。"];
    const ids = new Set();
    if (!data.site?.name?.trim()) errors.push("请填写网站名称。");
    if (data.nudges?.endpoint && (!isHttps(data.nudges.endpoint) || !/^https:\/\/[^/?#]+\/api\/nudges\/?$/.test(data.nudges.endpoint))) errors.push("催更接口须为 HTTPS 地址并以 /api/nudges 结尾。");
    data.versions.forEach((item, index) => {
      const prefix = "第 " + (index + 1) + " 个版本：";
      if (!item.name?.trim()) errors.push(prefix + "请填写版本名称。");
      if (!/^[a-z0-9_-]+$/i.test(item.id) || ids.has(item.id)) errors.push(prefix + "ID 必须是唯一的英文、数字、短横线或下划线。");
      ids.add(item.id);
      if (!["self", "collected", "unknown"].includes(item.ownership)) errors.push(prefix + "版本归属无效。");
      if (item.enabled !== false && (!Array.isArray(item.downloads) || !item.downloads.length)) errors.push(prefix + "公开版本至少需要一个真实下载入口。");
      (item.downloads || []).forEach((link, n) => {
        if (!link.label?.trim()) errors.push(prefix + "入口 " + (n+1) + " 缺少按钮名称。");
        if (!isHttps(link.url)) errors.push(prefix + "入口 " + (n+1) + " 必须是完整 HTTPS 链接。");
        if (isHttps(link.url) && new URL(link.url).hostname === "pan.baidu.com") {
          const queryCode = new URL(link.url).searchParams.get("pwd");
          if (queryCode && queryCode !== link.code) errors.push(prefix + "百度链接中的 pwd 与提取码不一致。");
        }
      });
    });
    (data.community?.groups || []).forEach((group,index) => {
      if (!group.name?.trim() || !/^\d{5,12}$/.test(group.number)) errors.push("交流群 " + (index+1) + "：请填写群名称与正确的数字群号。");
      if (group.joinUrl && !isHttps(group.joinUrl)) errors.push("交流群 " + (index+1) + "：官方邀请链接须为完整 HTTPS 地址，未获取时留空即可。");
    });
    [data.donation, ...data.versions.map(item => item.donation)].filter(Boolean).forEach((item, index) => {
      if (item.wechatImage && !isImage(item.wechatImage)) errors.push("赞赏设置 " + (index+1) + "：图片须为 assets/ 下的原图路径，或完整 HTTPS 图片链接。");
      if (item.afdianUrl && !isHttps(item.afdianUrl)) errors.push("赞赏设置 " + (index+1) + "：爱发电须为完整 HTTPS 链接。");
    });
    return errors;
  }
  root.XiyouConfig = Object.freeze({normalize, validate, isHttps, isImage});
})(typeof window !== "undefined" ? window : globalThis);
