import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#64748b",
        line: "#dbe3f0",
        canvas: "#f4f7fc",
        brand: "#4f46e5",
        accent: "#0d9488"
      },
      boxShadow: {
        soft: "0 18px 48px rgba(65, 71, 143, 0.10)",
        glow: "0 16px 40px rgba(79, 70, 229, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
