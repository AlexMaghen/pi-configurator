/**
 * App entry. Polyfills must load before any module that touches crypto (the protocol package's
 * noble libraries), so they come first, then expo-router takes over.
 */
import "./src/polyfills";
import "expo-router/entry";
