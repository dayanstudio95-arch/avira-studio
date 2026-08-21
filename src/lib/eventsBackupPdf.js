// Manual "safety net" export: a downloadable PDF listing every upcoming event
// (date, couple, venue, phone, and the full assigned team) so the studio owner
// always has an offline-readable snapshot on their own device, independent of
// whether the live system is reachable.
//
// This is the on-demand half of the events-backup feature — see
// supabase/functions/weekly-events-backup/index.ts for the automatic weekly
// WhatsApp half (sent as text, not a PDF, since no proven Hebrew-capable PDF
// library exists for the Deno Edge Function runtime — no DOM there to
// rasterize with html2canvas the way this file does).
//
// Reuses the exact same "render real Hebrew DOM off-screen, rasterize with
// html2canvas, slice into A4 pages with jsPDF" pattern already proven in
// src/pages/ContractPage.jsx's generateSignedPdf — jsPDF's built-in fonts have
// no Hebrew glyphs at all, so native doc.text() calls would produce mojibake;
// capturing real browser-rendered text as an image sidesteps that entirely.
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const MAX_EVENTS = 400; // safety cap so an extreme event count never freezes the browser

const ROLE_LABELS = {
  photographer1: "צלם 1",
  photographer2: "צלם 2",
  videographer: "וידאוגרף",
  videographer2: "וידאוגרף 2",
  editor: "עורך/ת",
};

const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function formatEventDate(dateStr) {
  if (!dateStr) return "ללא תאריך";
  try {
    return new Date(dateStr).toLocaleDateString("he-IL");
  } catch {
    return dateStr;
  }
}

function teamSummary(team) {
  if (!Array.isArray(team) || team.length === 0) return "לא שובץ צוות";
  const names = team
    .filter((m) => m && m.staffMemberName)
    .map((m) => `${ROLE_LABELS[m.role] || m.role || "תפקיד"}: ${m.staffMemberName}`);
  return names.length > 0 ? names.join(" | ") : "לא שובץ צוות";
}

export async function downloadEventsBackupPdf(events, studioName = "Avira Studio") {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = (events || [])
    .filter((e) => e.date && new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, MAX_EVENTS);

  const container = document.createElement("div");
  container.setAttribute("dir", "rtl");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-99999px";
  container.style.width = "780px";
  container.style.background = "#ffffff";
  container.style.fontFamily = "Arial, 'Noto Sans Hebrew', sans-serif";
  container.style.color = "#1f2937";

  const rowsHtml = upcoming.length === 0
    ? `<div style="padding:24px; text-align:center; color:#6b7280;">אין אירועים עתידיים במערכת</div>`
    : upcoming.map((e) => `
      <div style="border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:14px;">${escapeHtml(e.coupleNames || "ללא שם")}</strong>
          <span style="font-size:13px; color:#111827; background:#fde68a; border-radius:6px; padding:2px 8px;">${escapeHtml(formatEventDate(e.date))}</span>
        </div>
        <div style="font-size:12px; color:#4b5563; display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">
          <div>📍 ${escapeHtml(e.venue || "—")}</div>
          <div>📱 ${escapeHtml(e.phoneNumber || "—")}</div>
        </div>
        <div style="font-size:12px; color:#374151; margin-top:6px; border-top:1px dashed #e5e7eb; padding-top:6px;">
          👥 ${escapeHtml(teamSummary(e.team))}
        </div>
      </div>
    `).join("");

  container.innerHTML = `
    <div style="background:#1e1e1e; padding:20px; text-align:center;">
      <div style="color:#ffd700; font-size:22px; font-weight:bold; letter-spacing:2px;">${escapeHtml(studioName.toUpperCase())}</div>
      <div style="color:#c8c8c8; font-size:12px; margin-top:4px;">רשימת גיבוי לאירועים עתידיים — עדכני ל-${escapeHtml(formatEventDate(today.toISOString()))} (${upcoming.length} אירועים)</div>
    </div>
    <div style="padding:20px;">
      ${rowsHtml}
    </div>
  `;

  document.body.appendChild(container);
  try {
    const canvas = await Promise.race([
      html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("יצירת קובץ הגיבוי נתקעה (חריגת זמן) — נסה שוב")),
        20000
      )),
    ]);

    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageWidth = 210;
    const pageHeight = 297;
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");

    let heightLeft = imgHeight;
    let position = 0;
    doc.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      doc.addPage();
      doc.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    doc.save(`רשימת_גיבוי_אירועים_${new Date().toISOString().split("T")[0]}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
