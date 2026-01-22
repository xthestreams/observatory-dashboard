"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary component to catch and handle React errors gracefully.
 *
 * Prevents component errors from crashing the entire application.
 * Shows a fallback UI when errors occur and allows users to retry.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error in structured format for Vercel logs
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        logger: "ErrorBoundary",
        message: "React component error",
        errorMessage: error.message,
        errorStack: error.stack,
        componentStack: errorInfo.componentStack,
      })
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            backgroundColor: "rgba(255, 0, 0, 0.1)",
            borderRadius: "8px",
            margin: "10px",
          }}
        >
          <h3 style={{ color: "#ff4444", margin: "0 0 10px 0" }}>
            Something went wrong
          </h3>
          <p style={{ color: "#888", margin: "0 0 15px 0", fontSize: "14px" }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: "8px 16px",
              backgroundColor: "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Default fallback component for dashboard-level errors.
 */
export function DashboardErrorFallback() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <h2 style={{ color: "#ff4444", margin: "0 0 10px 0" }}>
        Dashboard Error
      </h2>
      <p style={{ color: "#888", margin: "0 0 20px 0" }}>
        The dashboard encountered an error. Please refresh the page.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "12px 24px",
          backgroundColor: "#0066cc",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          fontSize: "16px",
        }}
      >
        Refresh Page
      </button>
    </div>
  );
}
