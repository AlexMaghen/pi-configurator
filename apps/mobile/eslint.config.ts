/** ESLint flat config: Expo's recommended rules. Run with `pnpm lint` (expo lint). */
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat";

export default defineConfig([expoConfig, { ignores: ["dist/*", "ios/*", "android/*", ".expo/*"] }]);
