export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "veriqall-theme";

// Browser chrome color per theme (palette.paper and palette.night).
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#fafafc", dark: "#10122a" };

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

// Sets data-theme and the browser chrome color on <html>.
export function applyResolvedTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

// Runs inline in <head> before first paint so the page never flashes the wrong theme.
// Kept as a dependency-free string that mirrors resolveTheme/applyResolvedTheme.
// Storage is read in its own try/catch so a blocked localStorage still follows the system.
export const themeInitScript = `(function(){var p=null;try{p=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(p!=="light"&&p!=="dark")p="system";try{var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch(e){}})()`;
