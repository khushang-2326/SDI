/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd()
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false
      },
      {
        source: "/analysis",
        destination: "/analytics",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
