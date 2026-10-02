// A software passkey for tests: makes registration and authentication responses the way a
// browser and platform authenticator would (ES256, "none" attestation, user verified).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

export function createAuthenticator(options: { rpID: string; origin: string }) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  let counter = 0;

  const cosePublicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );

  function authData(flags: number, extra: Uint8Array = new Uint8Array()) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([sha256(options.rpID), Buffer.from([flags]), count, extra]);
  }

  return {
    id: b64url(credentialId),
    register(challenge: string, override: { origin?: string } = {}) {
      const clientDataJSON = JSON.stringify({ type: "webauthn.create", challenge, origin: override.origin ?? options.origin });
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      // UP | UV | AT
      const data = authData(0x45, Buffer.concat([Buffer.alloc(16), idLength, credentialId, Buffer.from(cosePublicKey)]));
      const attestationObject = isoCBOR.encode(
        new Map<string, unknown>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", data],
        ]) as never,
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal"] },
        clientExtensionResults: {},
      };
    },
    authenticate(challenge: string, override: { origin?: string; key?: KeyObject } = {}) {
      counter += 1;
      const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge, origin: override.origin ?? options.origin });
      // UP | UV
      const data = authData(0x05);
      const signature = sign("sha256", Buffer.concat([data, sha256(clientDataJSON)]), override.key ?? privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(data),
          signature: b64url(signature),
        },
        clientExtensionResults: {},
      };
    },
  };
}

export function otherKey() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
}
