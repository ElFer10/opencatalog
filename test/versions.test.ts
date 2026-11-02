import { describe, expect, it } from "vitest";
import { applyVersion, createDataSource, detectVersions, versionFieldFor } from "../src/core";

const ds = () => createDataSource("menu.csv", "csv", [
  { ID: "1", Namn_sv: "Blåbärsmousse", Namn_es: "Mousse de arándanos", Beskrivning_sv: "Med grädde", Beskrivning_es: "", Pris: 95, "Pris (SE)": 95, "Pris (ES)": 9.5, Price_net: 1 },
  { ID: "2", Namn_sv: "Bröd", Namn_es: "Pan", Beskrivning_sv: "Surdeg", Beskrivning_es: "Masa madre", Pris: 30, "Pris (SE)": 30, "Pris (ES)": 3, Price_net: 2 },
]);

describe("versions", () => {
  it("detects version codes used by at least two base fields", () => {
    const info = detectVersions(ds().fields);
    expect(info.versions).toEqual(["sv", "es"]);
    expect([...info.variants.keys()]).toEqual(["Namn", "Beskrivning", "Pris"]);
    expect(info.variants.get("Pris")!.get("es")).toBe("Pris (ES)");
  });

  it("adds missing base fields and switches versions with fallback", () => {
    const sv = applyVersion(ds(), null);
    expect(sv.fields.map((f) => f.name)).toEqual(["ID", "Namn_sv", "Namn", "Namn_es", "Beskrivning_sv", "Beskrivning", "Beskrivning_es", "Pris", "Pris (SE)", "Pris (ES)", "Price_net"]);
    expect(sv.records[0]!.values["Namn"]).toBe("Blåbärsmousse");
    const es = applyVersion(ds(), "es");
    expect(es.records[0]!.values["Namn"]).toBe("Mousse de arándanos");
    expect(es.records[0]!.values["Beskrivning"]).toBe(""); // added base shows the version even when empty
    expect(es.records[1]!.values["Pris"]).toBe(3);
    expect(applyVersion(ds(), "sv").records[1]!.values["Pris"]).toBe(30);
  });

  it("maps edits back to the version's field", () => {
    expect(versionFieldFor(ds(), "Namn", "es")).toBe("Namn_es");
    expect(versionFieldFor(ds(), "Namn", null)).toBe("Namn_sv");
    expect(versionFieldFor(ds(), "Pris", null)).toBe("Pris");
    expect(versionFieldFor(ds(), "ID", "es")).toBe("ID");
  });

  it("leaves sources without versions untouched", () => {
    const plain = createDataSource("x", "csv", [{ a: 1, b_net: 2 }]);
    expect(applyVersion(plain, "es")).toBe(plain);
  });
});
