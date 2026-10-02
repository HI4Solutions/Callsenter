// Brand palette from docs/plan.md, section 6 (Norwegian brand names in comments).
// The same values live as CSS variables in globals.css; tokens.test.ts keeps them in sync.
export const palette = {
  stamp: "#3326C9", // Stempel: brand color, light mode
  stampLight: "#A39BFF", // Stempel lys: brand color, dark mode
  ink: "#15172E", // Skrift: text, light mode
  paper: "#FAFAFC", // Papir: background, light mode
  night: "#10122A", // Natt: background, dark mode
  mist: "#ECECF6", // Tåke: text, dark mode
  approved: "#1E9E5A", // Godkjent: green AI flag only
  deviation: "#E0A100", // Avvik: yellow AI flag only
  violation: "#D7382F", // Brudd: red AI flag only
} as const;

// Surfaces not named in the plan, derived so they meet the contrast requirements.
export const derived = {
  light: { surface: "#FFFFFF", border: "#DCDCEC", muted: "#555873" },
  dark: { surface: "#181B3A", border: "#2C2F58", muted: "#A9ABC9" },
} as const;
