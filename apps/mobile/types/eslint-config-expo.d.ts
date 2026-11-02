/** eslint-config-expo ships no types for its flat config entry point. */
declare module "eslint-config-expo/flat" {
  import type { Linter } from "eslint";
  const config: Linter.Config[];
  export default config;
}
