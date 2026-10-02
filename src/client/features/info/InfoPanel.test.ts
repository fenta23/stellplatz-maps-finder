import { describe, it, expect } from "vitest";
import { InfoPanel } from "./InfoPanel.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("InfoPanel", () => {
  it("renders app name, version, and changelog", async () => {
    const c = document.createElement("div");
    new InfoPanel(c);
    await flush();
    expect(c.textContent).toContain("Camp Finder");
    expect(c.textContent).toContain("v2.0.");
    expect(c.textContent).toContain("Changelog");
  });

  it("renders open source and map data sections", async () => {
    const c = document.createElement("div");
    new InfoPanel(c);
    await flush();
    expect(c.textContent).toContain("Open Source");
    expect(c.textContent).toContain("Leaflet");
    expect(c.textContent).toContain("Kartendaten");
    expect(c.textContent).toContain("OpenStreetMap");
  });

  it("shows the POI tile date once known", async () => {
    const c = document.createElement("div");
    const panel = new InfoPanel(c);
    const date = c.querySelector('[data-ref="poi-data-date"]')!;
    expect(date.textContent).toBe("");
    panel.setPoiDataDate("2026-10-02");
    expect(date.textContent).toBe(", Stand 02.10.2026");
  });

  it("open and close via class", async () => {
    const c = document.createElement("div");
    const panel = new InfoPanel(c);
    await flush();
    expect(panel.isOpen()).toBe(false);
    panel.open();
    expect(panel.isOpen()).toBe(true);
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });

  it("closes when the X button is clicked", async () => {
    const c = document.createElement("div");
    const panel = new InfoPanel(c);
    await flush();
    panel.open();
    expect(panel.isOpen()).toBe(true);
    c.querySelector<HTMLButtonElement>(".fav-close")!.click();
    expect(panel.isOpen()).toBe(false);
  });
});
