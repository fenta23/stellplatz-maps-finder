/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** DSGVO-Verantwortlicher (Klarname), per Build-Env injiziert — siehe InfoPanel. */
  readonly VITE_DSGVO_VERANTWORTLICHER?: string
  /** Basis-URL der statischen POI-Kacheln (Daten-Repo auf GitHub Pages) — siehe core/config.ts. */
  readonly VITE_POI_TILES_BASE?: string
}
