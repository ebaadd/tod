import type { NextConfig } from "next";

// Every page in this app is a client component that fetches from the API in
// the browser, so there is nothing for a server to render. Exporting static
// files means the site is served from S3 and CloudFront with no Node process
// running and nothing to pay for while it sits idle.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true
};

export default config;
