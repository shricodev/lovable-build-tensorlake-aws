import "server-only";
import { Storage } from "@lovable-diy/storage";

const g = globalThis as unknown as { __lovableDiyStorage?: Storage };
export const storage = () => (g.__lovableDiyStorage ??= new Storage());
