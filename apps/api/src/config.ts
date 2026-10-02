import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { AuthConfig, ProviderSettings } from "./auth/types.ts";

// Keys in the callsenter/<env>/app secret (filled in by hand in the console).
interface AppSecret {
  VIPPS_CLIENT_ID?: string;
  VIPPS_CLIENT_SECRET?: string;
  VIPPS_SUBSCRIPTION_KEY?: string;
  VIPPS_MSN?: string;
  IDURA_CLIENT_ID?: string;
  IDURA_CLIENT_SECRET?: string;
}

// Builds the login configuration. A provider is enabled only when its host and keys are all
// present; otherwise its buttons lead to "not set up yet" instead of a broken redirect.
export function buildAuthConfig(env: NodeJS.ProcessEnv, secret: AppSecret): AuthConfig {
  const providers: AuthConfig["providers"] = {};
  const vippsHost = env.VIPPS_HOST?.replace(/\/$/, "");
  if (vippsHost && secret.VIPPS_CLIENT_ID && secret.VIPPS_CLIENT_SECRET && secret.VIPPS_SUBSCRIPTION_KEY && secret.VIPPS_MSN) {
    const vipps: ProviderSettings = {
      discoveryUrl: `${vippsHost}/access-management-1.0/access/.well-known/openid-configuration`,
      clientId: secret.VIPPS_CLIENT_ID,
      clientSecret: secret.VIPPS_CLIENT_SECRET,
      // Not more than this: the user must accept the whole list (docs/auth.md).
      scope: "openid name phoneNumber",
      tokenHeaders: {
        "Ocp-Apim-Subscription-Key": secret.VIPPS_SUBSCRIPTION_KEY,
        "Merchant-Serial-Number": secret.VIPPS_MSN,
      },
      useUserinfo: true,
    };
    providers.vipps = vipps;
  }
  const iduraDomain = env.IDURA_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (iduraDomain && secret.IDURA_CLIENT_ID && secret.IDURA_CLIENT_SECRET) {
    providers.bankid = {
      discoveryUrl: `https://${iduraDomain}/.well-known/openid-configuration`,
      clientId: secret.IDURA_CLIENT_ID,
      clientSecret: secret.IDURA_CLIENT_SECRET,
      // No ssn scope: the national identity number is not fetched (docs/auth.md).
      scope: "openid",
      acrValues: "urn:grn:authn:no:bankid",
      useUserinfo: false,
    };
  }
  return {
    appOrigin: (env.APP_ORIGIN ?? "").replace(/\/$/, ""),
    callbackBase: (env.AUTH_CALLBACK_BASE ?? "").replace(/\/$/, ""),
    providers,
  };
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  const secretArn = process.env.APP_SECRET_ARN;
  let secret: AppSecret = {};
  if (secretArn) {
    const { SecretString } = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
    secret = JSON.parse(SecretString ?? "{}") as AppSecret;
  }
  return buildAuthConfig(process.env, secret);
}
