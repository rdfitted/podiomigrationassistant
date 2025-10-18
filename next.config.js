/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable instrumentation for server-side initialization
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
