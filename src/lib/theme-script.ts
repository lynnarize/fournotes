// Shared by the server layout (inline script) and the client theme helpers.
// Kept free of "use client" so the layout can import plain strings from it.

export const THEME_KEY = "four-notes:theme";
export const THEME_COLORS = { light: "#ffffff", dark: "#191919" } as const;

/** Runs before first paint so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){var r=document.documentElement;var p="system";try{p=localStorage.getItem("${THEME_KEY}")||"system"}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);r.dataset.theme=d?"dark":"light";r.dataset.themePref=p;})();`;
