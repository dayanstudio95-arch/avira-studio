// The galleries live under two menus: "גלריות" (photo galleries, /photos) and "סרטים" (film galleries, /films).
// A gallery's own page follows its kind; old /films/<id> links to a photo gallery are redirected by the form.

export const galleryKindOfPath = (pathname = "") => (pathname === "/photos" || pathname.startsWith("/photos/") ? "photos" : "films");

export const galleryHome = (kind) => (kind === "photos" ? "/photos" : "/films");

export const galleryPath = (g) => `${galleryHome(g?.kind)}/${g.id}`;
