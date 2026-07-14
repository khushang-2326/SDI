import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "outputs/**",
      "public/uploads/**",
      "public/screenshots/**",
      "next-env.d.ts"
    ]
  }
];

export default config;
