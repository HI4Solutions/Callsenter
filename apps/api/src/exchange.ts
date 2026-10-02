// USD to NOK from Norges Bank's open API (daily rates, published on bank days around 16:00).
// Used to show what usage costs in kroner (docs/plan.md, section 16, Forbruk).
import type pg from "pg";

const URL_USD_NOK = "https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=sdmx-json&lastNObservations=1";

interface SdmxJson {
  data?: {
    dataSets?: { series?: Record<string, { observations?: Record<string, [string | number]> }> }[];
    structure?: { dimensions?: { observation?: { values?: { id?: string }[] }[] } };
  };
}

export async function fetchUsdNok(fetcher: typeof fetch = fetch): Promise<{ day: string; rate: number }> {
  const res = await fetcher(URL_USD_NOK, { headers: { accept: "application/vnd.sdmx.data+json" } });
  if (!res.ok) throw new Error(`Norges Bank ${res.status}`);
  const body = (await res.json()) as SdmxJson;
  const series = Object.values(body.data?.dataSets?.[0]?.series ?? {})[0];
  const observations = Object.entries(series?.observations ?? {});
  const last = observations.at(-1);
  const days = body.data?.structure?.dimensions?.observation?.[0]?.values ?? [];
  const day = last ? days[Number(last[0])]?.id : undefined;
  const rate = last ? Number(last[1][0]) : NaN;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !(rate > 0)) throw new Error("Norges Bank: unexpected answer");
  return { day, rate };
}

// Stores the latest rate (idempotent). Returns it.
export async function updateUsdNok(db: pg.Pool | pg.PoolClient, fetcher: typeof fetch = fetch) {
  const { day, rate } = await fetchUsdNok(fetcher);
  await db.query(
    `insert into exchange_rates (day, usd_nok) values ($1, $2)
     on conflict (day) do update set usd_nok = excluded.usd_nok, fetched_at = now()`,
    [day, rate],
  );
  return { day, rate };
}
