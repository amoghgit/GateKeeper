/**
 * API Gateway (HTTP API, payload v2) → shared router.
 * Each deployed function sets ROUTE_PREFIXES so it serves only its own slice
 * of the API, and its IAM role grants only what that slice needs.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { handleApiRequest } from "@/server/api/router";
import { getRuntime } from "@/server/runtime";

const prefixes = process.env.ROUTE_PREFIXES?.split(",")
  .map((p) => p.trim())
  .filter(Boolean);

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runtime = await getRuntime();
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : null;
  const res = await handleApiRequest(
    runtime,
    {
      method: event.requestContext.http.method,
      path: event.rawPath.replace(/^\/v1/, "") || "/",
      query: new URLSearchParams(event.rawQueryString ?? ""),
      headers,
      body,
      ip: event.requestContext.http.sourceIp,
      requestId: event.requestContext.requestId,
    },
    { allowedPrefixes: prefixes },
  );
  return { statusCode: res.status, headers: res.headers, body: res.body };
}
