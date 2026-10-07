import React from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import MeetingsList from "@/components/meetings/MeetingsList";

// 📅 פגישות (2026-10-07) — the sales calls / zooms / meetings booked with leads, the same list
// as in the chat app. The reminders are pushed to the phone by the server (meeting-reminders).
export default function Meetings() {
  const navigate = useNavigate();
  return (
    <div dir="rtl" className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <CalendarClock className="h-7 w-7 text-yellow-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">פגישות</h1>
          <p className="text-sm text-gray-400">שיחות, זום ופגישות עם לידים · תזכורת לטלפון 10 דק׳ לפני (באפליקציית "אווירה צ'אט")</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
        <MeetingsList
          onOpenConversation={(id) => navigate(`/chat?c=${id}`)}
          onOpenLead={(id) => navigate(`/Leads?openLeadId=${id}`)}
        />
      </div>
    </div>
  );
}
