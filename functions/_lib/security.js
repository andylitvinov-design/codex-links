const encoder = new TextEncoder();

function toBytes(value) {
  return encoder.encode(value ?? "");
}

export function constantTimeEqual(left, right) {
  const a = toBytes(left);
  const b = toBytes(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return diff === 0;
}

export function getWriteToken(request) {
  const url = new URL(request.url);

  return (
    request.headers.get("x-write-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token") ||
    ""
  );
}

export function isAuthorized(request, env) {
  const expected = env.LINKS_WRITE_TOKEN || "";
  const provided = getWriteToken(request);

  if (!expected || !provided) {
    return false;
  }

  return constantTimeEqual(provided, expected);
}
