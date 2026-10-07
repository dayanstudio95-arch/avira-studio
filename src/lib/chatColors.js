// Colours of the conversation tags (2026-10-07, approved by the owner in the mock-up).
//   מי זה (contact type) — a filled chip.
//   שלב (stage)          — an outlined chip with a dot, in the same colours as the CRM's
//                          status badges on the Leads page (Leads.jsx statusConfig).
// The chat screen is always dark, so these are dark-background classes. Full literal
// strings (not built from parts) so Tailwind's scanner keeps them.

export const TYPE_COLORS = {
  unknown: "bg-amber-500/20 text-amber-200",
  lead: "bg-blue-500/20 text-blue-200",
  bot_lead: "bg-blue-500/20 text-blue-200",
  client: "bg-green-500/20 text-green-200",
  past_client: "bg-teal-500/20 text-teal-200",
  staff: "bg-purple-500/20 text-purple-200",
  vendor: "bg-orange-500/20 text-orange-200",
  group: "bg-gray-600/40 text-gray-300",
  irrelevant: "bg-gray-700/50 text-gray-400 line-through",
};

export const STAGE_COLORS = {
  "חדש": { chip: "border-blue-500/70 text-blue-300", dot: "bg-blue-400" },
  "נשלחה הצעה": { chip: "border-pink-500/70 text-pink-300", dot: "bg-pink-400" },
  "פולו-אפ": { chip: "border-orange-500/70 text-orange-300", dot: "bg-orange-400" },
  "נסגר/חתימה": { chip: "border-green-500/70 text-green-300", dot: "bg-green-400" },
  "חוזה": { chip: "border-yellow-500/70 text-yellow-300", dot: "bg-yellow-400" },
  "לא רלוונטי": { chip: "border-gray-600 text-gray-400", dot: "bg-gray-500" },
};

export function typeColor(type) {
  return TYPE_COLORS[type || "unknown"] || TYPE_COLORS.unknown;
}

export function stageColor(stage) {
  return STAGE_COLORS[stage] || { chip: "border-gray-700 text-gray-300", dot: "bg-gray-500" };
}
