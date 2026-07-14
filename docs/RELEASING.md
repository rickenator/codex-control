# Releasing Consiglio

Consiglio separates unsigned continuous-integration packages from production releases. CI builds every platform so contributors can prove portability without access to private certificates. The release workflow requires platform trust credentials and fails closed if signing, notarization, architecture, identity, or artifact validation fails.

## Required GitHub Actions secrets

Configure these repository secrets before publishing a release:

| Secret | Purpose |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `MAC_CSC_KEY_PASSWORD` | Password for the macOS certificate |
| `APPLE_API_KEY` | App Store Connect API key used by Apple notarization |
| `APPLE_API_KEY_ID` | App Store Connect key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |
| `WIN_CSC_LINK` | Base64-encoded Windows Authenticode `.pfx` certificate |
| `WIN_CSC_KEY_PASSWORD` | Password for the Windows certificate |

Never commit certificates, API keys, or passwords. Repository secret listings expose names and update dates, not values; the release jobs receive values only through their environment.

## Release procedure

1. Update `version` in `package.json` and `package-lock.json`.
2. Run `npm ci`, `npm run verify`, `npm audit --omit=dev --audit-level=high`, and the host package command.
3. Commit and push the version change.
4. Push a matching tag such as `v0.1.2`, or manually run **Release Consiglio** with that tag.
5. Confirm all four native package jobs and the publish job pass.

The workflow verifies that the requested tag exactly matches `package.json`. It then:

- runs type checking, protocol tests, and all production builds;
- rejects high or critical production dependency vulnerabilities;
- builds Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon artifacts on native GitHub-hosted runners;
- checks the package names, sizes, application identity, executable architecture, native `node-pty` architecture, archive integrity, and ASAR presence;
- requires and verifies Developer ID signatures plus Apple notarization for macOS;
- requires and verifies Authenticode signatures for Windows;
- publishes an SPDX SBOM and SHA-256 checksum manifest; and
- creates a signed GitHub/Sigstore provenance attestation covering every file in the checksum manifest.

Linux packages do not use an operating-system code-signing certificate. Their origin and integrity are covered by the checksum manifest and GitHub artifact attestation.

## Verify a downloaded release

Download the package and `SHA256SUMS.txt` into the same directory, then verify the checksum:

```bash
sha256sum --check SHA256SUMS.txt --ignore-missing
```

Verify GitHub's signed provenance with a current GitHub CLI:

```bash
gh attestation verify Consiglio-0.1.2-linux-x86_64.AppImage --repo rickenator/Consiglio
```

On macOS, inspect Gatekeeper and notarization:

```bash
spctl --assess --type open --context context:primary-signature --verbose=2 Consiglio-0.1.2-mac-arm64.dmg
xcrun stapler validate Consiglio-0.1.2-mac-arm64.dmg
```

On Windows, open the package's **Properties > Digital Signatures** tab or run:

```powershell
Get-AuthenticodeSignature .\Consiglio-0.1.2-windows-x64-setup.exe | Format-List
```
