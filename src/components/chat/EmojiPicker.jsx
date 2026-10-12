import React, { useEffect, useRef, useState } from "react";

// Emojis in the chat composer on a computer (2026-10-13, the owner's request — a phone has
// its own emoji keyboard). No library: the ones a studio actually writes, in WhatsApp's
// groups, with the last used first (remembered on this computer).
const GROUPS = [
  { key: "smileys", icon: "😊", label: "פרצופים", list: "😊 😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕" },
  { key: "hands", icon: "👍", label: "ידיים", list: "👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🫶 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫡" },
  { key: "hearts", icon: "❤️", label: "לבבות", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 😻 💑 💏 👩‍❤️‍👨 👰 🤵 👰‍♀️ 🤵‍♂️ 💍 💒" },
  { key: "party", icon: "🎉", label: "חגיגה", list: "🎉 🎊 🥂 🍾 🎂 🍰 🧁 🎁 🎈 🪅 🎶 🎵 🎤 💃 🕺 🪩 ✨ 🌟 ⭐ 💫 🔥 🌹 💐 🌸 🌷 🌺 🌼 🌻 🕯️ 🎆 🎇" },
  { key: "studio", icon: "📸", label: "סטודיו", list: "📸 📷 🎥 📹 🎬 🎞️ 🖼️ 📒 📖 💻 📱 ☎️ 📞 💬 📩 📧 📅 🗓️ ⏰ ⏳ ⌛ 📍 🗺️ 🚗 🏛️ 🏰 💰 💸 💳 🧾 📝 ✅ ☑️ ✔️ ❌ ⚠️ ❗ ❓ 💯 🆗 🆕" },
];
const RECENT_KEY = "chat_recent_emojis";
const readRecent = () => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.slice(0, 24) : [];
  } catch {
    return [];
  }
};

export default function EmojiPicker({ onPick, onClose }) {
  const [recent, setRecent] = useState(readRecent);
  const [tab, setTab] = useState(() => (readRecent().length ? "recent" : "smileys"));
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target) && !e.target.closest?.("[data-emoji-toggle]")) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const pick = (e) => {
    onPick(e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const tabs = [...(recent.length ? [{ key: "recent", icon: "🕘", label: "אחרונים" }] : []), ...GROUPS];
  const list = tab === "recent" ? recent : (GROUPS.find((g) => g.key === tab)?.list || "").split(" ");

  return (
    <div ref={boxRef} role="dialog" aria-label="אימוג'ים" className="mb-2 rounded-2xl border border-gray-800 bg-gray-900 p-2 shadow-xl">
      <div className="mb-1.5 flex flex-wrap gap-1 border-b border-gray-800 pb-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.label}
            aria-label={t.label}
            onClick={() => setTab(t.key)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${tab === t.key ? "bg-gray-700" : "hover:bg-gray-800"}`}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-0.5 overflow-y-auto overflow-x-hidden">
        {list.filter(Boolean).map((e) => (
          <button key={e} type="button" onClick={() => pick(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-gray-800">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
