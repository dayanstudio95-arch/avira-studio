import React, { createContext, useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Pin, Check, BellOff, X, Flame, CalendarDays, CalendarCheck, CalendarX2, Megaphone, Tag } from "lucide-react";
import {
  contactTypeLabel, effectiveStage, waitingLabel, isLongWait, CONTACT_TYPES, STAGES,
  rowEventDate, formatDateWithWeekday, dateStatus, hasStage, displayType,
} from "@/lib/chatModel";
import { typeColor, stageColor } from "@/lib/chatColors";
import { fetchDateAvailability } from "@/lib/dateAvailability";
import { displayPhone } from "@/components/whatsapp/whatsappInboxShared";
import { isManuallyFlagged } from "@/lib/followUpQueue";

const AVATAR_COLORS = ["#3E63DD", "#C2410C", "#7C3AED", "#0E7490", "#B45309", "#15803D", "#BE185D", "#475569"];
function avatarColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name) {
  const s = String(name || "").trim();
  if (!s || /^[\d+\-\s()]+$/.test(s)) return "?";
  const parts = s.split(/\s+ו?|\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}
// Signed URLs of profile pictures, fetched once for the whole list (ChatApp.jsx).
export const AvatarUrlContext = createContext({});

export function Avatar({ conversation, size = 44 }) {
  const name = conversation?.coupleNames || conversation?.displayName || conversation?.phone;
  const urls = useContext(AvatarUrlContext);
  const url = conversation?.avatarPath ? urls[conversation.avatarPath] : null;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="shrink-0 rounded-full bg-gray-800 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: avatarColor(conversation?.id || name), fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function conversationTitle(c) {
  return c?.coupleNames || c?.displayName || c?.phone || String(c?.chatId || "").split("@")[0] || "שיחה";
}

function timeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "אתמול";
  const days = Math.floor((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString("he-IL", { weekday: "long" });
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });
}

// "יום שישי, 14.8.2026 · פנוי" under a row (2026-10-07) — the in-thread date check,
// visible without opening the conversation.
function RowDate({ date, map, loading, ownLeadId }) {
  if (!date) {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
        <CalendarDays className="h-3.5 w-3.5" /> תאריך עוד לא ידוע
      </span>
    );
  }
  const st = dateStatus(map, date, ownLeadId);
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
      <CalendarDays className="h-3.5 w-3.5 text-gray-500" />
      <span>{formatDateWithWeekday(date)}</span>
      {loading ? (
        <span className="text-gray-500">בודק…</span>
      ) : st.events > 0 ? (
        <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 text-amber-200">
          <CalendarX2 className="h-3 w-3" /> כבר ביומן: {st.events} {st.events === 1 ? "אירוע" : "אירועים"}
        </span>
      ) : (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 text-emerald-200">
          <CalendarCheck className="h-3 w-3" /> פנוי
        </span>
      )}
      {!loading && st.closing > 0 && <span className="text-gray-500">· {st.closing} בתהליך סגירה</span>}
    </span>
  );
}

