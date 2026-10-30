import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loading } from './lib/Loading';
import { WatchPage } from './watch/WatchPage';

// Public pages only. Studios manage galleries inside the StudioOS hub.
// Each area loads only when it's opened: a couple opening their gallery doesn't download the studio page.
const StudioPage = lazy(() => import('./studio/StudioPage').then((m) => ({ default: m.StudioPage })));
const AlbumPage = lazy(() => import('./album/AlbumPage').then((m) => ({ default: m.AlbumPage })));
const PrintPage = lazy(() => import('./print/PrintPage').then((m) => ({ default: m.PrintPage })));
const StudioPrint = lazy(() => import('./print/StudioPrint').then((m) => ({ default: m.StudioPrint })));
// Face search: the guest's selfie page, and the studio's scan (both load the face models on their own).
const GuestPage = lazy(() => import('./faces/GuestPage').then((m) => ({ default: m.GuestPage })));
const StudioFaces = lazy(() => import('./faces/StudioFaces').then((m) => ({ default: m.StudioFaces })));
const Accessibility = lazy(() => import('./Accessibility').then((m) => ({ default: m.Accessibility })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/watch/:id" element={<WatchPage />} />
          <Route path="/watch/:id/album" element={<AlbumPage />} />
          <Route path="/accessibility" element={<Accessibility />} />
          {/* The print shop's private link. */}
          <Route path="/print/:token" element={<PrintPage />} />
          <Route path="/watch/:id/print" element={<StudioPrint />} />
          <Route path="/watch/:id/me" element={<GuestPage />} />
          <Route path="/watch/:id/faces" element={<StudioFaces />} />
          {/* The couple's link: /<studio>/<gallery id>. The studio part must match the gallery's studio. */}
          <Route path="/:studio/:id" element={<WatchPage />} />
          <Route path="/:studio/:id/album" element={<AlbumPage />} />
          <Route path="/:studio/:id/print" element={<StudioPrint />} />
          <Route path="/:studio/:id/me" element={<GuestPage />} />
          <Route path="/:studio/:id/faces" element={<StudioFaces />} />
          {/* The studio's page for new couples. */}
          <Route path="/:studio" element={<StudioPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="screen screen-center">
      <div className="card center">
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>הדף לא נמצא</h1>
        <p className="muted">בדקו את הקישור שקיבלתם מהסטודיו.</p>
      </div>
    </div>
  );
}
