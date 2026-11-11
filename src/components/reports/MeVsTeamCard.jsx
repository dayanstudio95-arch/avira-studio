import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, Users, UsersRound, CalendarDays, Table2 } from "lucide-react";
import { splitMeTeam, meStaffName, meVsTeamByMonth } from "@/lib/meVsTeam";

// "אני מול הצוות" (2026-11-11, approved from a mockup): the period's events split by whether the owner worked them —
// same lines as "סיכום פיננסי", one column each, and a bar with his part of the net profit. See src/lib/meVsTeam.js.
// dir="rtl" on both cards: the Reports tabs (Radix) render their content left to right; the mockup was right to left.
const money = (n) =>
  `₪${(Math.round((n || 0) * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const whole = (n) => `₪${Math.round(n || 0).toLocaleString("he-IL")}`;

function Line({ label, hint, value, cls = "text-white" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2">
      <span className="text-sm text-slate-300">
        {label}
        {hint && <span className="mr-1 text-xs text-slate-500">{hint}</span>}
      </span>
      <span className={`font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function Column({ icon: Icon, iconCls, title, sub, sum, costHint, testId }) {
  const positive = sum.profit >= 0;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="mb-1">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Icon className={`h-5 w-5 ${iconCls}`} /> {title}
        </div>
        <div className="text-xs text-slate-400">{sub}</div>
      </div>
      <Line label="אירועים" value={sum.count} />
      <Line label="הכנסה ברוטו" value={money(sum.gross)} cls="text-amber-300" />
      <Line label="− מע״מ" value={money(sum.vat)} cls="text-sky-400" />
      <Line label="− הוצאות צוות" hint={costHint} value={money(sum.cost)} cls="text-rose-400" />
      <div
        className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${positive ? "border-[#22C987]/70 bg-gradient-to-l from-[#22C987]/[0.04] to-[#22C987]/[0.16]" : "border-[#F05B70]/70 bg-[#F05B70]/10"}`}
      >
        <span className="font-bold text-white">= רווח נקי</span>
        <span className={`text-lg font-bold tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`} data-testid={`${testId}-profit`}>
          {money(sum.profit)}
        </span>
      </div>
      {sum.count > 0 && <Line label={<span className="text-xs text-slate-400">רווח ממוצע לאירוע</span>} value={whole(sum.profit / sum.count)} />}
    </div>
  );
}

export default function MeVsTeamCard({ events, staffMembers = [], periodLabel, isLoading }) {
  if (isLoading) return null;
  const meName = meStaffName(staffMembers);
  const { me, team, meShare } = splitMeTeam(events);

  return (
    <Card dir="rtl" className="dash-card" data-testid="me-vs-team">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <UsersRound className="h-6 w-6 text-amber-400" /> אני מול הצוות
          </CardTitle>
          {periodLabel && (
            <span className="flex items-center gap-1.5 text-sm text-sky-300">
              <CalendarDays className="h-4 w-4" /> {periodLabel}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!meName && !me.count ? (
          <p className="text-sm text-slate-400">
            כדי לראות את החלוקה צריך ברשימת הצוות איש צוות שהשם שלו מתחיל ב"אני", למשל "אני (דניאל)", ולשבץ אותו באירועים שעבדת בהם.
          </p>
        ) : !events.length ? (
          <p className="text-sm text-slate-400">אין אירועים בתקופה הזו.</p>
        ) : (
          <>
            {meShare != null && (
              <div>
                <div className="mb-1.5 text-xs text-slate-400">מתוך הרווח הנקי של התקופה ({money(me.profit + team.profit)})</div>
                <div className="flex h-6 overflow-hidden rounded-lg text-xs font-bold" data-testid="me-share">
                  {meShare > 0 && (
                    <div className="flex items-center whitespace-nowrap bg-amber-400 px-2 text-gray-900" style={{ width: `${meShare}%` }}>
                      {meShare >= 12 ? `אני ${meShare}%` : `${meShare}%`}
                    </div>
                  )}
                  {meShare < 100 && (
                    <div className="flex items-center whitespace-nowrap bg-sky-500 px-2 text-gray-900" style={{ width: `${100 - meShare}%` }}>
                      {100 - meShare >= 12 ? `הצוות ${100 - meShare}%` : `${100 - meShare}%`}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Column icon={Camera} iconCls="text-amber-400" title={meName || "אני"} sub="אירועים שעבדתי בהם" sum={me} costHint="(שאר הצוות + עורך)" testId="me-col" />
              <Column icon={Users} iconCls="text-sky-400" title="הצוות" sub="אירועים בלעדיי" sum={team} testId="team-col" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// The annual tab's month-by-month table; a month opens in the monthly report (onPickMonth).
export function MeVsTeamByMonth({ events, year, staffMembers = [], isLoading, onPickMonth }) {
  if (isLoading) return null;
  const rows = meVsTeamByMonth(events, year);
  const total = rows.reduce(
    (t, r) => ({ meN: t.meN + r.me.count, meP: t.meP + r.me.profit, teamN: t.teamN + r.team.count, teamP: t.teamP + r.team.profit }),
    { meN: 0, meP: 0, teamN: 0, teamP: 0 },
  );
  const meName = meStaffName(staffMembers) || "אני";
  const cell = (n, p) => (n ? whole(p) : "—");
  return (
    <Card dir="rtl" className="dash-card" data-testid="me-vs-team-months">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Table2 className="h-6 w-6 text-amber-400" /> אני מול הצוות, לפי חודש
          </CardTitle>
          <span className="flex items-center gap-1.5 text-sm text-sky-300">
            <CalendarDays className="h-4 w-4" /> {year}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums sm:text-sm">
          <thead>
            <tr className="text-xs text-slate-400">
              <th rowSpan={2} className="px-1.5 sm:px-2 py-1.5 text-right font-medium">חודש</th>
              <th colSpan={2} className="px-1.5 sm:px-2 py-1.5 text-right font-semibold text-amber-300">{meName}</th>
              <th colSpan={2} className="px-1.5 sm:px-2 py-1.5 text-right font-semibold text-sky-300">הצוות</th>
            </tr>
            <tr className="border-b border-white/[0.08] text-xs text-slate-400">
              <th className="px-1.5 sm:px-2 py-1.5 text-right font-medium">אירועים</th>
              <th className="px-1.5 sm:px-2 py-1.5 text-right font-medium">רווח נקי</th>
              <th className="px-1.5 sm:px-2 py-1.5 text-right font-medium">אירועים</th>
              <th className="px-1.5 sm:px-2 py-1.5 text-right font-medium">רווח נקי</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.month}
                onClick={() => onPickMonth?.(r.month)}
                className="cursor-pointer border-b border-white/[0.05] text-slate-200 hover:bg-white/[0.04]"
                data-testid="me-vs-team-month"
              >
                <td className="px-1.5 sm:px-2 py-2 text-white">{MONTHS[r.month]}</td>
                <td className="px-1.5 sm:px-2 py-2">{r.me.count}</td>
                <td className={`px-1.5 sm:px-2 py-2 ${r.me.profit < 0 ? "text-rose-400" : ""}`}>{cell(r.me.count, r.me.profit)}</td>
                <td className="px-1.5 sm:px-2 py-2">{r.team.count}</td>
                <td className={`px-1.5 sm:px-2 py-2 ${r.team.profit < 0 ? "text-rose-400" : ""}`}>{cell(r.team.count, r.team.profit)}</td>
              </tr>
            ))}
            <tr className="font-bold text-white">
              <td className="px-1.5 sm:px-1.5 sm:px-2 py-2.5">סה״כ</td>
              <td className="px-1.5 sm:px-1.5 sm:px-2 py-2.5">{total.meN}</td>
              <td className={`px-1.5 sm:px-1.5 sm:px-2 py-2.5 ${total.meP < 0 ? "text-rose-400" : "text-emerald-400"}`}>{whole(total.meP)}</td>
              <td className="px-1.5 sm:px-1.5 sm:px-2 py-2.5">{total.teamN}</td>
              <td className={`px-1.5 sm:px-1.5 sm:px-2 py-2.5 ${total.teamP < 0 ? "text-rose-400" : "text-emerald-400"}`}>{whole(total.teamP)}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">לחיצה על חודש פותחת אותו בדוח החודשי.</p>
      </CardContent>
    </Card>
  );
}
