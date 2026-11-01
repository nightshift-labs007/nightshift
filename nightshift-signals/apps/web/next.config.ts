import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const config: NextConfig = {
  transpilePackages: ["@nightshift-signals/core"],
  typedRoutes: false,
};

export default createNextIntlPlugin("./i18n/request.ts")(config);
