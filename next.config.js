/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "www.bom.gov.au",
      },
      {
        protocol: "https",
        hostname: "clearoutside.com",
      },
    ],
  },
};

module.exports = nextConfig;
