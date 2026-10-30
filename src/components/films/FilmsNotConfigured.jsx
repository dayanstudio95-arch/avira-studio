import { Clapperboard } from "lucide-react";

// Shown when the hub was built without VITE_FILMS_BASE_URL (local dev, or before
// the films Worker is deployed).
export default function FilmsNotConfigured() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8" dir="rtl">
      <div className="text-center max-w-md">
        <Clapperboard className="w-10 h-10 text-brand-400 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white mb-2">הגלריות עדיין לא מחוברות</h2>
        <p className="text-gray-400 text-sm">הגלריות לזוגות יופעלו אחרי שכתובת שרת הגלריות תוגדר במערכת.</p>
      </div>
    </div>
  );
}
