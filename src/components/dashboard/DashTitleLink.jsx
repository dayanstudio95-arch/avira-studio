import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// A dashboard card's title is the way to its page (2026-10-09, the owner's rule): rows open
// their window in place; only the title goes to the full page. The small ‹ says so.
export default function DashTitleLink({ to, children }) {
  return (
    <Link to={to} title="מעבר לדף" className="group inline-flex items-center gap-2 rounded-md transition-colors hover:text-amber-200">
      {children}
      <ChevronLeft className="h-4 w-4 text-slate-500 opacity-70 transition-opacity group-hover:text-amber-300 group-hover:opacity-100" />
    </Link>
  );
}
