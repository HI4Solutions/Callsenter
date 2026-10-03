import { getTranslations } from "next-intl/server";
import { Card } from "@/components/admin/card";
import { EconomyNav } from "@/components/billing/economy-nav";

// Stripe: card subscriptions, prices and MRR from Stripe. Waits for the account and keys
// (docs/plan.md, section 16).
export default async function StripePage() {
  const t = await getTranslations("economy");
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("stripe.intro")}</p>
      </div>
      <EconomyNav />
      <Card title={t("stripe.notConnected")}>
        <p>{t("stripe.body")}</p>
      </Card>
    </section>
  );
}
