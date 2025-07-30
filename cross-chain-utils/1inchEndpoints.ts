// cross-chain-utils/1inchEndpoints.ts
// 🎯 RUOLO: Wrapper per tutte le chiamate API 1inch
import { SwapParams, SignedOrder, ExecutionReport, FusionAuction } from '../shared/types';
import { ONEINCH_API } from '../shared/constants';

export class OneinchEndpoints {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = ONEINCH_API.BASE_URL;
  }

    // Get quote for cross-chain swap
    async getQuote(params: SwapParams) {
    return await this.call('GET', ONEINCH_API.ENDPOINTS.QUOTE, params);
    }
    
    // Create signed order
    async createOrder(signedOrder: SignedOrder) {
    return await this.call('POST', ONEINCH_API.ENDPOINTS.ORDER, signedOrder);
    }
    
    // Get active auctions (for resolvers)
  async getActiveAuctions(): Promise<FusionAuction[]> {
    return await this.call('GET', ONEINCH_API.ENDPOINTS.AUCTIONS);
    }
    
    // Report order execution
    async reportExecution(executionData: ExecutionReport) {
    return await this.call('POST', ONEINCH_API.ENDPOINTS.EXECUTION, executionData);
  }

  // Generic API call method
  private async call(method: 'GET' | 'POST', endpoint: string, data?: any) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    if (data && method === 'POST') {
      options.body = JSON.stringify(data);
    } else if (data && method === 'GET') {
      const params = new URLSearchParams(data);
      const urlWithParams = `${url}?${params}`;
      return this.fetchWithRetry(urlWithParams, options);
    }

    return this.fetchWithRetry(url, options);
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<any> {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      if (retries > 0) {
        console.log(`Retrying request. ${retries} attempts left.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
    }
}