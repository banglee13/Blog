export interface GalaxyArticle {
  id: string
  title: string
  date: string
  savedAt?: number
}
export interface GalaxyView {
  angle: number
  tilt: number
}
export interface StarMap {
  rotate(delta: number): void
  setActive(active: boolean): void
  getView(): GalaxyView
  approach(target: string, options?: { signal?: AbortSignal }): Promise<boolean>
  returnFrom(
    target: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>
  cancelTransition(): void
  destroy(): void
}
export function mountGalaxy(
  container: HTMLElement,
  options: {
    articles: GalaxyArticle[]
    initialView?: GalaxyView
    onArticle(article: GalaxyArticle): void
    onCore(): void
  },
): StarMap
