import { ApiError, DjangoClient, getAll } from "../backend/client";
import type { Approval, Beneficiary, Corridor, Order, Page, PolicyError, Quote, WalletBalances, WalletSnapshot } from "./types";

export class WalletApiError extends Error {
  constructor(public status: number, public details: PolicyError | null) {
    super(details?.message || details?.detail || `Request failed (${status || "network"}).`);
  }
  get code() { return this.details?.code || this.details?.detail || ""; }
}

export interface WalletClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, identity?: string, extraHeaders?: Record<string, string>): Promise<T>;
}

/** Adapter for the final application's Django session/CSRF client. */
export class SessionWalletClient implements WalletClient {
  private retryKeys = new Map<string,string>();
  private api: Promise<DjangoClient> | null = null;
  private async session(): Promise<DjangoClient> {
    if(!this.api) this.api=fetch('/api/auth/session/',{credentials:'same-origin'}).then(async response=>{
      if(!response.ok) throw new WalletApiError(response.status,{detail:'Could not check the sign-in session.'});
      const identity=await response.json();
      if(!identity.authenticated) throw new WalletApiError(401,{detail:'Sign in to StudyFlow to view your wallet.'});
      return new DjangoClient(identity.csrf_token);
    }).catch(error=>{this.api=null;throw error;});
    return this.api;
  }
  private convert(error: unknown): never {
    if(error instanceof ApiError) throw new WalletApiError(error.status,error.details as PolicyError);
    throw error;
  }
  async get<T>(path:string):Promise<T> {try{return await(await this.session()).get<T>(path);}catch(error){return this.convert(error);}}
  async post<T>(path:string,body:unknown,identity=path,extraHeaders:Record<string,string>={}):Promise<T> {
    // Password/step-up commands are never cached or fingerprinted in memory.
    const sensitive=path==='auth/step-up/';
    const fingerprint=sensitive?'':`${identity}:${JSON.stringify(body)}`;
    const key=sensitive?crypto.randomUUID():this.retryKeys.get(fingerprint)??crypto.randomUUID();
    if(!sensitive)this.retryKeys.set(fingerprint,key);
    try {
      const result=await(await this.session()).request<T>(path,{method:'POST',body,key,headers:extraHeaders});
      if(!sensitive)this.retryKeys.delete(fingerprint);
      return result;
    }catch(error){if(error instanceof ApiError&&error.status===409)this.retryKeys.delete(fingerprint);return this.convert(error);}
  }
}

function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : "This section could not load.";
}

/** Reads are independent so a failing notification or approval list does not hide balances. */
export async function loadWallet(client: WalletClient): Promise<WalletSnapshot> {
  const [balances, corridors, beneficiaries, orders, approvals] = await Promise.allSettled([
    client.get<WalletBalances>("demo/wallets/balances/"),
    client.get<Corridor[]>("corridors/"),
    getAll<Beneficiary>(client,"beneficiaries/"),
    getAll<Order>(client,"remittance-orders/"),
    getAll<Approval>(client,"approvals/"),
  ]);
  return {
    balances: balances.status === "fulfilled" ? balances.value : null,
    corridors: corridors.status === "fulfilled" ? corridors.value : [],
    beneficiaries: beneficiaries.status === "fulfilled" ? beneficiaries.value : [],
    orders: orders.status === "fulfilled" ? orders.value : [],
    approvals: approvals.status === "fulfilled" ? approvals.value : [],
    errors: {
      ...(balances.status === "rejected" ? { balances: errorText(balances.reason) } : {}),
      ...(corridors.status === "rejected" ? { corridors: errorText(corridors.reason) } : {}),
      ...(beneficiaries.status === "rejected" ? { beneficiaries: errorText(beneficiaries.reason) } : {}),
      ...(orders.status === "rejected" ? { orders: errorText(orders.reason) } : {}),
      ...(approvals.status === "rejected" ? { approvals: errorText(approvals.reason) } : {}),
    },
  };
}

export type { Approval, Beneficiary, Corridor, Order, Quote, WalletBalances };
