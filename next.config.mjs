/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // snarkjs spawns worker threads; load it straight from node_modules instead of bundling it.
  serverExternalPackages: ["snarkjs"],
  // Lets a verification build run beside `next dev` without sharing .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // the Hindi page and the India desk were retired
  async redirects() {
    return [
      { source: "/hi", destination: "/", permanent: true },
      { source: "/india", destination: "/", permanent: true },
      { source: "/transparency", destination: "/app", permanent: false },
    ];
  },
};

export default nextConfig;
