export function bearerToken(request) {
  const authorization = request?.headers?.get?.("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/);
  return match?.[1] ?? "";
}
