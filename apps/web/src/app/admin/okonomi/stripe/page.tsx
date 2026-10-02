import { Card } from "@/components/admin/card";
import { EconomyNav } from "@/components/billing/economy-nav";

// Stripe: card subscriptions, prices and MRR from Stripe. Waits for the account and keys
// (docs/plan.md, section 16).
export default function StripePage() {
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <p className="mt-2 text-muted">Abonnement som betales med kort gjennom Stripe.</p>
      </div>
      <EconomyNav />
      <Card title="Stripe er ikke koblet til ennå">
        <p>
          Når Stripe-kontoen og nøklene er på plass, kommer abonnentene her (med fakturakundene), prisene med MRR, og verktøy for å knytte et
          callsenter til en pakke, pause, bytte plan, gi rabatt og refundere. Pakkene under Faktura kobles da til Stripe-priser.
        </p>
      </Card>
    </section>
  );
}
