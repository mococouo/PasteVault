import { describe, expect, it } from "vitest";
import { classifyContent } from "./classifier";
import { collectSensitiveMatches, extractSecretValues, redactSecrets } from "./secrets";

describe("secretRules", () => {
  it("detects JWT tokens", () => {
    const matches = collectSensitiveMatches("token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEi.sgnjY2rL");
    expect(matches.some((m) => m.pattern === "jwt")).toBe(true);
  });

  it("detects Stripe live keys", () => {
    const fakeStripeKey = ["sk", "live", "FAKEKEYFORTESTINGONLY0000000000"].join("_");
    const matches = collectSensitiveMatches(`pk: ${fakeStripeKey}`);
    expect(matches.some((m) => m.label === "Stripe live key")).toBe(true);
  });

  it("detects database connection strings with credentials", () => {
    const fakeConnectionString = ["mongodb://", "ada", ":", "swordfish", "@cluster.example.net/db"].join("");
    const matches = collectSensitiveMatches(fakeConnectionString);
    expect(matches.some((m) => m.pattern === "connection-string")).toBe(true);
  });

  it("matches the full PEM private key block instead of just the header", () => {
    const pem = fakePem();
    const matches = collectSensitiveMatches(pem);
    const hit = matches.find((m) => m.pattern === "private-key");
    expect(hit?.count).toBe(1);
  });

  it("redacts a PEM block completely", () => {
    const pem = fakePem();
    expect(redactSecrets(pem)).not.toContain("MIIBOgIBAAJBAKjQ");
  });

  it("extracts OpenAI key value including the sk- prefix", () => {
    const fakeOpenAiKey = ["sk", "test-fake-00000000000000000000"].join("-");
    const hits = extractSecretValues(`API key: ${fakeOpenAiKey}`);
    const values = hits.map((h) => h.value);
    expect(values).toContain(fakeOpenAiKey);
  });

  it("rates API keys as high severity and Chinese ID as low", () => {
    const fakeOpenAiKey = ["sk", "test-fake-00000000000000000000"].join("-");
    expect(classifyContent(fakeOpenAiKey).sensitivity).toBe("high");
    expect(classifyContent("我的身份证号是 110101199003077134").sensitivity).toBe("low");
  });
});

function fakePem(): string {
  const boundary = ["RSA ", "PRIVATE KEY"].join("");
  return [`-----BEGIN ${boundary}-----`, "MIIBOgIBAAJBAKjQ", `-----END ${boundary}-----`].join("\n");
}
