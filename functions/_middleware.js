// Temporary, reversible Codex Links ONLY maintenance boundary.
// Cloudflare Pages root middleware intercepts Functions and static assets.
// Never read/write KV; never invoke a downstream Function in standby.
const MAINTENANCE_HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"color-scheme\" content=\"light dark\">\n<title>Codex Links — временно приостановлен</title>\n<style>\n:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color-scheme:light dark}\n*{box-sizing:border-box}\nbody{min-height:100vh;display:grid;place-items:center;margin:0;padding:24px;background:#f3f7f6;color:#1d3432}\nmain{width:min(100%,540px);padding:34px;border:1px solid #dbe7e4;border-radius:18px;background:#fff;box-shadow:0 10px 35px rgba(12,64,58,.05)}\n.eyebrow{color:#0e7b6d;font-weight:700;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase}\nh1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.2;margin:12px 0 18px}\np{line-height:1.65;margin:12px 0;color:#3d5753}\nhr{border:0;border-top:1px solid #e3ece9;margin:23px 0}\nsmall{color:#687e79;line-height:1.55;display:block}\n@media(prefers-color-scheme:dark){body{background:#121b1a;color:#ebf1ef}main{background:#1b2826;border-color:#344845}p{color:#c4d3ce}hr{border-color:#344845}small{color:#9eb4ad}.eyebrow{color:#75cfbc}}\n</style>\n</head>\n<body>\n<main role=\"main\">\n<div class=\"eyebrow\">Codex Links</div>\n<h1>Сервис временно приостановлен</h1>\n<p>Сайт и обработка новых команд поставлены на паузу для защиты от превышения лимитов Cloudflare.</p>\n<p>История сообщений и данные не удалены. Работа возобновится после отдельного решения владельца.</p>\n<hr>\n<small>Temporarily paused. Command submission and synchronization are unavailable; stored data has not been deleted.</small>\n</main>\n</body>\n</html>";

const COMMON_HEADERS = {
  "cache-control": "no-store, no-cache, max-age=0, must-revalidate",
  "retry-after": "3600",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff"
};

export function onRequest(context) {
  const { request } = context;
  const { pathname } = new URL(request.url);

  // This marker is static and has no KV read. Retain it for release proof.
  if (pathname === "/version.json" && (request.method === "GET" || request.method === "HEAD")) {
    return context.next();
  }

  const isApi = pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/add" || pathname.startsWith("/add/");
  if (isApi || (request.method !== "GET" && request.method !== "HEAD")) {
    return new Response(JSON.stringify({
      error: "service_paused",
      message: "Codex Links is temporarily paused by its owner.",
      temporary: true
    }), {
      status: 503,
      headers: {
        ...COMMON_HEADERS,
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type, X-Write-Token"
      }
    });
  }

  return new Response(request.method === "HEAD" ? null : MAINTENANCE_HTML, {
    status: 503,
    headers: { ...COMMON_HEADERS, "content-type": "text/html; charset=utf-8" }
  });
}
