/**
 * Local product branding.
 *
 * Keep this separate from the upstream package/repository names so syncing a
 * newer agegr/pi-web release cannot silently change the user-facing brand.
 */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PI_ACCESS_PROFILE === "beta" ? "Pi Agent Access 测试版" as const : "Pi Agent Access" as const;

import desktopPackage from "../src-tauri/pi-agent-desktop-package.json";

/** Name and version of this packaged desktop distribution. */
export const APP_DISTRIBUTION_NAME = "pi-agent-access" as const;
export const APP_REPOSITORY = "zhangzheyuanviolin-ship-it/pi-agent-access" as const;
export const APP_REPOSITORY_URL = `https://github.com/${APP_REPOSITORY}` as const;
export const APP_RELEASES_URL = `${APP_REPOSITORY_URL}/releases` as const;
export const APP_VERSION = process.env.NEXT_PUBLIC_PI_ACCESS_PROFILE === "beta" ? "1.2.0-beta.1" : desktopPackage.version;
export const APP_VERSION_DISPLAY = APP_VERSION.endsWith(".0")
  ? APP_VERSION.slice(0, -2)
  : APP_VERSION;