// The list column: search, selection mode, rows, and the bulk-action bar.
export default function ChatList({
  title, conversations, activeId, onOpen, unread, labelsById, labelsByConv, leadsById,
  search, setSearch, searchHits, selectMode, setSelectMode, selected, setSelected,
  labels, onBulk, mobileChips, compact, topBar,
}) {
  const [menu, setMenu] = useState(null); // 'type' | 'stage' | 'label' | null
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const bulk = async (kind, value) => {
    setMenu(null);
    await onBulk(kind, value, selectedIds);
  };

  // The event date of every row (2026-10-07) and, in one request, whether each is free.
  const rowDates = useMemo(() => {
    const out = {};
    for (const c of conversations) {
      if (!hasStage(c)) continue;
      const lead = c.matchedLeadId ? leadsById[c.matchedLeadId] : null;
      out[c.id] = rowEventDate(c, lead);
    }
    return out;
  }, [conversations, leadsById]);
  const dateKey = useMemo(() => Array.from(new Set(Object.values(rowDates).filter(Boolean))).sort(), [rowDates]);
  const availQ = useQuery({
    queryKey: ["chatRowDates", dateKey.join(",")],
    queryFn: () => fetchDateAvailability(dateKey),
    enabled: dateKey.length > 0,
    staleTime: 60000,
  });

  return (
    <section aria-label="רשימת שיחות" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-900/40">
      <div className="space-y-2.5 border-b border-gray-800 px-3.5 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className={`font-bold text-white ${compact ? "text-2xl" : "text-lg"}`}>{title}</h1>
          <button
            type="button"
            onClick={() => { setSelectMode(!selectMode); setSelected({}); setMenu(null); }}
            className={`min-h-[36px] rounded-full px-4 text-sm ${selectMode ? "bg-yellow-400 font-semibold text-gray-900" : "bg-gray-800 text-yellow-400"}`}
          >
            {selectMode ? "סיום" : "בחר"}
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/70 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בשמות, במספרים ובתוך ההודעות"
            aria-label="חיפוש"
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-gray-500 md:text-sm"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="נקה חיפוש" className="text-gray-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        {mobileChips}
      </div>
      {topBar}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {conversations.map((c) => {
          const on = c.id === activeId;
          const checked = !!selected[c.id];
          const n = unread[c.id] || 0;
          const lead = c.matchedLeadId ? leadsById[c.matchedLeadId] : null;
          const stage = effectiveStage(c, lead);
          const wait = waitingLabel(c);
          const long = isLongWait(c);
          const hit = searchHits?.[c.id];
          const convLabels = (labelsByConv[c.id] || []).map((id) => labelsById[id]).filter(Boolean);
          const preview = hit ? hit : c.lastMessagePreview || "";
          return (
            <div
              key={c.id}
              className={`flex items-start gap-2.5 border-b border-gray-800/70 px-3.5 py-3 ${on ? "bg-gray-800/80" : checked ? "bg-yellow-500/10" : "hover:bg-gray-800/40"}`}
            >
              {selectMode && (
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-pressed={checked}
                  aria-label={`סמן את ${conversationTitle(c)}`}
                  className={`mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${checked ? "bg-yellow-400 text-gray-900" : "border-2 border-gray-600"}`}
                >
                  {checked && <Check className="h-4 w-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpen(c)}
                className="flex min-w-0 flex-1 gap-3 text-start"
              >
                <Avatar conversation={c} size={compact ? 50 : 44} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    {c.pinnedAt && <Pin className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-label="נעוץ" />}
                    <span className="truncate font-semibold text-white">{conversationTitle(c)}</span>
                    {c.leadTemperature === "hot" && <Flame className="h-4 w-4 shrink-0 text-orange-400" aria-label="ליד חם" />}
                    <span className={`ms-auto shrink-0 text-xs ${n ? "font-semibold text-yellow-400" : "text-gray-500"}`}>{timeLabel(c.lastMessageAt)}</span>
                  </span>
                  {displayPhone(c) && displayPhone(c) !== conversationTitle(c) && (
                    <span dir="ltr" className="text-end text-xs text-gray-500">{displayPhone(c)}</span>
                  )}
                  {c.leadTemperature === "hot" && c.leadTemperatureReason && (
                    <span className="truncate text-xs text-red-300">חם: {c.leadTemperatureReason}</span>
                  )}
                  <span className="flex items-center gap-1.5">
                    {c.optedOutAt && <BellOff className="h-3.5 w-3.5 shrink-0 text-red-400" aria-label="ביקש/ה הסרה" />}
                    <span className={`min-w-0 flex-1 truncate text-sm ${hit ? "text-yellow-200" : "text-gray-400"}`}>{preview}</span>
                    {n > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-400 px-1.5 text-[11px] font-bold text-gray-900">{n}</span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <span className={`rounded-full px-2 text-[11px] ${typeColor(displayType(c))}`}>{contactTypeLabel(displayType(c))}</span>
                    {stage && (
                      <span className={`flex items-center gap-1 rounded-full border px-2 text-[11px] ${stageColor(stage).chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${stageColor(stage).dot}`} />
                        {stage}
                      </span>
                    )}
                    {c.source === "facebook_ad" && (
                      <span title={c.sourceAdTitle || undefined} className="flex items-center gap-1 rounded-full bg-violet-500/20 px-2 text-[11px] text-violet-200">
                        <Megaphone className="h-3 w-3" /> מודעה
                      </span>
                    )}
                    {isManuallyFlagged(c) && (
                      <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2 text-[11px] text-orange-200">
                        <Tag className="h-3 w-3" /> בפולו-אפ
                      </span>
                    )}
                    {convLabels.map((l) => (
                      <span key={l.id} className="rounded-md px-1.5 text-[11px] text-white" style={{ background: l.color }}>{l.name}</span>
                    ))}
                    {wait && (
                      <span className={`rounded-md px-1.5 text-[11px] ${long ? "bg-red-500/20 text-red-300" : "bg-gray-800 text-gray-300"}`}>{wait}</span>
                    )}
                  </span>
                  {hasStage(c) && <RowDate date={rowDates[c.id]} map={availQ.data} loading={availQ.isLoading} ownLeadId={c.matchedLeadId} />}
                </span>
              </button>
            </div>
          );
        })}
        {conversations.length === 0 && <p className="px-4 py-10 text-center text-sm text-gray-500">אין שיחות כאן</p>}
      </div>

      {selectMode && selectedIds.length > 0 && (
        <div className="relative border-t border-gray-700 bg-gray-900 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-white">{selectedIds.length} נבחרו</span>
            <button
              type="button"
              onClick={() => setSelected(Object.fromEntries(conversations.map((c) => [c.id, true])))}
              className="text-sm text-yellow-400"
            >
              בחר את כל {conversations.length}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5 md:flex md:flex-wrap">
            {[
              ["type", "מי זה…"],
              ["stage", "שלב…"],
              ["label", "תווית…"],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMenu(menu === k ? null : k)}
                aria-expanded={menu === k}
                className={`min-h-[40px] rounded-lg border px-3 text-sm ${menu === k ? "border-yellow-500 bg-yellow-500/10 text-yellow-300" : "border-gray-700 bg-gray-800 text-gray-200"}`}
              >
                {l}
              </button>
            ))}
            <button type="button" onClick={() => bulk("archive", true)} className="min-h-[40px] rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200">ארכיון</button>
            <button type="button" onClick={() => bulk("handled", true)} className="min-h-[40px] rounded-lg border border-emerald-800 bg-emerald-950/50 px-3 text-sm text-emerald-200">✓ טופל</button>
            <button type="button" onClick={() => bulk("pin", true)} className="min-h-[40px] rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200">נעץ</button>
            <button
              type="button"
              disabled
              title="שליחה לכמה אנשים מגיעה בשלב הבא, עם הגבלות הבטיחות שסיכמנו"
              className="min-h-[40px] cursor-not-allowed rounded-lg border border-gray-800 px-3 text-sm text-gray-600"
            >
              שליחה (בקרוב)
            </button>
          </div>
          {menu && (
            <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-gray-700 bg-gray-950 p-2">
              {menu === "type" &&
                CONTACT_TYPES.filter((t) => !t.fixed).map((t) => (
                  <button key={t.key} type="button" onClick={() => bulk("type", t.key)} className="min-h-[36px] rounded-full border border-gray-700 px-3 text-sm text-gray-200 hover:border-yellow-500">
                    {t.label}
                  </button>
                ))}
              {menu === "stage" &&
                STAGES.map((s) => (
                  <button key={s} type="button" onClick={() => bulk("stage", s)} className="min-h-[36px] rounded-full border border-gray-700 px-3 text-sm text-gray-200 hover:border-yellow-500">
                    {s}
                  </button>
                ))}
              {menu === "label" &&
                labels.map((l) => (
                  <button key={l.id} type="button" onClick={() => bulk("label", l.id)} className="min-h-[36px] rounded-full px-3 text-sm text-white" style={{ background: l.color }}>
                    + {l.name}
                  </button>
                ))}
              {menu === "label" && labels.length === 0 && <span className="text-sm text-gray-500">אין עדיין תוויות</span>}
              {menu === "stage" && (
                <p className="w-full text-xs text-gray-500">בשיחה עם ליד מקושר — השלב משתנה גם בדף הלידים. בלי ליד — רק בשיחה.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

