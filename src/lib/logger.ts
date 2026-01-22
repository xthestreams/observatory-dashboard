/**
 * Structured JSON logging utility for API routes and components.
 *
 * Outputs logs in JSON format for easy parsing and filtering in
 * Vercel Functions dashboard and external log aggregators.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  userId?: string;
  instrumentCode?: string;
  duration?: number;
  [key: string]: unknown;
}

export class Logger {
  constructor(private name: string) {}

  private formatLog(level: LogLevel, message: string, context?: LogContext) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      ...context,
    });
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === "development") {
      console.debug(this.formatLog("debug", message, context));
    }
  }

  info(message: string, context?: LogContext) {
    console.info(this.formatLog("info", message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog("warn", message, context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorInfo = error instanceof Error
      ? { errorMessage: error.message, errorStack: error.stack }
      : error
        ? { errorMessage: String(error) }
        : {};

    console.error(
      this.formatLog("error", message, {
        ...context,
        ...errorInfo,
      })
    );
  }
}

export const createLogger = (name: string) => new Logger(name);
