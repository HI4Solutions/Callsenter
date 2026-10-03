import { describe, expect, it } from "vitest";
import { checkFindings, type Finding, worstLevel } from "../src/calls/process.ts";

const points = [
  { id: "a1", text: "Opplys om angreretten" },
  { id: "b2", text: "Bekreft bindingstiden" },
];
const finding = (f: Partial<Finding>): Finding => ({
  kind: "required_point",
  pointId: "",
  label: "",
  level: "green",
  quote: "",
  startMs: -1,
  comment: "",
  ...f,
});

describe("checking the AI control's findings", () => {
  it("makes a mandatory point the model left out red, so the call can't be green", () => {
    const checked = checkFindings([finding({ pointId: "a1", level: "green" })], points);
    expect(checked.map((f) => [f.pointId, f.level])).toEqual([
      ["a1", "green"],
      ["b2", "red"],
    ]);
    expect(worstLevel(checked)).toBe("red");
  });

  it("drops unknown points, kinds and levels, and keeps the worst of a point assessed twice", () => {
    const checked = checkFindings(
      [
        finding({ pointId: "a1", level: "green" }),
        finding({ pointId: "a1", level: "yellow" }),
        finding({ pointId: "b2", level: "green" }),
        finding({ pointId: "zz", level: "green" }),
        finding({ kind: "other", level: "purple" as Finding["level"] }),
        finding({ kind: "bonus" as Finding["kind"], level: "red" }),
        finding({ kind: "forbidden_phrase", level: "red", quote: "gratis" }),
      ],
      points,
    );
    expect(checked.map((f) => [f.kind, f.pointId, f.level])).toEqual([
      ["required_point", "a1", "yellow"],
      ["required_point", "b2", "green"],
      ["forbidden_phrase", "", "red"],
    ]);
  });
});
