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
      // EXPERIMENT: same fingerprint in other spellings (a wallet's parser may compare as plain text).
      "fa:c6:17:45:dc:09:03:78:6f:b9:ed:e6:2a:96:2b:39:9f:73:48:f0:bb:6f:89:9b:83:32:66:75:91:03:3b:9c",
      "FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B83326675 91033B9C".replace(" ", ""),
      "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c",
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
  res.set("Cache-Control", "public, max-age=300").status(200).json(assetLinks);
});
