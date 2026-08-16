"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeLabelProps {
  skuCode: string;
  productName: string;
  /** Label physical size in mm — defaults to common sticker stock. Confirm against your actual label printer/stock before relying on this for real printing. */
  widthMm?: number;
  heightMm?: number;
}

// Code128: alphanumeric + hyphen safe (our SKUs look like "ARD-0001"),
// reads on any standard barcode scanner, no server round-trip needed.
export default function BarcodeLabel({ skuCode, productName, widthMm = 50, heightMm = 25 }: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    JsBarcode(svgRef.current, skuCode, {
      format: "CODE128",
      width: 1.5,
      height: 40,
      displayValue: false,
      margin: 0,
    });
  }, [skuCode]);

  return (
    <div
      className="barcode-label"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2mm",
        boxSizing: "border-box",
        border: "1px solid #000",
        background: "#fff",
      }}
    >
      <svg ref={svgRef} style={{ width: "100%", maxHeight: "60%" }} />
      <div style={{ fontSize: "2.2mm", fontFamily: "monospace", color: "#000", marginTop: "1mm" }}>{skuCode}</div>
      <div
        style={{
          fontSize: "2mm",
          color: "#000",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
        }}
      >
        {productName}
      </div>
    </div>
  );
}
