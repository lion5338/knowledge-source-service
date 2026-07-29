export class HttpError extends Error {
  constructor(message, { status = 500, code = "server_error", type = "server_error", details = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.type = type;
    this.details = details;
  }
}

export function badRequest(message, details = null) {
  return new HttpError(message, { status: 400, code: "bad_request", type: "bad_request", details });
}

export function notFound(message) {
  return new HttpError(message, { status: 404, code: "not_found", type: "not_found" });
}

export function routeError(error) {
  const status = error instanceof HttpError ? error.status : 500;
  return Response.json(
    {
      error: {
        message: error.message,
        type: error.type ?? "server_error",
        code: error.code ?? "server_error",
        details: error.details ?? null,
      },
    },
    { status },
  );
}
