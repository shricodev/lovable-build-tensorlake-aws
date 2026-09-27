import "server-only";
import { Storage } from "@kiln/storage";

const g = globalThis as unknown as { __kilnStorage?: Storage };
export const storage = () => (g.__kilnStorage ??= new Storage());
