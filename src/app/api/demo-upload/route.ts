import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { signUpload } from "@/server/adapters/demo";
import { resolveMode } from "@/server/config";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

const fail = (status: number, message: string) => NextResponse.json({ error: { code: "UPLOAD_REJECTED", message } }, { status });

/**
 * LOCAL_DEMO stand-in for an S3 presigned PUT. Validates the signed ticket,
 * the declared type and size, and the file's magic bytes before writing.
 */
export async function PUT(request: NextRequest) {
  // In AWS_PRODUCTION uploads go straight to S3 via presigned URLs; this route does not exist.
  if (resolveMode() !== "LOCAL_DEMO") return fail(404, "Not found");
  const runtime = await getRuntime();
  if (!runtime.demo) return fail(404, "Not found");
  const p = request.nextUrl.searchParams;
  const key = p.get("key") ?? "";
  const type = p.get("type") ?? "";
  const size = Number(p.get("size"));
  const exp = Number(p.get("exp"));
  const sig = p.get("sig") ?? "";
  const expected = signUpload(runtime.demo.uploadSecret, key, type, size, exp);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return fail(403, "Invalid upload signature.");
  if (Date.now() > exp) return fail(403, "Upload link expired.");
  if (!/^uploads\/[A-Za-z0-9_]+\/[A-Z0-9]{26}\.(jpg|png|webp)$/.test(key)) return fail(400, "Invalid object key.");
  if (request.headers.get("content-type") !== type || !MAGIC[type]) return fail(415, "Unsupported content type.");
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length !== size || size > 2 * 1024 * 1024) return fail(413, "File size does not match the upload ticket.");
  if (!MAGIC[type](body)) return fail(415, "File content does not match its declared type.");
  const root = resolve(".data");
  const target = resolve(join(root, key));
  if (!target.startsWith(root)) return fail(400, "Invalid object key.");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  return new NextResponse(null, { status: 200 });
}
