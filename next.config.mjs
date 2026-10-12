/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // snarkjs spawns worker threads; load it straight from node_modules instead of bundling it.
  serverExternalPackages: ["snarkjs"],
  // Lets a verification build run beside `next dev` without sharing .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
