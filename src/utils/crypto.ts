import { randomBytes } from "crypto";

export function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}
