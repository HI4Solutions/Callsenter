"use client";

import { useTranslations } from "next-intl";
import { Threads } from "@/components/threads";

export default function OrgMessagesPage() {
  const t = useTranslations("org.messages");
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro")}</p>
      </div>
      <Threads base="/org" />
    </section>
  );
}
