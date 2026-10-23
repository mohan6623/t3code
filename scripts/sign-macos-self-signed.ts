import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

// Fork: electron-builder hands over an ad hoc identity (see the self-signing note in
// build-desktop-artifact.ts). codesign accepts an untrusted certificate by fingerprint.
export default async function sign(options: SignOptions): Promise<void> {
  const identity = process.env.T3CODE_MACOS_SELF_SIGN_IDENTITY?.trim();
  if (!identity) throw new Error("T3CODE_MACOS_SELF_SIGN_IDENTITY is not set.");
  await signApplication({
    ...options,
    identity,
    identityValidation: false,
    batchCodesignCalls: true,
  });
}
