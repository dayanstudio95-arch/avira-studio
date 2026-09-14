import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import { CONTACT_TYPE_LABELS, CONTACT_TYPE_COLORS } from "./whatsappInboxShared";

// The contact-type tag on a conversation — and, since 2026-09-15, the way to change it
// by hand. The owner asked: "שאם אני ילחץ עליו זה יפתח אותו לרשימה ואני יוכל להחליט
// ידני אם הוא צוות או לקוח קיים".
//
// Why this matters more than a label: contact_type is the bot's first gate. "unknown"
// is the only type the bot ever answers, so tagging a colleague as צוות silences the
// bot for them permanently, and tagging a mis-filed couple back to לא מוכר lets it
// help them. A manual choice is stamped with contact_type_manual_at and the webhook
// stops re-classifying that conversation (migration 0062) — otherwise the next inbound
// message from a number that matches an old lead row would quietly undo the click.
//
// Groups are not offered: a chat id ending in @g.us is a group whatever anyone says.

const CHOICES = ["unknown", "lead", "client", "staff"];

export default function ContactTypeBadge({ conversation, onChange, className = "" }) {
  const type = conversation?.contactType || "unknown";
  const colour = CONTACT_TYPE_COLORS[type] || CONTACT_TYPE_COLORS.unknown;
  const label = CONTACT_TYPE_LABELS[type] || type;

  if (!onChange || type === "group") {
    return (
      <Badge variant="outline" className={`text-[10px] ${colour} ${className}`}>
        {label}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // The row around this badge is itself clickable (selects the conversation);
          // opening the menu must not also select the row.
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] ${colour} ${className}`}
          title={conversation?.contactTypeManualAt ? "סומן ידנית — לחץ לשינוי" : "לחץ לשינוי ידני"}
        >
          {label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-gray-900 border-gray-700 text-white" dir="rtl">
        <DropdownMenuLabel className="text-xs text-gray-400">מי זה?</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-800" />
        {CHOICES.map((value) => (
          <DropdownMenuItem
            key={value}
            onClick={(e) => {
              e.stopPropagation();
              if (value !== type) onChange(value);
            }}
            className="flex items-center justify-between gap-3 text-sm focus:bg-gray-800"
          >
            <span>{CONTACT_TYPE_LABELS[value]}</span>
            {value === type && <Check className="h-3.5 w-3.5 text-yellow-400" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-gray-800" />
        <p className="px-2 py-1 text-[11px] text-gray-500">
          הבוט עונה רק ל"לא מוכר". שינוי ידני נשמר ולא נדרס.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
