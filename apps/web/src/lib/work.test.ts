import { describe, expect, it } from "vitest";
import { canSeeSales, days, formatKroner, formatOrgNumber, formatPhone, formatPrice, lines, months, priceInput, saleTone } from "./work";

describe("work formatting", () => {
  it("formats kroner the Norwegian way", () => {
    expect(formatKroner("399.50").replace(/\s/g, " ")).toBe("399,50 kr");
    expect(formatKroner("1299.00").replace(/\s/g, " ")).toBe("1 299 kr");
    expect(formatKroner(null)).toBe("–");
  });

  it("describes prices", () => {
    expect(formatPrice({ priceOnce: null, priceMonthly: "399.00" }).replace(/\s/g, " ")).toBe("399 kr/mnd");
    expect(formatPrice({ priceOnce: "499.00", priceMonthly: "399.00" }).replace(/\s/g, " ")).toBe("399 kr/mnd + 499 kr engangs");
    expect(formatPrice({ priceOnce: "499.00", priceMonthly: null }).replace(/\s/g, " ")).toBe("499 kr");
    expect(formatPrice({ priceOnce: null, priceMonthly: null })).toBe("–");
  });

  it("round-trips prices through the form", () => {
    expect(priceInput("399.50")).toBe("399,50");
    expect(priceInput("399.00")).toBe("399");
    expect(priceInput(null)).toBe("");
  });

  it("formats numbers and lists", () => {
    expect(formatOrgNumber("123456789")).toBe("123 456 789");
    expect(formatPhone("+4791234567")).toBe("912 34 567");
    expect(formatPhone("+46701234567")).toBe("+46701234567");
    expect(months(0)).toBe("Ingen");
    expect(months(1)).toBe("1 måned");
    expect(months(12)).toBe("12 måneder");
    expect(lines(" a \n\n b\n")).toEqual(["a", "b"]);
    expect([days(0), days(1), days(14)]).toEqual(["Ingen", "1 dag", "14 dager"]);
  });

  it("decides who sees sales and how statuses are colored", () => {
    expect(canSeeSales(["calls.read.own"])).toBe(true);
    expect(canSeeSales(["customers.read", "products.manage"])).toBe(false);
    expect(saleTone("registered")).toBeNull();
    expect(saleTone("active")).toBe("ok");
    expect(saleTone("awaiting_confirmation")).toBe("warning");
    expect(saleTone("withdrawn")).toBe("danger");
  });
});
