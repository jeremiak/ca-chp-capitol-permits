// deno-lint-ignore-file no-explicit-any

import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import dayjs from "npm:dayjs@1";
import Queue from "npm:p-queue@7";
import _ from "npm:lodash@4.17";

interface Permit {
  status: string;
  number: string;
  url: string;
  eventSponsor: string;
  locationOnCapitolGrounds: string;
  startDateTime: string;
  setUpDateTime: string | undefined;
  endDateTime: string | undefined;
  participants: number | undefined;
  details: string | undefined;
}

const browser = await puppeteer.launch();

async function scrapePermitsForRange(
  dateBegin: string,
  dateEnd: string | undefined,
): Promise<Permit[]> {
  console.log(
    `Scraping permits for ${dateBegin} ${dateEnd ? "through " + dateEnd : ""}`,
  );
  let url =
    `https://capitolpermits.chp.ca.gov/Event/GetCalendarEvents/?dateBegin=${dateBegin}`;
  if (dateEnd) url += `&dateEnd=${dateEnd}`;
  const page = await browser.newPage();
  await page.goto(url);

  const permits: Permit[] = await page.$$eval("#eventlist a", (nodes) => {
    const permits: Permit[] = [];
    nodes.forEach((node) => {
      const href = node.getAttribute("href");
      const style = node.getAttribute("style");
      const status = style.includes("Green") ? "approved" : "pending";
      const text = node.textContent;
      const [number, startDateTime, eventSponsor, locationOnCapitolGrounds] =
        text.split(" - ");

      const permit = {
        status,
        number,
        url: `https://capitolpermits.chp.ca.gov${href}`,
        eventSponsor,
        locationOnCapitolGrounds,
        startDateTime,
        setUpDateTime: undefined,
        endDateTime: undefined,
        participants: undefined,
        details: undefined,
      };
      permits.push(permit);
    });
    return permits;
  });

  await page.close();
  const queue = new Queue({ concurrency: 2 });

  permits.forEach((permit) => {
    queue.add(async () => {
      const page = await browser.newPage();
      await page.goto(permit.url);
      const p = await page.$$eval(".display-field", (nodes) => {
        const p = {
          setUpDateTime: nodes[3].textContent.trim(),
          endDateTime: nodes[5].textContent.trim(),
          participants: +nodes[6].textContent.trim().replaceAll(",", ""),
          details: nodes[7].textContent.trim(),
        };
        return p;
      });
      await page.close();
      Object.assign(permit, p);
    });
  });

  await queue.onIdle();

  console.log(
    `Found ${permits.length} permits`,
  );

  return permits;
}

const today = dayjs();
const twoMonths = today.add(2, "months");
const dateStart = today.format("YYYY-MM-DD");
const dateEnd = twoMonths.format("YYYY-MM-DD");

const scraped: Permit[] = await scrapePermitsForRange(dateStart, dateEnd);
const existingFile = await Deno.readTextFile("./permits.json");
const existing: Permit[] = JSON.parse(existingFile);

await browser.close()

scraped.forEach((d) => {
  const alreadyExists = existing.find((dd) => dd.number === d.number);
  if (alreadyExists) {
    Object.assign(alreadyExists, d);
  } else {
    existing.push(d);
  }
});

const sorted = _.orderBy(existing, ["number"]);
console.log(`Saving to a file`);
await Deno.writeTextFile("./permits.json", JSON.stringify(sorted, null, 2));
console.log(`All done`);
