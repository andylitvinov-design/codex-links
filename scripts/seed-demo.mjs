const baseUrl = process.env.LINKS_BASE_URL || "http://127.0.0.1:8788";
const token = process.env.LINKS_WRITE_TOKEN;

if (!token) {
  console.error("Set LINKS_WRITE_TOKEN before running seed.");
  process.exit(1);
}

const examples = [
  {
    url: "https://example.com/landing-a.html",
    title: "Landing A",
    note: "Первая демо-ссылка для проверки доски.",
    tags: ["demo", "landing"],
    source: "codex"
  },
  {
    url: "https://example.com/report-b.html",
    title: "Report B",
    note: "Проверка карточки без лишнего контента.",
    tags: ["demo", "report"],
    source: "manual"
  }
];

for (const item of examples) {
  const response = await fetch(`${baseUrl}/api/links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify(item)
  });

  const body = await response.text();
  console.log(response.status, body);
}
