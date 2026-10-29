import type { Buy } from "./buy.ts";

/**
 * The buy services Factura pays for, with the prices published in the buy catalogue
 * (gateway.usebuy.ai/v1/catalog and agent402.tools). Each cap sits at the listed price
 * so a quote that has moved up is refused instead of paid.
 */
const GATEWAY = "https://gateway.usebuy.ai";
const AGENT402 = "https://agent402.tools";

export const PRICES = {
  cencori: 0.01,
  linkedinCompany: 0.023,
  xProfile: 0.005,
  ofacName: 0.005,
  ofacWallet: 0.002,
} as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class Services {
  constructor(private readonly buy: Buy) {}

  /** Cencori LLM inference, flat $0.01 per completion. */
  async complete(messages: ChatMessage[], purpose: string, invoiceId?: string): Promise<string> {
    const res = await this.buy.call<{ choices?: { message?: { content?: string } }[] }>({
      service: "cencori/inference",
      url: `${GATEWAY}/cencori/v1/chat/completions`,
      body: { model: "maximo-atlas-1.3", max_tokens: 1024, temperature: 0.2, messages },
      maxUsd: PRICES.cencori,
      purpose,
      invoiceId,
    });
    const content = res.data?.choices?.[0]?.message?.content;
    if (!res.ok || !content) throw new Error(`cencori: ${res.error ?? "empty completion"}`);
    return content;
  }

  async linkedinCompany(query: { url?: string; search?: string }, invoiceId?: string) {
    const queryParams = query.url ? { url: query.url } : { search: query.search };
    return this.buy.call<Record<string, unknown>>({
      service: "linkedin/company (ploid)",
      url: `${GATEWAY}/v1/social/linkedin/tools/ploid-linkedin-company`,
      body: { queryParams },
      maxUsd: PRICES.linkedinCompany,
      purpose: "client vetting: company footprint",
      invoiceId,
    });
  }

  async xProfile(handle: string, invoiceId?: string) {
    return this.buy.call<Record<string, unknown>>({
      service: "x/user-profile (tikhub)",
      url: `${GATEWAY}/v1/social/x/tools/tikhub-api-v1-twitter-web-fetch-user-profile`,
      body: { queryParams: { screen_name: handle.replace(/^@/, "") } },
      maxUsd: PRICES.xProfile,
      purpose: "client vetting: public presence",
      invoiceId,
    });
  }

  /** OFAC SDN screening of a person or company name (Agent402). */
  async sanctionsName(name: string, invoiceId?: string) {
    const url = `${AGENT402}/api/sanctions/name?${new URLSearchParams({ name, limit: "5" })}`;
    return this.buy.call<{ matches?: unknown[]; verdict?: string }>({
      service: "agent402/sanctions-name",
      url,
      method: "GET",
      maxUsd: PRICES.ofacName,
      purpose: "client vetting: OFAC name screen",
      invoiceId,
    });
  }

  /** OFAC SDN screening of the wallet that is about to pay (Agent402). */
  async sanctionsWallet(address: string, invoiceId?: string) {
    const url = `${AGENT402}/api/sanctions/wallet?${new URLSearchParams({ address })}`;
    return this.buy.call<{ verdict?: string; entity?: string; sdnId?: string }>({
      service: "agent402/sanctions-wallet",
      url,
      method: "GET",
      maxUsd: PRICES.ofacWallet,
      purpose: "payer screen before settlement",
      invoiceId,
    });
  }
}
