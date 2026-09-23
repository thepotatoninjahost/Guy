/* workshop tool (never shipped): measure the room/slab geometry on a
   360×780 phone viewport against a live URL. Usage:
     node tools/measure.mjs [url]  */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const url = process.argv[2] || "http://localhost:8000/#/console";

const browser = await puppeteer.launch({
  executablePath: "/tmp/chromium",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--force-device-scale-factor=1",
  ],
  headless: true,
  dumpio: false,
  env: {
    LD_LIBRARY_PATH: "/tmp/spart/lib",
    FONTCONFIG_PATH: "/tmp/spart/fonts",
    FONTCONFIG_FILE: "/tmp/spart/fonts/fonts.conf",
  },
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.type("#input", "The quick brown fox jumps over the lazy dog");
  await new Promise((r) => setTimeout(r, 600));

  const m = await page.evaluate(() => {
    const rect = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), h: +r.height.toFixed(1) };
    };
    return {
      vh: innerHeight,
      input: rect("#input"),
      bench: rect(".bench"),
      holdbar: rect("[data-holdbar]"),
      slab: rect(".slab"),
      slabLabel: rect(".slab__label"),
      slabDoors: rect(".slab__doors"),
      feed: rect("#feed"),
      crest: rect(".crest"),
      room: rect(".room"),
      slabVar: getComputedStyle(document.documentElement).getPropertyValue("--slab-h").trim(),
      docScrollW: document.documentElement.scrollWidth,
    };
  });

  const covered = m.input ? +(m.slab.top - m.input.bottom).toFixed(1) : null;
  const benchCovered = m.bench ? +(m.slab.top - m.bench.bottom).toFixed(1) : null;
  console.log(JSON.stringify(m, null, 1));
  console.log("GAP input→slab:", covered, covered !== null && covered < 0 ? "⚠ INPUT IS UNDER THE MENU" : "ok");
  console.log("GAP bench→slab:", benchCovered, benchCovered !== null && benchCovered < 0 ? "⚠ COMPOSER STRIPPED COVERED" : "ok");
  console.log("horizontal overflow:", m.docScrollW > 360 ? "⚠ " + m.docScrollW + "px" : "none");

  const file = process.env.SHOT ? "/tmp/room-" + (process.env.TAG || "now") + ".png" : null;
  if (file) await page.screenshot({ path: file });
} finally {
  await browser.close();
}
