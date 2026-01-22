/**
 * Standardized API error handling utilities.
 *
 * Provides consistent error response structure across all API routes.
 */

import { NextResponse } from "next/server";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST";
  readonly statusCode = 400;

  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  readonly statusCode = 401;

  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly statusCode = 429;

  constructor(message: string = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class InternalError extends Error {
  readonly code = "INTERNAL_ERROR";
  readonly statusCode = 500;

  constructor(message: string = "Internal server error") {
    super(message);
    this.name = "InternalError";
  }
}

type KnownError = BadRequestError | UnauthorizedError | NotFoundError | RateLimitError | InternalError;

function isKnownError(error: unknown): error is KnownError {
  return (
    error instanceof BadRequestError ||
    error instanceof UnauthorizedError ||
    error instanceof NotFoundError ||
    error instanceof RateLimitError ||
    error instanceof InternalError
  );
}

export function toApiError(error: unknown, requestId?: string): ApiError {
  const timestamp = new Date().toISOString();

  if (isKnownError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error instanceof BadRequestError ? error.details : undefined,
      timestamp,
      requestId,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: process.env.NODE_ENV === "development"
        ? error.message
        : "An unexpected error occurred",
      timestamp,
      requestId,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unknown error occurred",
    timestamp,
    requestId,
  };
}

export function errorResponse(error: unknown, requestId?: string): NextResponse {
  const apiError = toApiError(error, requestId);

  let statusCode = 500;
  if (isKnownError(error)) {
    statusCode = error.statusCode;
  }

  return NextResponse.json(apiError, { status: statusCode });
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}
