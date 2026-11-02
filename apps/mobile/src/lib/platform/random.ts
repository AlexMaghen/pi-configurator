/** Secure random bytes on the phone (iOS SecRandomCopyBytes / Android SecureRandom via expo-crypto). */
import { getRandomBytes } from "expo-crypto";

export const randomBytes = (length: number): Uint8Array => getRandomBytes(length);
