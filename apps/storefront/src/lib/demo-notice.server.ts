import { loadStorefrontEnv } from "@fluxkit/config";
import { connection } from "next/server";

/** Runtime deployment setting: the same built image can serve a demo or a client shop. */
export async function demoNoticeEnabled(): Promise<boolean> {
  await connection();
  return loadStorefrontEnv(process.env).demoNotice;
}
