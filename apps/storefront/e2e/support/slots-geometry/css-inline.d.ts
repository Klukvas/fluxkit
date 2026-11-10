// `?inline` CSS imports of the geometry probe: Vite returns the compiled stylesheet as a string (`css: true` in its config).
declare module "*.css?inline" {
  const css: string;
  export default css;
}
