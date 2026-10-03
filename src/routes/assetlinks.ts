import { Router } from "express";

// Android Digital Asset Links. A wallet (Phantom) opens https://<identity domain>/.well-known/assetlinks.json
// to verify that the app asking to connect really belongs to that domain. When it verifies,
// the wallet stops showing "identity could not be verified" and allows SILENT re-authorization
// (the user connects once instead of on every transaction).
//
// Both values are public: a package name and the SHA-256 of the app's signing certificate.
// Add one entry per app/signing key (debug AND release builds have different fingerprints).
const TARGETS: ReadonlyArray<{ packageName: string; sha256CertFingerprints: string[] }> = [
  {
    packageName: "com.kept.backendtest",
    // Expo's default debug keystore (kept-example/app/android/app/debug.keystore).
    sha256CertFingerprints: [
      "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
    ],
  },
];

export const assetLinks = TARGETS.map((t) => ({
  relation: ["delegate_permission/common.handle_all_urls"],
  target: {
    namespace: "android_app",
    package_name: t.packageName,
    sha256_cert_fingerprints: t.sha256CertFingerprints,
  },
}));

export const assetlinksRouter = Router();

// Must be served over HTTPS, as JSON, with no redirect.
assetlinksRouter.get("/.well-known/assetlinks.json", (_req, res) => {
  // Send the file UNCOMPRESSED. The wallet's HTTP client advertises "Accept-Encoding: gzip, br" but
  // cannot read the Brotli/gzip body the CDN (Cloudflare, in front of Render) would return, so it
  // sees garbage instead of JSON and reports "could not verify package". `no-transform` tells the
  // CDN not to re-encode; an explicit `Content-Encoding: identity` makes that unambiguous.
  res
    .set({ "Cache-Control": "public, max-age=300, no-transform", "Content-Encoding": "identity" })
    .status(200)
    .json(assetLinks);
});
