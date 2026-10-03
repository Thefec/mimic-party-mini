// Production backend, used only when the HTML file is opened from disk (file://).
// Replace after the first `npm run deploy` (see README).
export const PRODUCTION_SERVER = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";

export function resolveServer(location = window.location) {
  const override = new URLSearchParams(location.search).get("server");
  const served = location.protocol === "http:" || location.protocol === "https:";
  const http = (override || (served ? location.origin : PRODUCTION_SERVER)).replace(/\/+$/, "");
  return { http, ws: http.replace(/^http/, "ws") };
}
