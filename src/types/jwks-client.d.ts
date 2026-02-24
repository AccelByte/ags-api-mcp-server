declare module "jwks-client" {
  interface SigningKey {
    kid: string;
    getPublicKey(): string;
    publicKey?: string;
    rsaPublicKey?: string;
  }

  interface JwksClient {
    getSigningKey(
      kid: string,
      callback: (err: Error | null, key?: SigningKey) => void,
    ): void;
    getSigningKeys(): Promise<SigningKey[]>;
  }

  interface JwksClientOptions {
    jwksUri: string;
    cache?: boolean;
    cacheMaxAge?: string | number;
    rateLimit?: boolean;
    jwksRequestsPerMinute?: number;
    timeout?: number;
    strictSsl?: boolean;
    requestHeaders?: Record<string, string>;
  }

  function jwksClient(options: JwksClientOptions): JwksClient;
  export = jwksClient;
}
