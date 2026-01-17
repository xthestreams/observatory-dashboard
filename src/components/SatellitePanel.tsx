"use client";

import { useState, useMemo } from "react";
import { siteConfig, getNearestRadarStation, getRadarStationInfo } from "@/lib/config";
import styles from "./SatellitePanel.module.css";

interface BomProduct {
  id: string;
  name: string;
  description: string;
  category: "satellite" | "radar";
}

// BOM Satellite Image Products
const SATELLITE_PRODUCTS: BomProduct[] = [
  {
    id: "IDE00005",
    name: "Australia Visible (B&W)",
    description: "Full Australia - grayscale visible spectrum, cloud detail",
    category: "satellite",
  },
  {
    id: "IDE00006",
    name: "Australia Infrared (B&W)",
    description: "Full Australia - infrared, shows cloud heights, works at night",
    category: "satellite",
  },
];

// Generate radar products based on configured or auto-selected station
function getRadarProducts(stationCode: string): BomProduct[] {
  if (!stationCode) return [];

  const stationInfo = getRadarStationInfo(stationCode);
  const stationName = stationInfo?.name || `Station ${stationCode}`;

  return [
    {
      id: `IDR${stationCode}1`,
      name: `Radar 512km`,
      description: `Extended range weather radar - 512km range from ${stationName}`,
      category: "radar" as const,
    },
  ];
}

// Generate BOM FTP URL for a product
// Uses a proxy API to avoid CORS issues with FTP
function getBomImageUrl(productId: string): string {
  return `/api/bom-satellite/${productId}`;
}

interface SatelliteImageProps {
  product: BomProduct;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function SatelliteImage({ product, isExpanded, onToggleExpand }: SatelliteImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Use API's built-in caching (5 minutes) - no need for client-side cache busting
  const imageUrl = getBomImageUrl(product.id);

  return (
    <div
      className={`${styles.satelliteItem} ${isExpanded ? styles.expanded : ""}`}
      data-product-id={product.id}
    >
      <div className={styles.imageHeader}>
        <div className={styles.productInfo}>
          <span className={styles.productId}>{product.id}</span>
          <span className={styles.productName}>{product.name}</span>
        </div>
        <button
          className={styles.expandButton}
          onClick={onToggleExpand}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? "−" : "+"}
        </button>
      </div>
      <div className={styles.imageWrapper}>
        {isLoading && !hasError && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}></div>
          </div>
        )}
        {hasError ? (
          <div className={styles.errorMessage}>
            <span>Failed to load</span>
            <span className={styles.productIdSmall}>{product.id}</span>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={product.name}
            className={styles.satelliteImage}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setHasError(true);
              setIsLoading(false);
            }}
          />
        )}
      </div>
      {isExpanded && (
        <div className={styles.imageDescription}>
          {product.description}
        </div>
      )}
    </div>
  );
}

export function SatellitePanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Get radar station (auto-selected or manual)
  const radarStation = useMemo(() => getNearestRadarStation(), []);
  const radarStationInfo = useMemo(() => getRadarStationInfo(radarStation), [radarStation]);
  const radarProducts = useMemo(() => getRadarProducts(radarStation), [radarStation]);

  const handleToggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className={styles.satellitePanel}>
      {/* Satellite Imagery */}
      <div className={styles.sectionLabel}>Satellite Imagery</div>
      <div className={styles.satelliteGrid}>
        {SATELLITE_PRODUCTS.map((product) => (
          <SatelliteImage
            key={product.id}
            product={product}
            isExpanded={expandedId === product.id}
            onToggleExpand={() => handleToggleExpand(product.id)}
          />
        ))}
      </div>

      {/* Radar Imagery - only shown if station is configured or auto-detected */}
      {radarProducts.length > 0 && (
        <>
          <div className={styles.sectionLabel}>
            Weather Radar ({radarStationInfo?.name || `Station ${radarStation}`})
          </div>
          <div className={styles.satelliteGrid}>
            {radarProducts.map((product) => (
              <SatelliteImage
                key={product.id}
                product={product}
                isExpanded={expandedId === product.id}
                onToggleExpand={() => handleToggleExpand(product.id)}
              />
            ))}
          </div>
        </>
      )}

      <div className={styles.attribution}>
        Source: Bureau of Meteorology (Himawari-9 satellite, weather radar network)
      </div>
    </div>
  );
}
