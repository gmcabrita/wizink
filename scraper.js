const cheerio = require("cheerio");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const urls = [
  "https://www.wizink.pt/mail/landing/aderir-cartao-de-credito-flash.html",
  "https://www.wizink.pt/mail/landing/aderir-cartao-de-credito-flash-extra.html",
  "https://www.wizink.pt/mail/landing/aderir-cartao-de-credito-flash-especial.html",
  "https://www.wizink.pt/mail/landing/aderir-cartao-de-credito-wizink-flex-flash.html",
  "https://www.wizink.pt/public/campanha-especial",
];

const months = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

async function scrape(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (/não temos nenhuma campanha especial, de momento/i.test(text)) return null;

  const $ = cheerio.load(text);

  const offer = $(".offer__name").text().replace(/\s+/g, " ").trim();
  const timeInterval = $(".conditions__text > ul > li:first").text().replace(/\s+/g, " ").trim();

  const multiDayMatch = timeInterval.match(/(\d+) a (\d+) de ([^\d]+) de (\d{4})/);
  const singleDayMatch = timeInterval.match(/(\d+) de ([^\d]+) de (\d{4})/);

  let start, end;
  if (multiDayMatch) {
    const year = multiDayMatch[4];
    const month = (months.findIndex((m) => m == multiDayMatch[3].toLowerCase()) + 1).toString();
    const startDay = multiDayMatch[1];
    const endDay = multiDayMatch[2];
    start = `${year}-${month.padStart(2, "0")}-${startDay.padStart(2, "0")}`;
    end = `${year}-${month.padStart(2, "0")}-${endDay.padStart(2, "0")}`;
  } else if (singleDayMatch) {
    const year = singleDayMatch[3];
    const month = (months.findIndex((m) => m == singleDayMatch[2].toLowerCase()) + 1).toString();
    const day = singleDayMatch[1];
    start = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    end = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  } else {
    throw "Failed to parse time interval!";
  }

  return { start, end, url, offer };
}

function generateHtml(db) {
  const now = new Date();
  const rows = db
    .map((entry) => {
      const expired = new Date(`${entry.end}T23:59:59Z`) < now;

      return `
      <tr style="background-color: ${expired ? "#FFE2E2" : "#DFF5E1"}">
        <td>${entry.offer}</td>
        <td>${entry.start}</td>
        <td>${entry.end}</td>
        <td><a href="${entry.url}" target="_blank">Link</a></td>
      </tr>
      `;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="rss.xml" rel="alternate" title="Ofertas Wizink" type="application/rss+xml">
  <title>Wizink Offers</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>Ofertas Wizink <a href="rss.xml">[RSS]</a></h1>
  <table>
    <thead>
      <tr>
        <th>Oferta</th>
        <th>Data de inicio</th>
        <th>Data de fim</th>
        <th>URL</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;

  return html;
}

function generateRss(db) {
  const now = new Date();
  const items = db
    .map((entry) => {
      const expired = new Date(`${entry.end}T23:59:59Z`) < now;
      if (expired) return;

      return `
      <item>
        <title><![CDATA[${entry.offer}]]></title>
        <link>${entry.url}</link>
        <description>De ${entry.start} a ${entry.end}</description>
        <pubDate>${new Date(entry.start).toUTCString()}</pubDate>
        <guid>${crypto.createHash("sha256").update(`${entry.url}#${entry.start}`, "utf8").digest("hex")}</guid>
      </item>
      `;
    })
    .filter(Boolean)
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ofertas Wizink</title>
    <link>https://wizink.pt</link>
    <description>Ofertas Wizink</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return rss;
}

async function main() {
  const dbPath = path.join(__dirname, "db.json");
  const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));

  const entries = await Promise.all(urls.map((url) => scrape(url)));

  for (const newEntry of entries) {
    if (!newEntry) continue;

    const exists = db.some(
      (entry) =>
        entry.start === newEntry.start && entry.end === newEntry.end && entry.url === newEntry.url,
    );

    if (exists) continue;

    db.push({ start: newEntry.start, end: newEntry.end, url: newEntry.url, offer: newEntry.offer });
  }

  db.sort((a, b) => new Date(b.start) - new Date(a.start));

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  fs.writeFileSync(path.join(__dirname, "index.html"), generateHtml(db));
  fs.writeFileSync(path.join(__dirname, "rss.xml"), generateRss(db));
  console.log("Generated index.html and rss.xml");
}

main();
