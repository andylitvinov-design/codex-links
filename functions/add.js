import { insertLink } from "./_lib/links.js";
import { text } from "./_lib/http.js";
import { isAuthorized } from "./_lib/security.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isAuthorized(request, env)) {
    return text("Unauthorized.", { status: 401 });
  }

  const created = await insertLink(env, {
    url: url.searchParams.get("url"),
    title: url.searchParams.get("title"),
    note: url.searchParams.get("note"),
    threads: url.searchParams.get("threads"),
    threadLabel: url.searchParams.get("threadLabel"),
    tags: url.searchParams.get("tags"),
    source: url.searchParams.get("source") || "codex"
  });

  if (!created.ok) {
    return text(created.error, { status: 400 });
  }

  const redirectUrl = new URL("/", request.url);
  redirectUrl.searchParams.set("added", "1");

  return Response.redirect(redirectUrl.toString(), 302);
}
