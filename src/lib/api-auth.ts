/**
 * API authentication utilities with support for key rotation.
 *
 * Supports multiple valid API keys via comma-separated INGEST_API_KEYS
 * environment variable, allowing zero-downtime key rotation.
 *
 * Usage in .env:
 *   INGEST_API_KEY=main-key
 *   INGEST_API_KEYS=main-key,old-key-being-rotated,new-key
 *
 * During rotation:
 * 1. Add new key to INGEST_API_KEYS
 * 2. Deploy and wait for propagation
 * 3. Update collector to use new key
 * 4. Remove old key from INGEST_API_KEYS
 */

// Parse valid keys from environment
function getValidKeys(): Set<string> {
  const keys = new Set<string>();

  // Support single key (backward compatible)
  const singleKey = process.env.INGEST_API_KEY;
  if (singleKey) {
    keys.add(singleKey.trim());
  }

  // Support multiple keys for rotation
  const multipleKeys = process.env.INGEST_API_KEYS;
  if (multipleKeys) {
    for (const key of multipleKeys.split(",")) {
      const trimmed = key.trim();
      if (trimmed) {
        keys.add(trimmed);
      }
    }
  }

  return keys;
}

// Cache keys to avoid re-parsing on every request
let cachedKeys: Set<string> | null = null;

function getKeys(): Set<string> {
  if (cachedKeys === null) {
    cachedKeys = getValidKeys();
  }
  return cachedKeys;
}

/**
 * Validate an ingest API key from Authorization header.
 *
 * @param header - The Authorization header value (e.g., "Bearer xyz123")
 * @returns true if the key is valid, false otherwise
 */
export function validateIngestKey(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) {
    return false;
  }

  const key = header.slice(7); // Remove "Bearer " prefix
  const validKeys = getKeys();

  if (validKeys.size === 0) {
    // No keys configured - deny all requests
    console.warn("No INGEST_API_KEY or INGEST_API_KEYS configured");
    return false;
  }

  return validKeys.has(key);
}

/**
 * Clear the cached keys (useful for testing or hot-reloading).
 */
export function clearKeyCache(): void {
  cachedKeys = null;
}
