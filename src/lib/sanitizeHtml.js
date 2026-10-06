// PII-03 (audit 2026-10-05): contract text is shown as HTML — on the PUBLIC contract page
// (/contract/:leadId), inside the signed-PDF builder, and in the studio's own contract
// dialog. It comes from rich-text fields (leads.contract_terms, leads.package_details,
// the default template, package descriptions) and was rendered raw, so any <script>,
// onerror=…, javascript: link etc. stored there would run in the couple's browser or in a
// logged-in studio session. Everything now goes through DOMPurify first: formatting
// (paragraphs, bold, lists, alignment classes, colours, links) stays; anything that can run
// code is removed.
import DOMPurify from "dompurify";

const OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
  FORBID_ATTR: ["srcset"],
};

export function sanitizeContractHtml(html) {
  if (html === null || html === undefined || html === "") return "";
  return DOMPurify.sanitize(String(html), OPTIONS);
}

// For <img src="…"> built as a string (the signed-PDF template): only an image data URL or
// an https URL is allowed, and the value is attribute-escaped.
export function safeImageSrc(url) {
  if (typeof url !== "string") return "";
  const u = url.trim();
  if (!/^(data:image\/(png|jpe?g|gif|webp);base64,|https:\/\/)/i.test(u)) return "";
  return u.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
